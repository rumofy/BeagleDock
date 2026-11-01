const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require("typescript");

const out = ts.transpileModule(fs.readFileSync(path.resolve("src/lib/staleContext.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const ctx = { exports: {}, Number, Math };
vm.runInNewContext(out, ctx);
const { staleContext, formatIdle, CACHE_TTL_MS, STALE_MIN_TOKENS } = ctx.exports;

const NOW = Date.parse("2026-11-01T22:40:50Z");
// Issue #58: 606 mil tokens, última chamada real ~4 h antes do "continue".
const ISSUE_58 = { used: 606404, updatedAt: NOW - (4 * 60 + 19) * 60_000 };

test("aviso: conversa grande e parada além do cache (caso da issue #58)", () => {
  assert.deepEqual({ ...staleContext(ISSUE_58, NOW) }, { used: 606404, idleMs: (4 * 60 + 19) * 60_000 });
});

test("aviso: não aparece com cache ainda quente, contexto pequeno, compactando ou sem dados", () => {
  assert.equal(staleContext({ used: 606404, updatedAt: NOW - CACHE_TTL_MS + 1000 }, NOW), null);
  assert.equal(staleContext({ used: STALE_MIN_TOKENS - 1, updatedAt: NOW - 5 * CACHE_TTL_MS }, NOW), null);
  assert.equal(staleContext({ ...ISSUE_58, compacting: true }, NOW), null);
  assert.equal(staleContext({ used: null, updatedAt: NOW - 5 * CACHE_TTL_MS }, NOW), null);
  assert.equal(staleContext({ used: 606404 }, NOW), null, "sem horário da última leitura não há como estimar");
  assert.equal(staleContext(undefined, NOW), null);
});

test("aviso: limites exatos do tempo e do tamanho valem", () => {
  assert.notEqual(staleContext({ used: STALE_MIN_TOKENS, updatedAt: NOW - CACHE_TTL_MS }, NOW), null);
});

test("tempo parado em texto", () => {
  assert.equal(formatIdle(30 * 60_000), "30 min");
  assert.equal(formatIdle(60 * 60_000), "1 h");
  assert.equal(formatIdle((4 * 60 + 19) * 60_000), "4 h 19 min");
  assert.equal(formatIdle(72 * 3600_000), "3 dias");
});
