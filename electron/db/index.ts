import Database from "better-sqlite3";
import { app } from "electron";
import * as path from "path";
import { SCHEMA_SQL, SEED_ENVIRONMENTS, SESSIONS_COLUMNS, sessionsTableSql } from "./schema";

let db: Database.Database | null = null;

// FLEETTIME_DB_PATH lets tests point at :memory: and run outside a full
// Electron app (better-sqlite3 is ABI-rebuilt for Electron, so tests run via
// ELECTRON_RUN_AS_NODE, where electron.app is unavailable).
function resolveDbPath(): string {
  if (process.env.FLEETTIME_DB_PATH) return process.env.FLEETTIME_DB_PATH;
  return path.join(app.getPath("userData"), "fleettime.db");
}

// Columns added after the first release; CREATE TABLE IF NOT EXISTS won't
// touch an existing table, so bring older databases up to date here.
function migrate(database: Database.Database): void {
  const columns = (database.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!columns.includes("instance_id")) {
    database.exec("ALTER TABLE sessions ADD COLUMN instance_id TEXT");
  }

  // Databases created before the env_qa workflow have a CHECK constraint
  // limiting role to the original three values. CHECKs can't be altered in
  // SQLite, so rebuild the table once. Runs after the instance_id ALTER so
  // the old table always has every column SESSIONS_COLUMNS names.
  const tableSql =
    (
      database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get() as
        | { sql: string }
        | undefined
    )?.sql ?? "";
  if (/CHECK\s*\(\s*role\s+IN/i.test(tableSql)) {
    // state_events has a foreign key into sessions, so FK enforcement (on by
    // default in better-sqlite3) must be suspended for the drop-and-rename;
    // the pragma is a no-op inside a transaction, hence toggled outside it.
    database.pragma("foreign_keys = OFF");
    try {
      database.exec(`
        BEGIN;
        ${sessionsTableSql("sessions_new")};
        INSERT INTO sessions_new (${SESSIONS_COLUMNS}) SELECT ${SESSIONS_COLUMNS} FROM sessions;
        DROP TABLE sessions;
        ALTER TABLE sessions_new RENAME TO sessions;
        CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
        COMMIT;
      `);
    } catch (err) {
      database.exec("ROLLBACK");
      throw err;
    } finally {
      database.pragma("foreign_keys = ON");
    }
  }

  // Seed the environments dropdown: the standard list plus any names already
  // used on logged sessions, so existing logs' environments are selectable.
  const insert = database.prepare("INSERT OR IGNORE INTO environments (name) VALUES (?)");
  for (const name of SEED_ENVIRONMENTS) insert.run(name);
  const usedNames = database
    .prepare("SELECT DISTINCT environment_name FROM sessions WHERE environment_name IS NOT NULL")
    .all() as { environment_name: string }[];
  for (const row of usedNames) insert.run(row.environment_name);
}

export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(resolveDbPath());
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  migrate(db);
  return db;
}
