import { contextBridge, ipcRenderer } from "electron";

const api = {
  getConfig: () => ipcRenderer.invoke("config:get"),
  getCurrentSession: () => ipcRenderer.invoke("session:get-current"),
  getTodaySessions: () => ipcRenderer.invoke("sessions:get-today"),
  getDailySummary: (dateStr: string) => ipcRenderer.invoke("summary:get-daily", dateStr),
  getWeeklySummary: () => ipcRenderer.invoke("summary:get-weekly"),
  getLoggedDays: () => ipcRenderer.invoke("logs:get-days"),
  setDayNote: (dateStr: string, note: string) => ipcRenderer.invoke("notes:set", dateStr, note),
  editSession: (sessionId: string, fields: unknown) => ipcRenderer.invoke("session:edit", sessionId, fields),
  deleteSession: (sessionId: string) => ipcRenderer.invoke("session:delete", sessionId),
  setSessionEnvironment: (sessionId: string, name: string | null) =>
    ipcRenderer.invoke("session:set-environment", sessionId, name),
  getEnvironments: () => ipcRenderer.invoke("environments:list"),
  addEnvironment: (name: string) => ipcRenderer.invoke("environments:add", name),
  deleteEnvironment: (id: number) => ipcRenderer.invoke("environments:delete", id),
  setEnvironmentHidden: (id: number, hidden: boolean) =>
    ipcRenderer.invoke("environments:set-hidden", id, hidden),
  breakStart: () => ipcRenderer.invoke("break:start"),
  breakEnd: () => ipcRenderer.invoke("break:end"),
  setDarkMode: (enabled: boolean) => ipcRenderer.invoke("settings:set-dark-mode", enabled),
  setAutoStartDisabled: (disabled: boolean) => ipcRenderer.invoke("settings:set-auto-start-disabled", disabled),
  onLiveUpdate: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("live-update", listener);
    return () => ipcRenderer.removeListener("live-update", listener);
  },
};

export type FleetTimeApi = typeof api;

contextBridge.exposeInMainWorld("fleettime", api);
