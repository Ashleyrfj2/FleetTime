// Unit tests for the extension's Fleet AI URL matching, covering the three
// confirmed session URL patterns, the guidelines page, and adversarial hosts.
// Runs under plain Node: node test/fleetUrls.test.mjs

import assert from "assert";
import { parseFleetUrl, isGuidelinesUrl } from "../extension/background/fleetUrls.js";

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
}

check("task-writing identity is the stable task_project_target_id, not the volatile instance_id", () => {
  const r = parseFleetUrl(
    "https://fleetai.com/work/problems/create?instance_id=ABC123&task_project_target_id=11111111-2222-3333-4444-555555555555"
  );
  assert.strictEqual(r.role, "task_writing");
  assert.strictEqual(r.taskId, "11111111-2222-3333-4444-555555555555");
  assert.strictEqual(r.instanceId, "ABC123");
  assert.strictEqual(r.projectTargetId, "11111111-2222-3333-4444-555555555555");
});

check("task-writing falls back to instance_id when the target id is absent", () => {
  const r = parseFleetUrl("https://fleetai.com/work/problems/create?instance_id=ABC123");
  assert.strictEqual(r.taskId, "ABC123");
  assert.strictEqual(r.instanceId, "ABC123");
  assert.strictEqual(r.projectTargetId, undefined);
});

check("an environment reset (new instance_id, same target) keeps the same identity", () => {
  const before = parseFleetUrl(
    "https://fleetai.com/work/problems/create?instance_id=AAA&task_project_target_id=uuid-1"
  );
  const after = parseFleetUrl(
    "https://fleetai.com/work/problems/create?instance_id=BBB&task_project_target_id=uuid-1"
  );
  assert.strictEqual(before.taskId, after.taskId);
  assert.notStrictEqual(before.instanceId, after.instanceId);
});

check("feedback edit URL parses with taskId", () => {
  const r = parseFleetUrl("https://fleetai.com/work/problems/respond-feedback/edit?taskId=aaaa-bbbb");
  assert.strictEqual(r.role, "feedback");
  assert.strictEqual(r.taskId, "aaaa-bbbb");
});

check("QA URL parses task ID from the path segment", () => {
  const r = parseFleetUrl("https://fleetai.com/work/problems/qa/qa-task-1?env=apple-notes&project=proj-1");
  assert.deepStrictEqual(r, {
    role: "qa",
    taskId: "qa-task-1",
    projectTargetId: "proj-1",
    environmentName: "apple-notes",
  });
});

check("www subdomain is accepted", () => {
  assert.strictEqual(
    parseFleetUrl("https://www.fleetai.com/work/problems/create?instance_id=X&task_project_target_id=y").role,
    "task_writing"
  );
});

check("non-session pages return null", () => {
  assert.strictEqual(parseFleetUrl("https://fleetai.com/work/problems/create-instance"), null);
  assert.strictEqual(parseFleetUrl("https://fleetai.com/work"), null);
  assert.strictEqual(parseFleetUrl("not a url"), null);
});

check("lookalike hosts are rejected", () => {
  assert.strictEqual(parseFleetUrl("https://evilfleetai.com/work/problems/create?instance_id=X"), null);
  assert.strictEqual(parseFleetUrl("https://fleetai.com.evil.example/work/problems/create?instance_id=X"), null);
});

check("environmental QA: deployment host parses with host-prefix identity", () => {
  const r = parseFleetUrl("https://abc123def456.env.fleet-prod-7hq-us-east-1.fleetai.com/");
  assert.strictEqual(r.role, "env_qa");
  assert.strictEqual(r.taskId, "abc123def456.env.fleet-prod-7hq-us-east-1");
});

check("environmental QA: in-deployment paths are the same session", () => {
  const root = parseFleetUrl("https://abc123def456.env.fleet-prod-7hq-us-east-1.fleetai.com/");
  const home = parseFleetUrl("https://abc123def456.env.fleet-prod-7hq-us-east-1.fleetai.com/home");
  const deep = parseFleetUrl("https://abc123def456.env.fleet-prod-7hq-us-east-1.fleetai.com/dashboard/list?tab=2");
  assert.strictEqual(root.taskId, home.taskId);
  assert.strictEqual(home.taskId, deep.taskId);
});

check("environmental QA: different deployment id is a different session", () => {
  const a = parseFleetUrl("https://aaa.env.fleet-prod-7hq-us-east-1.fleetai.com/");
  const b = parseFleetUrl("https://bbb.env.fleet-prod-7hq-us-east-1.fleetai.com/");
  assert.notStrictEqual(a.taskId, b.taskId);
});

check("environmental QA: lookalike host is rejected, www is not env_qa", () => {
  assert.strictEqual(parseFleetUrl("https://x.env.fleet-prod-1-us-east-1.fleetai.com.evil.example/"), null);
  assert.notStrictEqual(parseFleetUrl("https://www.fleetai.com/work/problems/create?instance_id=X")?.role, "env_qa");
});

check("guidelines URLs detected, others not", () => {
  assert.strictEqual(isGuidelinesUrl("https://fleetai.com/work/guidelines"), true);
  assert.strictEqual(isGuidelinesUrl("https://fleetai.com/work/guidelines?doc=abc"), true);
  assert.strictEqual(isGuidelinesUrl("https://fleetai.com/work"), false);
  assert.strictEqual(isGuidelinesUrl("https://evil.example/work/guidelines"), false);
});

console.log(`\n${passed} checks passed`);
