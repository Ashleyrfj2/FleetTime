// Unit tests for the session duration state machine and daily summary math,
// per the plan's verification section: seed synthetic event sequences and
// assert the computed durations.
//
// better-sqlite3 is ABI-rebuilt for Electron, so plain `node` cannot load it.
// Run via: ELECTRON_RUN_AS_NODE=1 electron test/durations.test.js
// (wired up as `npm test`). FLEETTIME_DB_PATH avoids touching electron.app,
// which is unavailable under ELECTRON_RUN_AS_NODE.

process.env.FLEETTIME_DB_PATH = ":memory:";

const assert = require("assert");
const {
  startSession,
  transitionState,
  endSession,
  getSession,
  getOpenSession,
  setEnvironmentName,
  updateOpenSessionTask,
  editSession,
  deleteSession,
  toSummary,
  listSessionsForDay,
} = require("../dist-electron/db/sessions");
const { computeDailySummary, listLoggedDays } = require("../dist-electron/db/summary");

function localDateStr(d) {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

// Anchor all synthetic timestamps at local noon today so every session falls
// inside today's local-midnight-to-midnight summary window.
const noon = new Date();
noon.setHours(12, 0, 0, 0);
const T0 = noon.getTime();
const sec = (s) => s * 1000;
const today = localDateStr(noon);

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
}

// --- Scenario A: full task-writing lifecycle with every bucket -------------
let t = T0;
const a = startSession({ role: "task_writing", taskId: "task-A", url: "https://fleetai.com/work/problems/create?instance_id=task-A", ts: t });
transitionState(a.id, "guidelines", (t += sec(300))); // banked: active 300
transitionState(a.id, "active", (t += sec(120)));     // banked: guidelines 120
transitionState(a.id, "slack", (t += sec(600)));      // banked: active +600
transitionState(a.id, "active", (t += sec(60)));      // banked: slack 60
transitionState(a.id, "idle", (t += sec(200)));       // banked: active +200
transitionState(a.id, "active", (t += sec(400)));     // banked: idle 400
transitionState(a.id, "break", (t += sec(100)));      // banked: active +100
transitionState(a.id, "active", (t += sec(500)));     // banked: break 500
endSession(a.id, "submitted", (t += sec(50)));        // banked: active +50

check("scenario A: per-bucket durations", () => {
  const row = getSession(a.id);
  assert.strictEqual(row.active_seconds, 1250);
  assert.strictEqual(row.guidelines_seconds, 120);
  assert.strictEqual(row.slack_seconds, 60);
  assert.strictEqual(row.idle_seconds, 400);
  assert.strictEqual(row.break_seconds, 500);
});

check("scenario A: total excludes idle and break; submitted_at set", () => {
  const summary = toSummary(getSession(a.id));
  assert.strictEqual(summary.total_seconds, 1250 + 120 + 60);
  assert.strictEqual(summary.submitted_at, summary.ended_at);
  assert.strictEqual(summary.current_state, "ended");
});

// --- Scenario B: QA session closed without submitting -----------------------
let tb = T0 + sec(3000);
const b = startSession({ role: "qa", taskId: "task-B", environmentName: "Apple Notes", ts: tb });
endSession(b.id, "closed", tb + sec(60));

check("scenario B: closed session has no submitted time", () => {
  const row = getSession(b.id);
  assert.strictEqual(row.active_seconds, 60);
  assert.strictEqual(row.submitted_at, null);
  assert.notStrictEqual(row.ended_at, null);
});

// --- Scenario C: environment name fallback ---------------------------------
let tc = T0 + sec(4000);
const c = startSession({ role: "feedback", taskId: "task-C", ts: tc });

check("scenario C: environment name starts null, DOM fallback fills it", () => {
  assert.strictEqual(getSession(c.id).environment_name, null);
  setEnvironmentName(c.id, "Facebook");
  assert.strictEqual(getSession(c.id).environment_name, "Facebook");
});

// --- Scenario D: starting a session auto-closes the previous one ------------
let td = T0 + sec(5000);
const d = startSession({ role: "task_writing", taskId: "task-D", ts: td });

check("scenario D: previous open session auto-closed as 'closed'", () => {
  const prev = getSession(c.id);
  assert.notStrictEqual(prev.ended_at, null);
  assert.strictEqual(prev.submitted_at, null);
  assert.strictEqual(getOpenSession().id, d.id);
});

