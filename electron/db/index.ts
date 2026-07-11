import Database from "better-sqlite3";
import { app } from "electron";
import * as path from "path";
import { SCHEMA_SQL } from "./schema";

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
}

export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(resolveDbPath());
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  migrate(db);
  return db;
}
