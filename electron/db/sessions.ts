import { randomUUID } from "crypto";
import { getDb } from "./index";
import { SessionRow, SessionState, SessionSummary, StartSessionInput } from "./types";

const BUCKET_COLUMN: Record<Exclude<SessionState, "ended">, string | null> = {
  active: "active_seconds",
  guidelines: "guidelines_seconds",
  slack: "slack_seconds",
  idle: "idle_seconds",
  break: "break_seconds",
};

function now(): number {
  return Date.now();
}

export function getOpenSession(): SessionRow | undefined {
  return getDb()
    .prepare("SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1")
    .get() as SessionRow | undefined;
}

export function getSession(id: string): SessionRow | undefined {
  return getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
}

/**
 * Moves the given open session's current_state to `toState`, crediting the
 * elapsed time since the last transition to the bucket it's leaving.
 */
export function transitionState(sessionId: string, toState: SessionState, ts: number = now()): void {
  const db = getDb();
  const session = getSession(sessionId);
  if (!session || session.ended_at !== null) return;
  if (session.current_state === toState) return;

  const delta = Math.max(0, Math.round((ts - session.state_started_at) / 1000));
  const fromColumn = BUCKET_COLUMN[session.current_state as Exclude<SessionState, "ended">];

  const tx = db.transaction(() => {
    if (fromColumn && delta > 0) {
      db.prepare(`UPDATE sessions SET ${fromColumn} = ${fromColumn} + ? WHERE id = ?`).run(delta, sessionId);
    }
    db.prepare("UPDATE sessions SET current_state = ?, state_started_at = ? WHERE id = ?").run(
      toState,
      ts,
      sessionId
    );
    db.prepare(
      "INSERT INTO state_events (session_id, from_state, to_state, ts) VALUES (?, ?, ?, ?)"
    ).run(sessionId, session.current_state, toState, ts);
  });
  tx();
}

export function startSession(input: StartSessionInput): SessionRow {
  const ts = input.ts ?? now();
  const existing = getOpenSession();
  if (existing) {
    endSession(existing.id, "closed", ts);
  }

  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, role, task_id, instance_id, project_target_id, environment_name, url, started_at, current_state, state_started_at)
       VALUES (@id, @role, @task_id, @instance_id, @project_target_id, @environment_name, @url, @started_at, 'active', @started_at)`
    )
    .run({
      id,
      role: input.role,
      task_id: input.taskId,
      instance_id: input.instanceId ?? null,
      project_target_id: input.projectTargetId ?? null,
      environment_name: input.environmentName ?? null,
      url: input.url ?? null,
      started_at: ts,
    });

  return getSession(id)!;
}

export function endSession(sessionId: string, reason: "submitted" | "closed", ts: number = now()): void {
  const session = getSession(sessionId);
  if (!session || session.ended_at !== null) return;

  // Credit whatever bucket the session was in right up to the end.
  transitionState(sessionId, "ended", ts);

  getDb()
    .prepare("UPDATE sessions SET ended_at = ?, submitted_at = ? WHERE id = ?")
    .run(ts, reason === "submitted" ? ts : null, sessionId);
}

export function setEnvironmentName(sessionId: string, environmentName: string | null): void {
  const name = environmentName?.trim() || null;
  getDb().prepare("UPDATE sessions SET environment_name = ? WHERE id = ?").run(name, sessionId);
}

/**
 * Re-points an open session at a settled task identity (Fleet AI rewrites the
 * URL ~10s after an environment starts). Only identity fields change;
 * started_at, all time buckets, and the current state are preserved so the
 * provisional and settled URLs count as one log.
 */
export function updateOpenSessionTask(
  sessionId: string,
  fields: {
    taskId: string;
    instanceId?: string | null;
    projectTargetId?: string | null;
    url?: string | null;
    environmentName?: string | null;
  }
): void {
  const session = getSession(sessionId);
  if (!session || session.ended_at !== null) return;

  getDb()
    .prepare(
      `UPDATE sessions SET
         task_id = @task_id,
         instance_id = COALESCE(@instance_id, instance_id),
         project_target_id = COALESCE(@project_target_id, project_target_id),
         url = COALESCE(@url, url),
         environment_name = COALESCE(@environment_name, environment_name)
       WHERE id = @id`
    )
    .run({
      id: sessionId,
      task_id: fields.taskId,
      instance_id: fields.instanceId ?? null,
      project_target_id: fields.projectTargetId ?? null,
      url: fields.url ?? null,
      environment_name: fields.environmentName ?? null,
    });
}

export interface EditSessionFields {
  environmentName: string | null;
  role: SessionRow["role"];
  activeSeconds: number;
  guidelinesSeconds: number;
  slackSeconds: number;
}

/** Manual correction of a logged session from the dashboard's Edit form. */
export function editSession(sessionId: string, fields: EditSessionFields): void {
  const clamp = (n: number) => Math.max(0, Math.floor(Number(n) || 0));
  getDb()
    .prepare(
      `UPDATE sessions SET
         environment_name = @environment_name,
         role = @role,
         active_seconds = @active_seconds,
         guidelines_seconds = @guidelines_seconds,
         slack_seconds = @slack_seconds
       WHERE id = @id`
    )
    .run({
      id: sessionId,
      environment_name: fields.environmentName || null,
      role: fields.role,
      active_seconds: clamp(fields.activeSeconds),
      guidelines_seconds: clamp(fields.guidelinesSeconds),
      slack_seconds: clamp(fields.slackSeconds),
    });
}

/** Permanently removes a session and its transition history. */
export function deleteSession(sessionId: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM state_events WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  });
  tx();
}

export function totalSeconds(session: SessionRow): number {
  return session.active_seconds + session.guidelines_seconds + session.slack_seconds;
}

/**
 * Snapshot of a session for display. For a still-open session, the elapsed
 * time in the current (not yet banked) state is folded into its bucket so the
 * dashboard doesn't under-report a running session.
 */
export function toSummary(session: SessionRow, nowTs: number = now()): SessionSummary {
  const live: SessionRow = { ...session };
  if (live.ended_at === null && live.current_state !== "ended") {
    const delta = Math.max(0, Math.round((nowTs - live.state_started_at) / 1000));
    const column = BUCKET_COLUMN[live.current_state as Exclude<SessionState, "ended">];
    if (column && delta > 0) {
      (live as unknown as Record<string, number>)[column] += delta;
    }
  }
  return { ...live, total_seconds: totalSeconds(live) };
}

export function listSessionsForRange(startMs: number, endMs: number): SessionSummary[] {
  const rows = getDb()
    .prepare("SELECT * FROM sessions WHERE started_at >= ? AND started_at < ? ORDER BY started_at ASC")
    .all(startMs, endMs) as SessionRow[];
  return rows.map((row) => toSummary(row));
}

export function listSessionsForDay(dateStr: string): SessionSummary[] {
  const start = new Date(`${dateStr}T00:00:00`).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  return listSessionsForRange(start, end);
}
