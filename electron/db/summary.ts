import * as fs from "fs";
import * as path from "path";
import { SessionRole, SessionRow, SessionSummary } from "./types";
import { listSessionsForDay, listSessionsForRange, toSummary } from "./sessions";
import { getDb } from "./index";

export interface EnvironmentGroup {
  environmentName: string;
  count: number;
  totalSeconds: number;
}

export interface RoleGroup {
  role: SessionRole;
  environments: EnvironmentGroup[];
  totalSeconds: number;
  sessionCount: number;
  averageHandlingSeconds: number;
}

export interface DailySummary {
  date: string;
  totalSeconds: number;
  note: string;
  roles: RoleGroup[];
  sessions: SessionSummary[];
}

export function getDayNote(dateStr: string): string {
  const row = getDb().prepare("SELECT note FROM day_notes WHERE date = ?").get(dateStr) as
    | { note: string }
    | undefined;
  return row?.note ?? "";
}

/** Upserts the note for a local date; an empty note removes the row. */
export function setDayNote(dateStr: string, note: string): void {
  const trimmed = note.trim();
  if (!trimmed) {
    getDb().prepare("DELETE FROM day_notes WHERE date = ?").run(dateStr);
    return;
  }
  getDb()
    .prepare(
      `INSERT INTO day_notes (date, note, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`
    )
    .run(dateStr, trimmed, Date.now());
}

const ROLE_ORDER: SessionRole[] = ["task_writing", "qa", "env_qa", "feedback"];

export interface LoggedDay {
  date: string; // local YYYY-MM-DD
  totalSeconds: number;
  sessionCount: number;
}

// Same local-date format as todayStr() in electron/main/index.ts.
export function localDateStr(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Every day that has at least one logged session, newest first, with that
 * day's total tracked time (active + guidelines + slack) and session count.
 * Grouping happens in JS so the day boundary matches the local-timezone
 * convention used everywhere else.
 */
export function listLoggedDays(): LoggedDay[] {
  const rows = getDb()
    .prepare("SELECT * FROM sessions ORDER BY started_at DESC")
    .all() as SessionRow[];

  const days: LoggedDay[] = [];
  const byDate = new Map<string, LoggedDay>();
  for (const row of rows) {
    const date = localDateStr(row.started_at);
    let day = byDate.get(date);
    if (!day) {
      day = { date, totalSeconds: 0, sessionCount: 0 };
      byDate.set(date, day);
      days.push(day); // rows are newest-first, so days come out newest-first
    }
    day.totalSeconds += toSummary(row).total_seconds;
    day.sessionCount += 1;
  }
  return days;
}

// Hourly pay rates are personal information and load from rates.json at the
// repo root, which is gitignored (copy rates.example.json to create it).
// Missing file = all rates 0, so earnings simply display as $0.00.
function loadRates(): Record<SessionRole, number> {
  const defaults: Record<SessionRole, number> = { env_qa: 0, task_writing: 0, qa: 0, feedback: 0 };
  // __dirname is dist-electron/db at runtime; the repo root is two levels up.
  const file = path.join(__dirname, "../../rates.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    for (const role of Object.keys(defaults) as SessionRole[]) {
      if (typeof parsed[role] === "number" && parsed[role] >= 0) defaults[role] = parsed[role];
    }
  } catch {
    // Absent or malformed: keep zeros.
  }
  return defaults;
}

export const HOURLY_RATES = loadRates();

export interface WeeklySummary {
  weekStart: string; // Monday, local YYYY-MM-DD
  weekEnd: string; // Sunday, local YYYY-MM-DD
  totalSeconds: number;
  envQaSeconds: number;
  taskQaSeconds: number; // task_writing + qa + feedback
  envQaRate: number;
  taskQaRate: number;
  envQaEarnings: number;
  taskQaEarnings: number;
  totalEarnings: number;
}

/**
 * Monday–Sunday pay-period rollup for the week containing `dateStr` (defaults
 * to today). Earnings: Environmental QA time is rounded to the nearest minute
 * before multiplying by its rate, per the pay-period convention.
 */
export function computeWeeklySummary(dateStr?: string): WeeklySummary {
  const anchor = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const startMs = monday.getTime();
  const endMs = startMs + 7 * 24 * 60 * 60 * 1000;

  const sessions = listSessionsForRange(startMs, endMs);
  let envQaSeconds = 0;
  let taskQaSeconds = 0;
  for (const s of sessions) {
    if (s.role === "env_qa") envQaSeconds += s.total_seconds;
    else taskQaSeconds += s.total_seconds;
  }

  const envQaMinutes = Math.round(envQaSeconds / 60);
  const envQaEarnings = (envQaMinutes / 60) * HOURLY_RATES.env_qa;
  const taskQaEarnings = (taskQaSeconds / 3600) * HOURLY_RATES.task_writing;

  const sunday = new Date(startMs + 6 * 24 * 60 * 60 * 1000);
  return {
    weekStart: localDateStr(startMs),
    weekEnd: localDateStr(sunday.getTime()),
    totalSeconds: envQaSeconds + taskQaSeconds,
    envQaSeconds,
    taskQaSeconds,
    envQaRate: HOURLY_RATES.env_qa,
    taskQaRate: HOURLY_RATES.task_writing,
    envQaEarnings,
    taskQaEarnings,
    totalEarnings: envQaEarnings + taskQaEarnings,
  };
}

export function computeDailySummary(dateStr: string): DailySummary {
  const sessions = listSessionsForDay(dateStr);

  const byRole = new Map<SessionRole, SessionSummary[]>();
  for (const session of sessions) {
    const list = byRole.get(session.role) ?? [];
    list.push(session);
    byRole.set(session.role, list);
  }

  const roles: RoleGroup[] = ROLE_ORDER.filter((r) => byRole.has(r)).map((role) => {
    const roleSessions = byRole.get(role)!;
    const byEnv = new Map<string, EnvironmentGroup>();
    for (const s of roleSessions) {
      const envName = s.environment_name ?? "Unknown environment";
      const existing = byEnv.get(envName);
      if (existing) {
        existing.count += 1;
        existing.totalSeconds += s.total_seconds;
      } else {
        byEnv.set(envName, { environmentName: envName, count: 1, totalSeconds: s.total_seconds });
      }
    }
    const totalSeconds = roleSessions.reduce((sum, s) => sum + s.total_seconds, 0);
    return {
      role,
      environments: Array.from(byEnv.values()),
      totalSeconds,
      sessionCount: roleSessions.length,
      averageHandlingSeconds: roleSessions.length > 0 ? totalSeconds / roleSessions.length : 0,
    };
  });

  const totalSeconds = roles.reduce((sum, role) => sum + role.totalSeconds, 0);
  return { date: dateStr, totalSeconds, note: getDayNote(dateStr), roles, sessions };
}