check("scenario D: same-state transition and post-end transitions are no-ops", () => {
  transitionState(d.id, "active", td + sec(10)); // same state: no-op
  assert.strictEqual(getSession(d.id).state_started_at, td);
  endSession(d.id, "closed", td + sec(20));
  transitionState(d.id, "guidelines", td + sec(30)); // ended: no-op
  assert.strictEqual(getSession(d.id).current_state, "ended");
});

// --- Scenario E: open-session summaries include live elapsed time -----------
let te = T0 + sec(6000);
const e = startSession({ role: "qa", taskId: "task-E", environmentName: "Notes", ts: te });

check("scenario E: toSummary folds in the running bucket", () => {
  const summary = toSummary(getSession(e.id), te + sec(30));
  assert.strictEqual(summary.active_seconds, 30);
  assert.strictEqual(summary.total_seconds, 30);
  // The DB row itself must be untouched.
  assert.strictEqual(getSession(e.id).active_seconds, 0);
});
endSession(e.id, "closed", te + sec(45));

// --- Daily summary -----------------------------------------------------------
check("daily summary: role and environment grouping with averages", () => {
  const daily = computeDailySummary(today);
  assert.strictEqual(daily.sessions.length, 5);

  const qa = daily.roles.find((r) => r.role === "qa");
  assert.ok(qa, "qa role group exists");
  assert.strictEqual(qa.sessionCount, 2);
  const appleNotes = qa.environments.find((env) => env.environmentName === "Apple Notes");
  assert.strictEqual(appleNotes.count, 1);
  assert.strictEqual(appleNotes.totalSeconds, 60);
  assert.strictEqual(qa.totalSeconds, 60 + 45);
  assert.strictEqual(qa.averageHandlingSeconds, (60 + 45) / 2);

  const tw = daily.roles.find((r) => r.role === "task_writing");
  assert.strictEqual(tw.sessionCount, 2); // task-A and task-D
  assert.strictEqual(tw.totalSeconds, 1430 + 20); // D banked 20s active before ending
});

check("daily summary: sessions outside the local day are excluded", () => {
  const rows = listSessionsForDay("2001-01-01");
  assert.strictEqual(rows.length, 0);
});

// --- Scenario F: URL-settle merge (session_update) ---------------------------
let tf = T0 + sec(7000);
const f = startSession({
  role: "qa",
  taskId: "provisional-id",
  environmentName: "Apple Notes",
  url: "https://fleetai.com/work/problems/qa/provisional-id",
  ts: tf,
});
transitionState(f.id, "guidelines", tf + sec(5)); // bank 5s active before the settle

check("scenario F: settled URL re-points the session in place", () => {
  updateOpenSessionTask(f.id, {
    taskId: "settled-id",
    projectTargetId: "proj-9",
    url: "https://fleetai.com/work/problems/qa/settled-id?project=proj-9",
  });
  const row = getSession(f.id);
  assert.strictEqual(row.task_id, "settled-id");
  assert.strictEqual(row.project_target_id, "proj-9");
  assert.strictEqual(row.url, "https://fleetai.com/work/problems/qa/settled-id?project=proj-9");
  // Identity only: start time, buckets, and state must be untouched.
  assert.strictEqual(row.started_at, tf);
  assert.strictEqual(row.active_seconds, 5);
  assert.strictEqual(row.current_state, "guidelines");
  // Environment name preserved when the update omits it…
  assert.strictEqual(row.environment_name, "Apple Notes");
  // …and overwritten when the update carries one.
  updateOpenSessionTask(f.id, { taskId: "settled-id", environmentName: "Apple Notes v2" });
  assert.strictEqual(getSession(f.id).environment_name, "Apple Notes v2");
});

check("scenario F: update on an ended session is a no-op", () => {
  endSession(f.id, "closed", tf + sec(60));
  updateOpenSessionTask(f.id, { taskId: "too-late" });
  assert.strictEqual(getSession(f.id).task_id, "settled-id");
});

// --- listLoggedDays ----------------------------------------------------------
check("listLoggedDays: groups by local day, newest first", () => {
  // Seed one session on a much earlier day (local noon to stay within it).
  const past = new Date(noon);
  past.setDate(past.getDate() - 3);
  const pastStart = past.getTime();
  const p = startSession({ role: "task_writing", taskId: "old-task", environmentName: "Facebook", ts: pastStart });
  endSession(p.id, "submitted", pastStart + sec(90));

  const days = listLoggedDays();
  assert.strictEqual(days.length, 2);
  assert.strictEqual(days[0].date, today); // newest first
  assert.strictEqual(days[1].date, localDateStr(past));
  assert.strictEqual(days[1].sessionCount, 1);
  assert.strictEqual(days[1].totalSeconds, 90);

  // Today: A(1430) + B(60) + C(1000) + D(20) + E(45) + F(60) = 6 sessions.
  assert.strictEqual(days[0].sessionCount, 6);
  assert.strictEqual(days[0].totalSeconds, 1430 + 60 + 1000 + 20 + 45 + 60);
});

