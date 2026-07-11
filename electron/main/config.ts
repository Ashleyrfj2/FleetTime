import { app } from "electron";
import { randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";

export interface AppConfig {
  port: number;
  token: string;
  darkMode: boolean;
  autoStartDisabled: boolean;
}

const DEFAULT_PORT = 47850;

function configPath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

export function loadConfig(): AppConfig {
  const file = configPath();
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    const config: AppConfig = {
      port: parsed.port ?? DEFAULT_PORT,
      token: parsed.token ?? randomBytes(16).toString("hex"),
      darkMode: parsed.darkMode ?? false,
      autoStartDisabled: parsed.autoStartDisabled ?? false,
    };
    // Persist any defaults we filled in — a freshly generated token that is
    // never saved would silently break extension pairing on every launch.
    if (parsed.token !== config.token || parsed.port !== config.port) {
      saveConfig(config);
    }
    return config;
  }
  const fresh: AppConfig = {
    port: DEFAULT_PORT,
    token: randomBytes(16).toString("hex"),
    darkMode: false,
    autoStartDisabled: false,
  };
  saveConfig(fresh);
  return fresh;
}

export function saveConfig(config: AppConfig): void {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}
