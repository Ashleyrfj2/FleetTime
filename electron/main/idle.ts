import { powerMonitor } from "electron";
import { getOpenSession, transitionState } from "../db/sessions";

const IDLE_THRESHOLD_SECONDS = 5 * 60;
const POLL_INTERVAL_MS = 15_000;

export function startIdleWatcher(onChange: () => void): NodeJS.Timeout {
  return setInterval(() => {
    const open = getOpenSession();
    if (!open) return;
    // A break is an explicit user action; inactivity must not convert it to
    // idle (both are excluded from totals, but the break should stay a break).
    if (open.current_state === "break") return;

    const idleSeconds = powerMonitor.getSystemIdleTime();

    if (idleSeconds >= IDLE_THRESHOLD_SECONDS && open.current_state !== "idle") {
      transitionState(open.id, "idle");
      onChange();
    } else if (idleSeconds < IDLE_THRESHOLD_SECONDS && open.current_state === "idle") {
      transitionState(open.id, "active");
      onChange();
    }
  }, POLL_INTERVAL_MS);
}