// --- Scenario G: manual edit and delete --------------------------------------
let tg = T0 + sec(8000);
const g = startSession({ role: "task_writing", taskId: "task-G", ts: tg });
endSession(g.id, "closed", tg + sec(30));

check("scenario G: editSession updates fields and recomputed total", () => {
  editSession(g.id, {
    environmentName: "Edited Env",
    role: "qa",
    activeSeconds: 3600 + 120 + 5, // 1h 2m 5s
    guidelinesSeconds: 90,
    slackSeconds: 0,
  });
  const row = getSession(g.id);
  assert.strictEqual(row.environment_name, "Edited Env");
  assert.strictEqual(row.role, "qa");
  assert.strictEqual(row.active_seconds, 3725);
  assert.strictEqual(row.guidelines_seconds, 90);
  assert.strictEqual(toSummary(row).total_seconds, 3725 + 90);
  // started_at / ended_at untouched by edits
  assert.strictEqual(row.started_at, tg);
});

check("scenario G: edit clamps negative and non-numeric durations to 0", () => {
  editSession(g.id, {
    environmentName: "Edited Env",
    role: "qa",
    activeSeconds: -50,
    guidelinesSeconds: NaN,
    slackSeconds: 10,
  });
  const row = getSession(g.id);
  assert.strictEqual(row.active_seconds, 0);
  assert.strictEqual(row.guidelines_seconds, 0);
  assert.strictEqual(row.slack_seconds, 10);
});

check("scenario G: blank environment name stored as null", () => {
  editSession(g.id, { environmentName: "", role: "qa", activeSeconds: 1, guidelinesSeconds: 0, slackSeconds: 0 });
  assert.strictEqual(getSession(g.id).environment_name, null);
});

check("scenario G: deleteSession removes the row and its events", () => {
  const db = require("../dist-electron/db/index").getDb();
  assert.ok(db.prepare("SELECT count(*) AS c FROM state_events WHERE session_id = ?").get(g.id).c > 0);
  deleteSession(g.id);
  assert.strictEqual(getSession(g.id), undefined);
  assert.strictEqual(db.prepare("SELECT count(*) AS c FROM state_events WHERE session_id = ?").get(g.id).c, 0);
});

check("scenario G: deleting an open session clears the active session", () => {
  const open = startSession({ role: "qa", taskId: "task-H", ts: T0 + sec(9000) });
  deleteSession(open.id);
  assert.strictEqual(getOpenSession(), undefined);
});

// --- Scenario H: environment reset rotates instance_id, not the session ------
let th = T0 + sec(10000);
const h = startSession({
  role: "task_writing",
  taskId: "stable-uuid-1",
  instanceId: "env-key-AAA",
  url: "https://fleetai.com/work/problems/create?instance_id=env-key-AAA&task_project_target_id=stable-uuid-1",
  ts: th,
});
transitionState(h.id, "slack", th + sec(40)); // bank 40s active before the reset

check("scenario H: recording reset updates instance_id in place", () => {
  updateOpenSessionTask(h.id, {
    taskId: "stable-uuid-1",
    instanceId: "env-key-BBB",
    url: "https://fleetai.com/work/problems/create?instance_id=env-key-BBB&task_project_target_id=stable-uuid-1",
  });
  const row = getSession(h.id);
  assert.strictEqual(row.task_id, "stable-uuid-1");
  assert.strictEqual(row.instance_id, "env-key-BBB");
  assert.strictEqual(row.started_at, th);
  assert.strictEqual(row.active_seconds, 40);
  assert.strictEqual(row.current_state, "slack");
  // Still exactly one session for this task.
  const db = require("../dist-electron/db/index").getDb();
  assert.strictEqual(db.prepare("SELECT count(*) AS c FROM sessions WHERE task_id = 'stable-uuid-1'").get().c, 1);
});
endSession(h.id, "closed", th + sec(60));

console.log(`\n${passed} checks passed`);
