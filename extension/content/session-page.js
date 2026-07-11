// Runs on https://fleetai.com/work/problems/* pages (task-writing, feedback,
// and QA sessions). Two jobs:
//   1. Best-effort extraction of a human-readable environment name (e.g.
//      "Apple Notes") since it isn't reliably present in the URL.
//   2. Detecting a submit button click so the background worker can log the
//      session as "submitted" instead of just "closed".
//
// ASSUMPTION TO VERIFY against the real page: the selectors below are
// guesses. Once the actual Fleet AI DOM is inspected, replace
// `guessEnvironmentName` with the real selector for the environment/project
// label, and confirm the submit button matcher below actually targets the
// real submit control.

function parseTaskIdFromLocation() {
  const url = new URL(location.href);
  return (
    url.searchParams.get("instance_id") ||
    url.searchParams.get("taskId") ||
    url.pathname.match(/\/qa\/([^/]+)$/)?.[1] ||
    null
  );
}

function guessEnvironmentName() {
  const candidates = [
    document.querySelector("[data-testid*='environment' i]"),
    document.querySelector("[class*='environment' i]"),
    document.querySelector("h1"),
  ].filter(Boolean);

  for (const el of candidates) {
    const text = el.textContent?.trim();
    if (text && text.length > 0 && text.length < 80) return text;
  }

  // Fall back to the page title, stripping a common " - Fleet AI" suffix.
  const title = document.title?.replace(/\s*[-|]\s*Fleet ?AI.*$/i, "").trim();
  return title || null;
}

function reportEnvironmentNameOnce() {
  const taskId = parseTaskIdFromLocation();
  if (!taskId) return;
  const environmentName = guessEnvironmentName();
  if (!environmentName) return;
  chrome.runtime.sendMessage({ type: "environment_detected", taskId, environmentName });
}

// The page is a SPA; give it a moment to render before reading the DOM, and
// retry a few times in case content streams in late.
let attempts = 0;
const interval = setInterval(() => {
  reportEnvironmentNameOnce();
  attempts += 1;
  if (attempts >= 10) clearInterval(interval);
}, 1000);

document.addEventListener(
  "click",
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button, [role='button']");
    if (!button) return;
    const label = button.textContent?.trim().toLowerCase() ?? "";
    if (/^submit\b/.test(label) || label.includes("submit")) {
      const taskId = parseTaskIdFromLocation();
      if (taskId) chrome.runtime.sendMessage({ type: "submit_clicked", taskId });
    }
  },
  true
);
