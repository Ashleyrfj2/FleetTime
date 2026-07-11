export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('task_writing', 'feedback', 'qa')),
  task_id TEXT NOT NULL,
  instance_id TEXT,
  project_target_id TEXT,
  environment_name TEXT,
  url TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  submitted_at INTEGER,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  guidelines_seconds INTEGER NOT NULL DEFAULT 0,
  slack_seconds INTEGER NOT NULL DEFAULT 0,
  idle_seconds INTEGER NOT NULL DEFAULT 0,
  break_seconds INTEGER NOT NULL DEFAULT 0,
  current_state TEXT NOT NULL DEFAULT 'active' CHECK (current_state IN ('active', 'guidelines', 'slack', 'idle', 'break', 'ended')),
  state_started_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS state_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_state_events_session ON state_events(session_id);
`;
