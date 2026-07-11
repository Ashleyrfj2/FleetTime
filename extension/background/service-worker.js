import { parseFleetUrl, isGuidelinesUrl } from "./fleetUrls.js";
import { sendEvent, ensureConnected } from "./wsClient.js";

const SUBMIT_GRACE_MS = 15_000;
// Fleet AI rewrites the environment URL ~10s after a QA/Task starts (the
// provisional instance ID settles). A same-tab session URL change within this
// window is the same session, not a new one.
const SETTLE_MS = 20_000;

// MV3 service workers are killed after ~30s of inactivity, and writers often
// sit on one environment page far longer than that. Tracking state therefore
// lives in chrome.storage.session (survives worker restarts, cleared when the
// browser exits); every event handler awaits loadState() before touching it,
// so a freshly restarted worker keeps attributing guidelines/submit/close
// events to the session that is still open on the Electron side.
let state = {
  sessionTabId: null,
  sessionInfo: null, // { role, taskId, projectTargetId, environmentName }
  sessionStartedTs: null,
  inGuidelines: false,
  lastSubmit: null, // { taskId, ts }
};
let stateLoaded = null;

function loadState() {
  if (!stateLoaded) {
    stateLoaded = chrome.storage.session
      .get("trackerState")
      .then((items) => {
        if (items && items.trackerState) state = items.trackerState;
      })
      .catch(() => {});
  }
  return stateLoaded;
}

function persistState() {
  chrome.storage.session.set({ trackerState: state }).catch(() => {});
}

function endCurrentSession() {
  if (!state.sessionInfo) return;
  const reason =
    state.lastSubmit &&
    state.lastSubmit.taskId === state.sessionInfo.taskId &&
    Date.now() - state.lastSubmit.ts < SUBMIT_GRACE_MS
      ? "submitted"
      : "closed";
  sendEvent({ type: "session_end", taskId: state.sessionInfo.taskId, reason, ts: Date.now() });
  state.sessionTabId = null;
  state.sessionInfo = null;
  state.sessionStartedTs = null;
  state.inGuidelines = false;
  persistState();
}

function startNewSession(tabId, parsed, url) {
  if (state.sessionInfo) endCurrentSession();
  state.sessionTabId = tabId;
  state.sessionInfo = parsed;
  state.sessionStartedTs = Date.now();
  state.inGuidelines = false;
  persistState();
  sendEvent({
    type: "session_start",
    role: parsed.role,
    taskId: parsed.taskId,
    instanceId: parsed.instanceId,
    projectTargetId: parsed.projectTargetId,
    environmentName: parsed.environmentName,
    url,
    ts: Date.now(),
  });
}

// The new URL replaces the previous one in place — one log entry, with the
// original start time and any already-banked sub-timer durations kept. Used
// both for the initial settle and for mid-session environment resets.
function updateCurrentSession(parsed, url) {
  state.sessionInfo = parsed;
  persistState();
  sendEvent({
    type: "session_update",
    taskId: parsed.taskId,
    instanceId: parsed.instanceId,
    projectTargetId: parsed.projectTargetId,
    environmentName: parsed.environmentName,
    url,
  });
}

async function handleUrlChange(tabId, url) {
  await loadState();
  const parsed = parseFleetUrl(url);

  if (parsed) {
    const isSameSession =
      state.sessionTabId === tabId &&
      state.sessionInfo &&
      state.sessionInfo.taskId === parsed.taskId &&
      state.sessionInfo.role === parsed.role;
    if (isSameSession) {
      // Same task, but the virtual-environment key rotates on every
      // recording stop/reset — keep the log's URL/instance current without
      // logging a separate session.
      if (parsed.instanceId !== state.sessionInfo.instanceId) {
        updateCurrentSession(parsed, url);
      }
      return;
    }

    const withinSettleWindow =
      state.sessionTabId === tabId &&
      state.sessionInfo &&
      state.sessionInfo.role === parsed.role &&
      state.sessionStartedTs !== null &&
      Date.now() - state.sessionStartedTs < SETTLE_MS;
    if (withinSettleWindow) {
      updateCurrentSession(parsed, url);
    } else {
      startNewSession(tabId, parsed, url);
    }
    return;
  }

  if (state.sessionTabId === tabId) endCurrentSession();
}

function setGuidelines(active) {
  if (state.inGuidelines === active) return;
  state.inGuidelines = active;
  persistState();
  sendEvent({ type: active ? "guidelines_start" : "guidelines_end", ts: Date.now() });
}

async function checkGuidelinesState() {
  await loadState();
  if (!state.sessionInfo) return;

  let activeTab;
  try {
    [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  } catch {
    return;
  }

  const focusedWindow = await chrome.windows.getLastFocused().catch(() => null);
  const chromeHasFocus = !!focusedWindow?.focused;

  if (!activeTab || !chromeHasFocus || activeTab.id === state.sessionTabId) {
    setGuidelines(false);
    return;
  }

  setGuidelines(isGuidelinesUrl(activeTab.url ?? ""));
}

chrome.webNavigation.onCompleted.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    handleUrlChange(details.tabId, details.url);
  },
  { url: [{ hostSuffix: "fleetai.com" }] }
);

chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    handleUrlChange(details.tabId, details.url);
  },
  { url: [{ hostSuffix: "fleetai.com" }] }
);

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await loadState();
  if (tabId === state.sessionTabId) endCurrentSession();
});

chrome.tabs.onActivated.addListener(() => checkGuidelinesState());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === "complete") checkGuidelinesState();
});
chrome.windows.onFocusChanged.addListener(() => checkGuidelinesState());

chrome.runtime.onMessage.addListener((message) => {
  (async () => {
    await loadState();
    if (message?.type === "environment_detected") {
      if (state.sessionInfo && state.sessionInfo.taskId === message.taskId && message.environmentName) {
        state.sessionInfo.environmentName = message.environmentName;
        persistState();
        sendEvent({
          type: "environment_detected",
          taskId: message.taskId,
          environmentName: message.environmentName,
        });
      }
    } else if (message?.type === "submit_clicked") {
      state.lastSubmit = { taskId: message.taskId, ts: Date.now() };
      persistState();
    }
  })();
});

// Service workers can be killed after ~30s idle; an alarm periodically wakes
// this one back up so the WS connection gets re-established promptly rather
// than only on the next Fleet AI navigation event.
chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepalive") ensureConnected();
});

ensureConnected();
