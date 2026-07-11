import type { SessionRow, SessionSummary } from "../electron/db/types";
import type { DailySummary, LoggedDay } from "../electron/db/summary";
import type { EditSessionFields } from "../electron/db/sessions";

export interface FleetTimeApi {
  getConfig(): Promise<{ port: number; token: string; darkMode: boolean; autoStartDisabled: boolean }>;
  getCurrentSession(): Promise<SessionSummary | null>;
  getTodaySessions(): Promise<SessionSummary[]>;
  getDailySummary(dateStr: string): Promise<DailySummary>;
  getLoggedDays(): Promise<LoggedDay[]>;
  editSession(sessionId: string, fields: EditSessionFields): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
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
