# FleetTime

Personal time tracker for Fleet AI task-writing, feedback, and QA sessions.
Auto-starts a timer when a Fleet AI environment loads, extracts the task ID
from the URL, and separately tracks time spent on the Guidelines page and the
Slack desktop app while a session is open.

## Architecture

- **Electron app** (`electron/`) — idle detection, Slack-focus detection,
  SQLite storage, and the dashboard/settings UI (`src/`, React).
- **Browser extension** (`extension/`) — Manifest V3 extension that detects
  Fleet AI navigation and reports session/guidelines events to the Electron
  app over a local WebSocket.

## Running it

```bash
npm install
npx electron-rebuild -f -w better-sqlite3   # only needed after `npm install`/on a new machine
npm start               # builds everything and launches the app
```

For development with hot renderer reload, run two terminals instead:

```bash
npm run dev             # terminal 1: Vite dev server for the dashboard UI
npm run electron:dev    # terminal 2: builds main process + launches with FLEETTIME_DEV=1
```

## Tests

```bash
npm test
```

Runs the session/summary duration unit tests. They execute under
`ELECTRON_RUN_AS_NODE` (Electron's bundled Node) because `better-sqlite3` is
ABI-rebuilt for Electron and won't load in the system Node.

On first launch, the app writes a pairing `port`/`token` to
`~/Library/Application Support/fleettime/config.json` (also shown in the
dashboard's Settings panel).

### Installing the browser extension

1. Chrome → `chrome://extensions` → enable Developer Mode → **Load unpacked**
   → select the `extension/` folder.
2. Open the extension's options page, paste in the port/token from the
   FleetTime dashboard's Settings panel, and save.
3. Open a Fleet AI task — the dashboard's current-session bar should update
   within a second or two.

### macOS permissions

The first time the Slack-focus watcher runs, macOS will prompt for
Accessibility/Screen Recording permission (required by `active-win` to read
the frontmost app). Grant it and restart the app if Slack-focus tracking
doesn't seem to register.

## Known open items (flagged in the plan, not blocking)

- `extension/content/session-page.js`'s environment-name and submit-button
  detection use best-effort DOM heuristics — verify/adjust the selectors
  against the real Fleet AI page.
- Screenshots, IP-based location logging, CSV/weekly/monthly export, and a
  system tray icon / "keep on top" toggle are deferred to phase 2.
