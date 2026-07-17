import { getDb } from "./index";

export interface EnvironmentRow {
  id: number;
  name: string;
  hidden: number; // 0 | 1 (SQLite boolean)
}

export function listEnvironments(): EnvironmentRow[] {
  return getDb().prepare("SELECT * FROM environments ORDER BY name COLLATE NOCASE").all() as EnvironmentRow[];
}

/** Adds an environment; a duplicate name (case-sensitive) is a no-op. */
export function addEnvironment(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  getDb().prepare("INSERT OR IGNORE INTO environments (name) VALUES (?)").run(trimmed);
}

/**
 * Removes an environment from the dropdown list. Session rows store the name
 * as a plain string, so historical logs keep displaying it.
 */
export function deleteEnvironment(id: number): void {
  getDb().prepare("DELETE FROM environments WHERE id = ?").run(id);
}

export function setEnvironmentHidden(id: number, hidden: boolean): void {
  getDb().prepare("UPDATE environments SET hidden = ? WHERE id = ?").run(hidden ? 1 : 0, id);
}
