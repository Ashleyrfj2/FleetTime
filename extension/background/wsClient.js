// Thin WebSocket client to the local FleetTime Electron app, with a hello
// handshake and a queue so callers can fire-and-forget events before the
// connection (or the extension's stored pairing config) is ready.

let socket = null;
let ready = false;
let queue = [];
let reconnectDelay = 1000;
let reconnectTimer = null;

async function getPairing() {
  const { port, token } = await chrome.storage.local.get(["port", "token"]);
  return port && token ? { port, token } : null;
}

function flushQueue() {
  while (ready && queue.length > 0 && socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(queue.shift()));
  }
}

export async function ensureConnected() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const pairing = await getPairing();
  if (!pairing) return;

  socket = new WebSocket(`ws://127.0.0.1:${pairing.port}`);

  socket.addEventListener("open", () => {
    reconnectDelay = 1000;
    socket.send(JSON.stringify({ type: "hello", token: pairing.token }));
  });

  socket.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "hello_ack" && msg.ok) {
        ready = true;
        flushQueue();
      }
    } catch {
      // ignore malformed messages
    }
  });

  socket.addEventListener("close", scheduleReconnect);
  socket.addEventListener("error", scheduleReconnect);
}

function scheduleReconnect() {
  ready = false;
  socket = null;
  // Both 'close' and 'error' fire on a failed connection; a single pending
  // timer prevents two parallel reconnect loops opening duplicate sockets.
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
    ensureConnected();
  }, reconnectDelay);
}

export function sendEvent(message) {
  queue.push(message);
  ensureConnected().then(flushQueue);
}
