import { BrowserWindow } from "electron";
import * as path from "path";

export function createBreakWidget(): BrowserWindow {
  const widget = new BrowserWindow({
    width: 280,
    height: 235,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  widget.loadFile(path.join(__dirname, "widget.html"));
  widget.setAlwaysOnTop(true, "floating");
  return widget;
}
