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

check("task-writing URL parses with instance_id and project target", () => {
  const r = parseFleetUrl(
    "https://fleetai.com/work/problems/create?instance_id=ABC123&task_project_target_id=11111111-2222-3333-4444-555555555555"
  );
  assert.strictEqual(r.role, "task_writing");
  assert.strictEqual(r.taskId, "ABC123");
  assert.strictEqual(r.projectTargetId, "11111111-2222-3333-4444-555555555555");
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
  assert.strictEqual(parseFleetUrl("https://www.fleetai.com/work/problems/create?instance_id=X").role, "task_writing");
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

check("guidelines URLs detected, others not", () => {
  assert.strictEqual(isGuidelinesUrl("https://fleetai.com/work/guidelines"), true);
  assert.strictEqual(isGuidelinesUrl("https://fleetai.com/work/guidelines?doc=abc"), true);
  assert.strictEqual(isGuidelinesUrl("https://fleetai.com/work"), false);
  assert.strictEqual(isGuidelinesUrl("https://evil.example/work/guidelines"), false);
});

console.log(`\n${passed} checks passed`);
