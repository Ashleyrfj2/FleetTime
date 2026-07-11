export type SessionRole = "task_writing" | "feedback" | "qa";

export type SessionState = "active" | "guidelines" | "slack" | "idle" | "break" | "ended";

export interface SessionRow {
  id: string;
  role: SessionRole;
  task_id: string;
  instance_id: string | null;
  project_target_id: string | null;
  environment_name: string | null;
  url: string | null;
  started_at: number;
  ended_at: number | null;
  submitted_at: number | null;
  active_seconds: number;
  guidelines_seconds: number;
  slack_seconds: number;
  idle_seconds: number;
  break_seconds: number;
  current_state: SessionState;
  state_started_at: number;
}

export interface StartSessionInput {
  role: SessionRole;
  taskId: string;
  instanceId?: string | null;
  projectTargetId?: string | null;
  environmentName?: string | null;
  url?: string | null;
  ts?: number;
}

export interface SessionSummary extends SessionRow {
  total_seconds: number;
}
