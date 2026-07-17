import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { AppConfig, loadConfig, saveConfig } from "./config";
import { startWsServer } from "./wsServer";
import { startIdleWatcher } from "./idle";
import { startSlackFocusWatcher } from "./slackFocus";
import { createBreakWidget } from "./breakWidget";
import {
  getOpenSession,
  transitionState,
  listSessionsForDay,
  toSummary,
  editSession,
  deleteSession,
  setEnvironmentName,
  EditSessionFields,
} from "../db/sessions";
import {
  listEnvironments,
  addEnvironment,
  deleteEnvironment,
  setEnvironmentHidden,
} from "../db/environments";
import { computeDailySummary, computeWeeklySummary, listLoggedDays, setDayNote } from "../db/summary";

let dashboardWindow: BrowserWindow | null = null;

function broadcastLiveUpdate(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("live-update");
  }
}

function createDashboardWindow(): void {
  dashboardWindow = new BrowserWindow({
    width: 960,
    height: 680,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.FLEETTIME_DEV === "1") {
    dashboardWindow.loadURL("http://localhost:5173");
  } else {
    // __dirname is dist-electron/main; dist-renderer sits at the repo root.
    dashboardWindow.loadFile(path.join(__dirname, "../../dist-renderer/index.html"));
  }
}

// Local-timezone date string. toISOString() would give the UTC date, which is
// already "tomorrow" during evening sessions and would hide them from the
// dashboard's "today" views.
function todayStr(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

// A single shared config object: the WS server reads autoStartDisabled from
// the same instance the settings IPC handlers mutate, so toggles take effect
// immediately rather than after a restart.
function registerIpcHandlers(config: AppConfig): void {
  ipcMain.handle("config:get", () => ({
    port: config.port,
    token: config.token,
    darkMode: config.darkMode,
    autoStartDisabled: config.autoStartDisabled,
  }));

  ipcMain.handle("session:get-current", () => {
    const open = getOpenSession();
    return open ? toSummary(open) : null;
  });

  ipcMain.handle("sessions:get-today", () => listSessionsForDay(todayStr()));

  ipcMain.handle("summary:get-daily", (_event, dateStr: string) => computeDailySummary(dateStr ?? todayStr()));

  ipcMain.handle("logs:get-days", () => listLoggedDays());

  ipcMain.handle("summary:get-weekly", () => computeWeeklySummary());

  ipcMain.handle("notes:set", (_event, dateStr: string, note: string) => {
    setDayNote(String(dateStr), String(note ?? ""));
    broadcastLiveUpdate();
  });

  ipcMain.handle("session:edit", (_event, sessionId: string, fields: EditSessionFields) => {
    editSession(sessionId, fields);
    broadcastLiveUpdate();
  });

  ipcMain.handle("session:delete", (_event, sessionId: string) => {
    deleteSession(sessionId);
    broadcastLiveUpdate();
  });

  ipcMain.handle("session:set-environment", (_event, sessionId: string, name: string | null) => {
    setEnvironmentName(sessionId, name);
    broadcastLiveUpdate();
  });

  ipcMain.handle("environments:list", () => listEnvironments());

  ipcMain.handle("environments:add", (_event, name: string) => {
    addEnvironment(String(name ?? ""));
    broadcastLiveUpdate();
  });

  ipcMain.handle("environments:delete", (_event, id: number) => {
    deleteEnvironment(id);
    broadcastLiveUpdate();
  });

  ipcMain.handle("environments:set-hidden", (_event, id: number, hidden: boolean) => {
    setEnvironmentHidden(id, hidden);
    broadcastLiveUpdate();
  });

  ipcMain.handle("break:start", () => {
    const open = getOpenSession();
    if (open) transitionState(open.id, "break");
    broadcastLiveUpdate();
  });

  ipcMain.handle("break:end", () => {
    const open = getOpenSession();
    if (open && open.current_state === "break") transitionState(open.id, "active");
    broadcastLiveUpdate();
  });

  ipcMain.handle("settings:set-dark-mode", (_event, enabled: boolean) => {
    config.darkMode = enabled;
    saveConfig(config);
  });

  ipcMain.handle("settings:set-auto-start-disabled", (_event, disabled: boolean) => {
    config.autoStartDisabled = disabled;
    saveConfig(config);
  });
}

app.whenReady().then(() => {
  const config = loadConfig();

  registerIpcHandlers(config);
  createDashboardWindow();
  createBreakWidget();

  startWsServer(config, broadcastLiveUpdate);
  startIdleWatcher(broadcastLiveUpdate);
  startSlackFocusWatcher(broadcastLiveUpdate);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createDashboardWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
