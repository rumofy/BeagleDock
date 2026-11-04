const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  normalizeDays,
  isTempCwd,
  classifyProject,
  createTempCleanup,
} = require("../electron/memory-temp-cleanup");
const { makeProbeDir, PROBE_MARKER } = require("./probe-dir.cjs");

const roots = ["/tmp", "/var/tmp"];
const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-11-02T12:00:00Z");
const ago = (days) => new Date(now - days * DAY).toISOString();
const proj = (over = {}) => ({
  workspace: "default",
  project: "tmp.abc",
  sessionCount: 1,
  pageCount: 1,
  lastActivity: ago(10),
  ...over,
});
const sess = (cwd, days = 10) => ({ cwd, startedAt: ago(days), endedAt: ago(days) });

test("delay: empty uses the default, 0 or invalid turns it off, ceiling of 365", () => {
  assert.equal(normalizeDays(undefined), 7);
  assert.equal(normalizeDays(""), 7);
  assert.equal(normalizeDays(0), 0);
  assert.equal(normalizeDays(-3), 0);
  assert.equal(normalizeDays("abc"), 0);
  assert.equal(normalizeDays("3"), 3);
  assert.equal(normalizeDays(9999), 365);
});

test("temporary folder: only inside the roots, without confusing a prefix", () => {
  assert.ok(isTempCwd("/tmp", roots));
  assert.ok(isTempCwd("/tmp/issue58/live", roots));
  assert.ok(isTempCwd("/var/tmp/x", roots));
  assert.ok(!isTempCwd("/tmpfoo/x", roots));
  assert.ok(!isTempCwd("/home/u/dev/Rumofy/RumofyNext", roots));
  assert.ok(!isTempCwd("", roots));
  assert.ok(!isTempCwd(null, roots));
  assert.ok(!isTempCwd("tmp/relativo", roots));
});

test("a temporary project idle past the delay is marked for deletion", () => {
  const r = classifyProject({ project: proj(), sessions: [sess("/tmp/tmp.abc")], roots, days: 7, now });
  assert.equal(r.temp, true);
  assert.equal(r.stale, true);
});

test("a recent temporary project or with cleanup off isn't deleted", () => {
  const recent = classifyProject({
    project: proj({ lastActivity: ago(1) }),
    sessions: [sess("/tmp/x", 1)],
    roots,
    days: 7,
    now,
  });
  assert.equal(recent.temp, true);
  assert.equal(recent.stale, false);
  const off = classifyProject({ project: proj(), sessions: [sess("/tmp/x")], roots, days: 0, now });
  assert.equal(off.stale, false);
});

test("a recent session holds the project even with an old lastActivity", () => {
  const r = classifyProject({
    project: proj({ sessionCount: 2 }),
    sessions: [sess("/tmp/x", 30), sess("/tmp/x", 2)],
    roots,
    days: 7,
    now,
  });
  assert.equal(r.stale, false);
});

test("real projects never get in", () => {
  const cases = [
    // a session outside the temporary folder
    { project: proj({ sessionCount: 2 }), sessions: [sess("/tmp/x"), sess("/home/u/dev/Rumofy/RumofyNext")] },
    // a session without a recorded folder (like the old rumofy-rumofynext ones)
    { project: proj({ sessionCount: 2 }), sessions: [sess("/tmp/x"), sess("")] },
    // the server returned fewer sessions than the project has
    { project: proj({ sessionCount: 5 }), sessions: [sess("/tmp/x")] },
    // no sessions
    { project: proj({ sessionCount: 0 }), sessions: [] },
    // reserved scopes
    { project: proj({ project: "_global" }), sessions: [sess("/tmp/x")] },
    { project: proj({ workspace: "_global" }), sessions: [sess("/tmp/x")] },
  ];
  for (const c of cases) {
    const r = classifyProject({ ...c, roots, days: 7, now });
    assert.equal(r.temp, false, JSON.stringify(c.project));
  }
  const many = Array.from({ length: 100 }, () => sess("/tmp/x"));
  assert.equal(
    classifyProject({ project: proj({ sessionCount: 100 }), sessions: many, roots, days: 7, now }).temp,
    false,
  );
});

