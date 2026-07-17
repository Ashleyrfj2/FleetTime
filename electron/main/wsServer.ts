import { WebSocketServer, WebSocket } from "ws";
import { AppConfig } from "./config";
import {
  startSession,
  endSession,
  transitionState,
  getOpenSession,
  setEnvironmentName,
  updateOpenSessionTask,
} from "../db/sessions";
import { SessionRole } from "../db/types";

type IncomingMessage =
  | { type: "hello"; token: string }
  | {
      type: "session_start";
      role: SessionRole;
      taskId: string;
      instanceId?: string;
      projectTargetId?: string;
      environmentName?: string;
      url?: string;
      ts?: number;
    }
  | {
      type: "session_update";
      taskId: string;
      instanceId?: string;
      projectTargetId?: string;
      environmentName?: string;
      url?: string;
    }
  | { type: "session_end"; taskId: string; reason: "submitted" | "closed"; ts?: number }
  | { type: "guidelines_start"; ts?: number }
  | { type: "guidelines_end"; ts?: number }
  | { type: "environment_detected"; taskId: string; environmentName: string };

export function startWsServer(config: AppConfig, onChange: () => void): WebSocketServer {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: config.port });

  // Without an error listener, an EADDRINUSE (or any socket error) is an
  // unhandled 'error' event and crashes the whole app.
  wss.on("error", (err) => {
    console.error("FleetTime WS server error (extension events will not be received):", err.message);
  });

  wss.on("connection", (socket: WebSocket) => {
    let authed = false;

    socket.on("error", (err) => {
      console.error("FleetTime WS socket error:", err.message);
    });

    socket.on("message", (raw: Buffer) => {
      let msg: IncomingMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (!authed) {
        if (msg.type === "hello" && msg.token === config.token) {
          authed = true;
          socket.send(JSON.stringify({ type: "hello_ack", ok: true }));
        } else {
          socket.send(JSON.stringify({ type: "hello_ack", ok: false }));
          socket.close();
        }
        return;
      }

      if (config.autoStartDisabled && msg.type === "session_start") {
        return;
      }

      switch (msg.type) {
        case "session_start":
          startSession({
            role: msg.role,
            taskId: msg.taskId,
            instanceId: msg.instanceId,
            projectTargetId: msg.projectTargetId,
            environmentName: msg.environmentName,
            url: msg.url,
            ts: msg.ts,
          });
          onChange();
          break;
        case "session_update": {
          // The Fleet page URL settles shortly after an environment starts;
          // re-point the open session instead of logging a second entry.
          const open = getOpenSession();
          if (open) {
            updateOpenSessionTask(open.id, {
              taskId: msg.taskId,
              instanceId: msg.instanceId,
              projectTargetId: msg.projectTargetId,
              environmentName: msg.environmentName,
              url: msg.url,
            });
            onChange();
          }
          break;
        }
        case "session_end": {
          const open = getOpenSession();
          if (open && open.task_id === msg.taskId) {
            endSession(open.id, msg.reason, msg.ts);
            onChange();
          }
          break;
        }
        case "guidelines_start": {
          const open = getOpenSession();
          // Never yank a session out of a manual break; the user ends breaks
          // explicitly via the widget. env_qa is single-timer: no guidelines.
          if (open && open.current_state !== "break" && open.role !== "env_qa") {
            transitionState(open.id, "guidelines", msg.ts);
            onChange();
          }
          break;
        }
        case "guidelines_end": {
          const open = getOpenSession();
          if (open && open.current_state === "guidelines") {
            transitionState(open.id, "active", msg.ts);
            onChange();
          }
          break;
        }
        case "environment_detected": {
          const open = getOpenSession();
          if (open && open.task_id === msg.taskId && !open.environment_name) {
            setEnvironmentName(open.id, msg.environmentName);
            onChange();
          }
          break;
        }
      }
    });
  });

  return wss;
}
