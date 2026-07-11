// Tolerate subdomain variants (e.g. www.fleetai.com); a strict bare-domain
// match would silently disable all tracking if the site redirects to www.
function isFleetHost(hostname) {
  return hostname === "fleetai.com" || hostname.endsWith(".fleetai.com");
}

// Parses Fleet AI URLs into a session descriptor, or returns null if the URL
// isn't one of the "active session" pages. See the plan doc for the
// confirmed URL patterns this matches.
export function parseFleetUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!isFleetHost(u.hostname)) return null;

  if (u.pathname === "/work/problems/create" && u.searchParams.has("instance_id")) {
    return {
      role: "task_writing",
      taskId: u.searchParams.get("instance_id"),
      projectTargetId: u.searchParams.get("task_project_target_id") || undefined,
    };
  }

  if (u.pathname === "/work/problems/respond-feedback/edit" && u.searchParams.has("taskId")) {
    return {
      role: "feedback",
      taskId: u.searchParams.get("taskId"),
    };
  }

  const qaMatch = u.pathname.match(/^\/work\/problems\/qa\/([^/]+)$/);
  if (qaMatch) {
    return {
      role: "qa",
      taskId: qaMatch[1],
      projectTargetId: u.searchParams.get("project") || undefined,
      environmentName: u.searchParams.get("env") || undefined,
    };
  }

  return null;
}

export function isGuidelinesUrl(url) {
  try {
    const u = new URL(url);
    return isFleetHost(u.hostname) && u.pathname.startsWith("/work/guidelines");
  } catch {
    return false;
  }
}
