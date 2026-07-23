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

  // Environmental QA: deployed environments live on their own subdomains,
  // e.g. https://<id>.env.fleet-prod-xxx-us-east-1.fleetai.com/<any path>.
  // Identity is the host prefix up to .fleetai.com — the path (/home,
  // /dashboard/list, …) is in-deployment navigation, never a new session.
  if (u.hostname.includes(".env.")) {
    return {
      role: "env_qa",
      taskId: u.hostname.replace(/\.fleetai\.com$/i, ""),
    };
  }

  // Environmental QA (secondary scheme): a newer deployment style serves the
  // QA environment from the bare domain at /qa/<deployment-uuid> instead of an
  // .env. subdomain, e.g. https://fleetai.com/qa/168ce265-ff92-4e54-ac19-9f832fcdb444.
  // First seen 2026-07 and not yet confirmed stable across deployments — the
  // working assumption is that the /qa/ prefix holds and only the UUID changes
  // per deploy. Same env_qa role; the UUID is the session identity, so a new
  // deployment is a new session and in-deployment navigation stays one session.
  const envQaPathMatch = u.pathname.match(
    /^\/qa\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
  );
  if (envQaPathMatch) {
    return {
      role: "env_qa",
      taskId: envQaPathMatch[1],
    };
  }

  if (u.pathname === "/work/problems/create" && u.searchParams.has("instance_id")) {
    // instance_id is the *virtual environment* key — it changes every time
    // recording stops/resets within one task, so it must NOT be the session
    // identity or each reset logs separately. task_project_target_id is the
    // stable UUID for the task; fall back to instance_id only if it's absent
    // (the settle-window merge then re-points once it appears).
    const targetId = u.searchParams.get("task_project_target_id");
    const instanceId = u.searchParams.get("instance_id");
    return {
      role: "task_writing",
      taskId: targetId || instanceId,
      instanceId,
      projectTargetId: targetId || undefined,
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
