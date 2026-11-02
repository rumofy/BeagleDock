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

test("prazo: vazio usa o padrão, 0 ou inválido desliga, teto de 365", () => {
  assert.equal(normalizeDays(undefined), 7);
  assert.equal(normalizeDays(""), 7);
  assert.equal(normalizeDays(0), 0);
  assert.equal(normalizeDays(-3), 0);
  assert.equal(normalizeDays("abc"), 0);
  assert.equal(normalizeDays("3"), 3);
  assert.equal(normalizeDays(9999), 365);
});

test("pasta temporária: só dentro das raízes, sem confundir prefixo", () => {
  assert.ok(isTempCwd("/tmp", roots));
  assert.ok(isTempCwd("/tmp/issue58/live", roots));
  assert.ok(isTempCwd("/var/tmp/x", roots));
  assert.ok(!isTempCwd("/tmpfoo/x", roots));
  assert.ok(!isTempCwd("/home/u/dev/Rumofy/RumofyNext", roots));
  assert.ok(!isTempCwd("", roots));
  assert.ok(!isTempCwd(null, roots));
  assert.ok(!isTempCwd("tmp/relativo", roots));
});

test("temporário parado além do prazo é marcado para apagar", () => {
  const r = classifyProject({ project: proj(), sessions: [sess("/tmp/tmp.abc")], roots, days: 7, now });
  assert.equal(r.temp, true);
  assert.equal(r.stale, true);
});

test("temporário recente ou com limpeza desligada não é apagado", () => {
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

test("sessão recente segura o projeto mesmo com lastActivity antigo", () => {
  const r = classifyProject({
    project: proj({ sessionCount: 2 }),
    sessions: [sess("/tmp/x", 30), sess("/tmp/x", 2)],
    roots,
    days: 7,
    now,
  });
  assert.equal(r.stale, false);
});

test("projetos reais nunca entram", () => {
  const cases = [
    // uma sessão fora do temporário
    { project: proj({ sessionCount: 2 }), sessions: [sess("/tmp/x"), sess("/home/u/dev/Rumofy/RumofyNext")] },
    // sessão sem pasta registrada (como as antigas do rumofy-rumofynext)
    { project: proj({ sessionCount: 2 }), sessions: [sess("/tmp/x"), sess("")] },
    // servidor devolveu menos sessões do que o projeto tem
    { project: proj({ sessionCount: 5 }), sessions: [sess("/tmp/x")] },
    // sem sessões
    { project: proj({ sessionCount: 0 }), sessions: [] },
    // escopos reservados
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

test("limpeza automática apaga só temporários vencidos; botão apaga todos os temporários", async () => {
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
  assert.ok(!calls.includes("default/_global"), "escopo reservado nem é consultado");
  assert.ok(!calls.includes("default/huge"), "projeto grande nem é consultado");

  purged.length = 0;
  const all = await cleanup.run({ all: true });
  assert.deepEqual(all.removed.sort(), ["default/tmp.new", "default/tmp.old"]);
  assert.ok(!purged.includes("rumofy/rumofy-rumofynext"));
});

test("com o prazo 0 a limpeza automática não apaga nada, mas o botão ainda funciona", async () => {
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

test("falha ao apagar um projeto é informada sem interromper os demais", async () => {
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

test("pasta de sonda já nasce apontando para o projeto beagledock-probes", () => {
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
