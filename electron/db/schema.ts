// Role validity is enforced in TypeScript (SessionRole), not by a CHECK —
// SQLite CHECKs can't be altered, and the original role CHECK forced a full
// table rebuild when the env_qa workflow was added (see migrate()).
export function sessionsTableSql(tableName: string): string {
  return `CREATE TABLE IF NOT EXISTS ${tableName} (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
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
)`;
}

export const SESSIONS_COLUMNS =
  "id, role, task_id, instance_id, project_target_id, environment_name, url, started_at, ended_at, submitted_at, " +
  "active_seconds, guidelines_seconds, slack_seconds, idle_seconds, break_seconds, current_state, state_started_at";

export const SCHEMA_SQL = `
${sessionsTableSql("sessions")};

CREATE TABLE IF NOT EXISTS state_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS environments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  hidden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS day_notes (
  date TEXT PRIMARY KEY,
  note TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_state_events_session ON state_events(session_id);
`;

// Pre-seeded environment names are loaded from seed-environments.json at the
// repo root. That file is gitignored because real environment names are
// confidential company information and must never land in the public repo —
// copy seed-environments.example.json to create it. Missing file = no seeds
// (environments can always be added via Settings). Inserts are idempotent,
// and names already present on logged sessions get seeded too.
import * as fs from "fs";
import * as path from "path";

function loadSeedEnvironments(): string[] {
  // __dirname is dist-electron/db at runtime; the repo root is two levels up.
  const file = path.join(__dirname, "../../seed-environments.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Array.isArray(parsed)) return parsed.filter((n) => typeof n === "string" && n.trim());
  } catch {
    // Absent or malformed: start with no seeds.
  }
  return [];
}

export const SEED_ENVIRONMENTS = loadSeedEnvironments();