function fakeApi(projects, sessions) {
  const calls = [];
  return {
    calls,
    api: {
      listProjects: async () => projects,
      listSessions: async (ws, p) => {
        calls.push(`${ws}/${p}`);
        return sessions[`${ws}/${p}`] || [];
      },
    },
  };
}

test("automatic cleanup deletes only expired temporary projects; the button deletes all temporary ones", async () => {
  const projects = [
    proj({ project: "tmp.old" }),
    proj({ project: "tmp.new", lastActivity: ago(1) }),
    proj({ workspace: "rumofy", project: "rumofy-rumofynext", sessionCount: 2 }),
    proj({ project: "_global" }),
    proj({ project: "huge", sessionCount: 122 }),
  ];
  const sessions = {
    "default/tmp.old": [sess("/tmp/tmp.old")],
    "default/tmp.new": [sess("/tmp/tmp.new", 1)],
    "rumofy/rumofy-rumofynext": [sess("/home/u/dev/Rumofy/RumofyNext"), sess("/tmp/x")],
  };
  const { api, calls } = fakeApi(projects, sessions);
  const purged = [];
  const cleanup = createTempCleanup({
    api,
    roots,
    now: () => now,
    getDays: async () => 7,
    purge: async (ws, p) => {
      purged.push(`${ws}/${p}`);
      return { ok: true };
    },
  });
  const auto = await cleanup.run();
  assert.deepEqual(auto.removed, ["default/tmp.old"]);
  assert.ok(!calls.includes("default/_global"), "a reserved scope isn't even queried");
  assert.ok(!calls.includes("default/huge"), "a large project isn't even queried");

  purged.length = 0;
  const all = await cleanup.run({ all: true });
  assert.deepEqual(all.removed.sort(), ["default/tmp.new", "default/tmp.old"]);
  assert.ok(!purged.includes("rumofy/rumofy-rumofynext"));
});

test("with delay 0 automatic cleanup deletes nothing, but the button still works", async () => {
  const { api } = fakeApi([proj()], { "default/tmp.abc": [sess("/tmp/tmp.abc")] });
  const purged = [];
  const cleanup = createTempCleanup({
    api,
    roots,
    now: () => now,
    getDays: async () => 0,
    purge: async (ws, p) => (purged.push(p), { ok: true }),
  });
  const auto = await cleanup.run();
  assert.equal(auto.skipped, "desligada");
  assert.deepEqual(purged, []);
  const manual = await cleanup.run({ all: true });
  assert.deepEqual(manual.removed, ["default/tmp.abc"]);
});

test("a failure deleting one project is reported without stopping the others", async () => {
  const { api } = fakeApi([proj({ project: "a" }), proj({ project: "b" })], {
    "default/a": [sess("/tmp/a")],
    "default/b": [sess("/tmp/b")],
  });
  const cleanup = createTempCleanup({
    api,
    roots,
    now: () => now,
    getDays: async () => 7,
    purge: async (ws, p) => (p === "a" ? { ok: false, error: "servidor recusou" } : { ok: true }),
  });
  const r = await cleanup.run();
  assert.equal(r.ok, false);
  assert.deepEqual(r.removed, ["default/b"]);
  assert.deepEqual(r.failed, [{ name: "default/a", error: "servidor recusou" }]);
});

test("a probe folder is born pointing at the beagledock-probes project", () => {
  const dir = makeProbeDir("issue 58/x");
  try {
    assert.match(path.basename(dir), /^beagledock-issue-58-x-/);
    assert.equal(fs.readFileSync(path.join(dir, ".ai-memory.toml"), "utf8"), PROBE_MARKER);
    const { resolveAiMemoryScope } = require("../electron/ai-memory-scope");
    return Promise.resolve(resolveAiMemoryScope(dir)).then((scope) => {
      assert.equal(scope.workspace, "default");
      assert.equal(scope.project, "beagledock-probes");
    });
  } finally {
    setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 0);
  }
});
