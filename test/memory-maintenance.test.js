const { test } = require("node:test");
const assert = require("node:assert/strict");
const m = require("../electron/memory-maintenance");

test("protected prefixes: decisions never deleted, others merge first", () => {
  assert.deepEqual(
    [...m.PROTECTED_PREFIXES].sort(),
    [
      "_prompts/",
      "_rules/",
      "claude-memory/",
      "decisions/",
      "preferences/",
      "procedures/",
      "profile/",
      "review/",
    ].sort(),
  );
  assert.equal(m.protectionFor("decisions/a.md"), "never");
  assert.equal(m.protectionFor("_rules/x.md"), "merge");
  assert.equal(m.protectionFor("procedures/x.md"), "merge");
  assert.equal(m.protectionFor("notes/x.md"), "none");
  assert.equal(m.protectionFor("sessions/x.md"), "none");
});

test("isTestProject matches probe/canary", () => {
  for (const n of ["my-probe", "Canary1", "beagledock-probes"])
    assert.equal(m.isTestProject(n), true, n);
  for (const n of ["dronline", "BeagleDock", ""]) assert.equal(m.isTestProject(n), false, n);
});

test("canPurgeProject refuses _global and underscore names", () => {
  assert.equal(m.canPurgeProject("_global", "x"), false);
  assert.equal(m.canPurgeProject("default", "_global"), false);
  assert.equal(m.canPurgeProject("default", "_hidden"), false);
  assert.equal(m.canPurgeProject("", "x"), false);
  assert.equal(m.canPurgeProject("default", "AcmeApp"), true);
});

test("maintenance prompt carries scope, limits and plan-mode wait", () => {
  const plan = m.buildMaintenancePrompt({ workspace: "default", project: "AcmeApp", mode: "plan", maxDeletions: 25 });
  assert.match(plan, /workspace="default", project="AcmeApp"/);
  assert.match(plan, /at most 25 page deletions/);
  assert.match(plan, /no_llm=true/);
  assert.match(plan, /dry_run=true/);
  assert.match(plan, /WAIT for the user's approval/);
  assert.match(plan, /NEVER delete pages in `decisions\/\*`/);
  assert.match(plan, /ai-memory-learning-maintenance/);
  assert.match(plan, /ONE ai-memory call/);
  assert.match(plan, /_prompts\/consolidation\.md/);
  const exec = m.buildMaintenancePrompt({ workspace: "a", project: "b", mode: "execute", maxDeletions: 5 });
  assert.doesNotMatch(exec, /WAIT for the user's approval/);
  assert.match(exec, /run with a limit/i);
});

test("deleteConfirmationError requires the exact page path for protected prefixes", () => {
  for (const path of ["decisions/a.md", "_rules/a.md", "review/a.md", "claude-memory/a.md", "procedures/a.md", "profile/a.md", "preferences/a.md", "_prompts/a.md"]) {
    assert.match(m.deleteConfirmationError(path, undefined), /Protected/, path);
    assert.match(m.deleteConfirmationError(path, "outra/pagina.md"), /Protected/, path);
    assert.match(m.deleteConfirmationError(path, true), /Protected/, path);
    assert.equal(m.deleteConfirmationError(path, path), null, path);
  }
  assert.equal(m.deleteConfirmationError("notes/a.md", undefined), null);
  assert.equal(m.deleteConfirmationError("sessions/a.md"), null);
});

test("main delete handler enforces the server-side confirmation", () => {
  const source = require("fs").readFileSync(require("path").join(__dirname, "../electron/main.js"), "utf8");
  const handler = source.slice(source.indexOf('handle("ai-memory-delete-page"'), source.indexOf('handle("ai-memory-purge-project"'));
  assert.match(handler, /confirmProtected/);
  assert.match(handler, /deleteConfirmationError\(\s*pagePath,\s*confirmProtected/);
  assert.ok(handler.indexOf("deleteConfirmationError") < handler.indexOf("runAiMemoryJson"));
});

test("memory rules have a single source shared with the renderer", () => {
  const fs = require("fs"), path = require("path");
  const utils = fs.readFileSync(path.join(__dirname, "../src/features/memory/memoryUtils.ts"), "utf8");
  assert.match(utils, /shared\/memory-rules\.mjs/);
  assert.doesNotMatch(utils, /NEVER_DELETE|MERGE_FIRST|decisions\//);
});
