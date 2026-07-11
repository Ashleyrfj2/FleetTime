import { SessionRole, SessionRow, SessionSummary } from "./types";
import { listSessionsForDay, toSummary } from "./sessions";
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
  roles: RoleGroup[];
  sessions: SessionSummary[];
}

const ROLE_ORDER: SessionRole[] = ["task_writing", "qa", "feedback"];

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

  return { date: dateStr, roles, sessions };
}
