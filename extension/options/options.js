const portInput = document.getElementById("port");
const tokenInput = document.getElementById("token");
const status = document.getElementById("status");

async function load() {
  const { port, token } = await chrome.storage.local.get(["port", "token"]);
  if (port) portInput.value = port;
  if (token) tokenInput.value = token;
}

document.getElementById("save").addEventListener("click", async () => {
  const port = Number(portInput.value);
  const token = tokenInput.value.trim();
  if (!port || !token) {
    status.textContent = "Enter both a port and a token.";
    return;
  }
  await chrome.storage.local.set({ port, token });
  status.textContent = "Saved. The extension will connect on the next Fleet AI page load.";
});

load();
