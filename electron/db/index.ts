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

export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(resolveDbPath());
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  return db;
}
