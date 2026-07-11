import { getOpenSession, transitionState } from "../db/sessions";

const POLL_INTERVAL_MS = 2_000;
const SLACK_NAME_PATTERN = /slack/i;

// Loaded lazily: active-win ships as an ESM-only native-binding package,
// require()'d dynamically so a failure to resolve it (unsupported platform)
// doesn't crash the rest of the app.
type ActiveWindowResult = { owner?: { name?: string }; title?: string } | undefined;
type ActiveWinFn = () => Promise<ActiveWindowResult>;

function loadActiveWin(): ActiveWinFn | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("active-win");
    return (mod.default ?? mod) as ActiveWinFn;
  } catch (err) {
    console.warn("active-win unavailable; Slack focus tracking disabled.", err);
    return null;
  }
}

export function startSlackFocusWatcher(onChange: () => void): NodeJS.Timeout | null {
  const activeWin = loadActiveWin();
  if (!activeWin) return null;

  return setInterval(async () => {
    const open = getOpenSession();
    if (!open) return;
    if (open.current_state === "idle" || open.current_state === "break") return;

    let result: ActiveWindowResult;
    try {
      result = await activeWin();
    } catch {
      return;
    }

    const isSlackFocused = !!result?.owner?.name && SLACK_NAME_PATTERN.test(result.owner.name);

    if (isSlackFocused && open.current_state !== "slack") {
      transitionState(open.id, "slack");
      onChange();
    } else if (!isSlackFocused && open.current_state === "slack") {
      transitionState(open.id, "active");
      onChange();
    }
  }, POLL_INTERVAL_MS);
}
