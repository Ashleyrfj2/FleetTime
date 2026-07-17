import type { SessionRow, SessionSummary } from "../electron/db/types";
import type { DailySummary, LoggedDay, WeeklySummary } from "../electron/db/summary";
import type { EditSessionFields } from "../electron/db/sessions";
import type { EnvironmentRow } from "../electron/db/environments";

export interface FleetTimeApi {
  getConfig(): Promise<{ port: number; token: string; darkMode: boolean; autoStartDisabled: boolean }>;
  getCurrentSession(): Promise<SessionSummary | null>;
  getTodaySessions(): Promise<SessionSummary[]>;
  getDailySummary(dateStr: string): Promise<DailySummary>;
  getWeeklySummary(): Promise<WeeklySummary>;
  getLoggedDays(): Promise<LoggedDay[]>;
  setDayNote(dateStr: string, note: string): Promise<void>;
  editSession(sessionId: string, fields: EditSessionFields): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  setSessionEnvironment(sessionId: string, name: string | null): Promise<void>;
  getEnvironments(): Promise<EnvironmentRow[]>;
  addEnvironment(name: string): Promise<void>;
  deleteEnvironment(id: number): Promise<void>;
  setEnvironmentHidden(id: number, hidden: boolean): Promise<void>;
  breakStart(): Promise<void>;
  breakEnd(): Promise<void>;
  setDarkMode(enabled: boolean): Promise<void>;
  setAutoStartDisabled(disabled: boolean): Promise<void>;
  onLiveUpdate(callback: () => void): () => void;
}

declare global {
  interface Window {
    fleettime: FleetTimeApi;
  }
}
