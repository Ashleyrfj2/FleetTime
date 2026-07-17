const ROLE_LABELS = {
  task_writing: "Task Writing",
  feedback: "Feedback",
  qa: "QA",
  env_qa: "Environmental QA",
};

const STATE_LABELS = {
  active: "Working",
  guidelines: "Guidelines",
  slack: "Slack",
  idle: "Idle",
  break: "On break",
};

function elapsedLabel(startedAtMs) {
  const seconds = Math.max(0, Math.round((Date.now() - startedAtMs) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Same wording as the dashboard's formatDuration in src/format.ts, but
// compact (h/m/s) so four rows fit the small widget.
function durationLabel(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ");
}

function totalRow(label, seconds, emphasize) {
  const row = document.createElement("div");
  row.className = emphasize ? "total-row total-row-main" : "total-row";
  const name = document.createElement("span");
  name.textContent = label;
  const value = document.createElement("span");
  value.textContent = durationLabel(seconds);
  row.append(name, value);
  return row;
}

// Built with textContent, never innerHTML: environment_name originates from
// scraped Fleet page DOM text and must be treated as untrusted.
function render(session) {
  const content = document.getElementById("content");
  content.textContent = "";

  if (!session) {
    const empty = document.createElement("div");
    empty.id = "empty";
    empty.textContent = "No active session";
    content.appendChild(empty);
    return;
  }

  const role = document.createElement("div");
  role.id = "role";
  role.textContent = ROLE_LABELS[session.role] ?? session.role;

  const task = document.createElement("div");
  task.id = "task";
  task.textContent = session.environment_name ?? session.task_id;

  const state = document.createElement("div");
  state.id = "state";
  state.className = session.current_state;
  state.textContent = `${STATE_LABELS[session.current_state] ?? session.current_state} · ${elapsedLabel(
    session.state_started_at
  )}`;

  // Cumulative totals — these never reset when the state switches; the
  // elapsed label above is only "time in the current state".
  const totals = document.createElement("div");
  totals.id = "totals";
  totals.append(
    totalRow("Total session time", session.total_seconds, true),
    totalRow("Environment time", session.active_seconds, false),
    totalRow("Slack time", session.slack_seconds, false),
    totalRow("Guidelines time", session.guidelines_seconds, false)
  );

  const onBreak = session.current_state === "break";
  const breakBtn = document.createElement("button");
  breakBtn.id = "breakBtn";
  breakBtn.className = onBreak ? "end" : "start";
  breakBtn.textContent = onBreak ? "End Break" : "Start Break";
  breakBtn.addEventListener("click", async () => {
    if (onBreak) {
      await window.fleettime.breakEnd();
    } else {
      await window.fleettime.breakStart();
    }
    refresh();
  });

  content.append(role, task, state, totals, breakBtn);
}

async function refresh() {
  const session = await window.fleettime.getCurrentSession();
  render(session);
}

window.fleettime.onLiveUpdate(refresh);
refresh();
setInterval(refresh, 1000);
