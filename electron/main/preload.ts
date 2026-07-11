import { contextBridge, ipcRenderer } from "electron";

const api = {
  getConfig: () => ipcRenderer.invoke("config:get"),
  getCurrentSession: () => ipcRenderer.invoke("session:get-current"),
  getTodaySessions: () => ipcRenderer.invoke("sessions:get-today"),
  getDailySummary: (dateStr: string) => ipcRenderer.invoke("summary:get-daily", dateStr),
  getLoggedDays: () => ipcRenderer.invoke("logs:get-days"),
  editSession: (sessionId: string, fields: unknown) => ipcRenderer.invoke("session:edit", sessionId, fields),
  deleteSession: (sessionId: string) => ipcRenderer.invoke("session:delete", sessionId),
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
