const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require("typescript");

const out = ts.transpileModule(fs.readFileSync(path.resolve("src/lib/staleContext.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const ctx = { exports: {}, Number, Math };
vm.runInNewContext(out, ctx);
const { staleContext, cacheStatus, modelSwitch, turnMark, turnGrowth, formatIdle, formatRemaining, CACHE_TTL_MS, STALE_MIN_TOKENS } = ctx.exports;

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

test("aviso: usa a validade informada pela CLI e o horário da última chamada", () => {
  const fiveMin = 5 * 60_000;
  const info = { used: 300000, cacheTtlMs: fiveMin, lastCallAt: NOW - fiveMin, updatedAt: NOW };
  assert.deepEqual({ ...staleContext(info, NOW) }, { used: 300000, idleMs: fiveMin }, "cache de 5 min já expirado");
  assert.equal(staleContext({ ...info, lastCallAt: NOW - fiveMin + 1000 }, NOW), null);
});

test("indicador do cache: contagem regressiva quando a CLI informa a validade", () => {
  const info = { used: 15406, window: null, cacheTtlMs: CACHE_TTL_MS, lastCallAt: NOW - 18 * 60_000 };
  assert.deepEqual({ ...cacheStatus(info, NOW) }, { kind: "warm", remainingMs: 42 * 60_000, ttlMs: CACHE_TTL_MS, idleMs: 18 * 60_000 });
  assert.deepEqual({ ...cacheStatus({ ...info, lastCallAt: NOW - CACHE_TTL_MS - 60_000 }, NOW) }, { kind: "expired", ttlMs: CACHE_TTL_MS, idleMs: CACHE_TTL_MS + 60_000 });
  assert.equal(cacheStatus({ ...info, lastCallAt: NOW - CACHE_TTL_MS }, NOW).kind, "expired", "no limite exato já expirou");
});

test("indicador do cache: sem validade informada (Codex, AGY) só o tempo desde a última chamada", () => {
  assert.deepEqual({ ...cacheStatus({ used: 9000, window: 272000, lastCallAt: NOW - 7 * 60_000 }, NOW) }, { kind: "unknown", idleMs: 7 * 60_000 });
  assert.equal(cacheStatus({ used: 9000, window: null, updatedAt: NOW }, NOW), null, "sem chamada registrada não há indicador");
  assert.equal(cacheStatus(undefined, NOW), null);
});

test("formatação do tempo restante arredonda para cima", () => {
  assert.equal(formatRemaining(42 * 60_000), "42 min");
  assert.equal(formatRemaining(41 * 60_000 + 1), "42 min");
  assert.equal(formatRemaining(CACHE_TTL_MS), "1 h");
  assert.equal(formatRemaining(30_500), "31 s");
  assert.equal(formatRemaining(5 * 60_000), "5 min");
  assert.equal(formatIdle(20_000), "menos de 1 min");
});

test("troca de modelo: conversa grande com outro modelo reprocessa o contexto inteiro", () => {
  const info = { used: 400000, window: 1000000, model: "opus", lastCallAt: NOW };
  assert.deepEqual({ ...modelSwitch(info, "sonnet") }, { from: "opus", to: "sonnet", used: 400000 });
  assert.deepEqual({ ...modelSwitch({ ...info, model: "" }, "opus") }, { from: "", to: "opus", used: 400000 }, "do padrão da CLI para um modelo explícito também troca");
  assert.equal(modelSwitch(info, "opus"), null, "mesmo modelo: cache serve");
  assert.equal(modelSwitch({ ...info, used: STALE_MIN_TOKENS - 1 }, "sonnet"), null, "contexto pequeno: barato demais para avisar");
  assert.equal(modelSwitch({ ...info, compacting: true }, "sonnet"), null);
  assert.equal(modelSwitch({ used: 400000, window: null }, "sonnet"), null, "contexto salvo antes do registro do modelo não avisa");
  assert.equal(modelSwitch(undefined, "sonnet"), null);
});

test("crescimento por resposta: compara com o fim da anterior e ignora compactação no meio", () => {
  const before = turnMark({ used: 100000, lastCompaction: { at: 10 } });
  assert.deepEqual({ ...before }, { used: 100000, compactedAt: 10 });
  assert.equal(turnGrowth(before, turnMark({ used: 220000, lastCompaction: { at: 10 } })), 120000);
  assert.equal(turnGrowth(before, turnMark({ used: 30000, lastCompaction: { at: 99 } })), null, "compactou nesta resposta");
  assert.equal(turnGrowth(turnMark({ used: 5000 }), turnMark({ used: 9000 })), 4000);
  assert.equal(turnGrowth(undefined, turnMark({ used: 9000 })), null, "sem referência anterior");
  assert.equal(turnMark({ used: null }), null);
  assert.equal(turnMark(undefined), null);
});
