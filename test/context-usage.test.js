const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require("typescript");
const { claudeContextUsed, claudeCacheUsage, claudeCacheTtl, agyCacheUsage, pickModelWindow, codexContext, createContextTracker } = require("../electron/context-usage");

const out = ts.transpileModule(fs.readFileSync(path.resolve("src/lib/tokens.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const ctx = { exports: {}, Number, Math, String };
vm.runInNewContext(out, ctx);
const { formatTokens, contextPercent, contextLevel } = ctx.exports;

// Valores capturados do Claude Code 2.1.316 real.
const REAL_USAGE = { input_tokens: 2, cache_creation_input_tokens: 6390, cache_read_input_tokens: 9014, output_tokens: 4 };
const REAL_MODEL_USAGE = { "claude-haiku-5-5": { inputTokens: 2, contextWindow: 1000000, maxOutputTokens: 128000, costUSD: 0.00137 } };

test("Claude: contexto = entrada + cache criado + cache lido (a saída entra na próxima chamada)", () => {
  assert.equal(claudeContextUsed(REAL_USAGE), 15406);
  assert.equal(claudeContextUsed({}), null);
  assert.equal(claudeContextUsed(undefined), null);
  assert.equal(claudeContextUsed({ input_tokens: -5 }), null);
});

test("Claude: a janela real vem do result", () => {
  assert.equal(pickModelWindow(REAL_MODEL_USAGE, "claude-haiku-5-5"), 1000000);
  assert.equal(pickModelWindow({ a: { contextWindow: 200000 }, b: { contextWindow: 1000000 } }, "b"), 1000000);
  assert.equal(pickModelWindow({}, "x"), null);
});

test("Codex: contexto vem de last.totalTokens e a janela, de modelContextWindow", () => {
  assert.deepEqual(codexContext({ last: { totalTokens: 8200 }, total: { totalTokens: 90000 }, modelContextWindow: 272000 }), { used: 8200, window: 272000 });
  assert.deepEqual(codexContext({ last: { totalTokens: 10 }, modelContextWindow: null }), { used: 10, window: null });
  assert.equal(codexContext({ last: { totalTokens: 0 } }), null);
  assert.equal(codexContext(undefined), null);
});

test("rastreador: não estima a janela do Claude (só a real, do result), e a compactação zera o uso para o pós", () => {
  const sent = [];
  const t = createContextTracker({ emit: (c, d) => sent.push(d), sessionId: "s", source: "claude" });
  t.update({ used: 15406, model: "claude-haiku-5-5" });
  assert.equal(sent.at(-1).window, null, "sem janela informada pela CLI não há palpite");
  assert.equal(sent.at(-1).used, 15406);
  t.setWindow(1000000, true);
  assert.equal(sent.at(-1).window, 1000000);
  assert.equal(sent.at(-1).windowKnown, true);
  assert.equal(sent.at(-1).used, 15406, "janela nova não apaga o uso");
  t.compacting(true);
  assert.equal(sent.at(-1).compacting, true);
  t.compacted({ pre: 15522, post: 3451, trigger: "manual" });
  const last = sent.at(-1);
  assert.equal(last.compacting, false);
  assert.equal(last.used, 3451);
  assert.equal(last.compactions, 1);
  assert.deepEqual({ pre: last.lastCompaction.pre, post: last.lastCompaction.post, trigger: last.lastCompaction.trigger }, { pre: 15522, post: 3451, trigger: "manual" });
  assert.equal(t.hasData(), true);
});

test("rastreador do Codex usa a janela informada e não inventa estimativa", () => {
  const t = createContextTracker({ sessionId: "s", source: "codex" });
  t.update({ used: 5000 });
  assert.equal(t.snapshot().window, null);
  t.update({ used: 6000, window: 272000 });
  assert.equal(t.snapshot().window, 272000);
  assert.equal(t.snapshot().windowKnown, true);
});

test("formatação e níveis da barra", () => {
  assert.equal(formatTokens(850), "850");
  assert.equal(formatTokens(15406), "15k");
  assert.equal(formatTokens(3451), "3,5k");
  assert.equal(formatTokens(1000000), "1,0M");
  assert.equal(formatTokens(null), "N/D");
  assert.equal(contextPercent(15406, 1000000).toFixed(2), "1.54");
  assert.equal(contextPercent(5, 0), null);
  assert.equal(contextPercent(300, 200), 100);
  assert.equal(contextLevel(50), "ok");
  assert.equal(contextLevel(70), "warn");
  assert.equal(contextLevel(90), "danger");
  assert.equal(contextLevel(null), "ok");
});

test("janela do Claude: modelo com sufixo casa pelo nome e, na dúvida, vale o mais usado (não o subagente)", () => {
  const usage = {
    "claude-opus-5-5[1m]": { contextWindow: 1000000, inputTokens: 100, cacheReadInputTokens: 90000 },
    "claude-haiku-5-5": { contextWindow: 200000, inputTokens: 5 },
  };
  assert.equal(pickModelWindow(usage, "claude-opus-5-5"), 1000000, "prefixo casa com o sufixo [1m]");
  assert.equal(pickModelWindow(usage, "modelo-desconhecido"), 1000000, "sem casar, o mais usado");
});

test("a mesma compactação avisada por dois eventos conta uma vez", () => {
  let clock = 1000;
  const t = createContextTracker({ sessionId: "s", source: "codex", now: () => clock });
  t.compacting(true);
  t.compacted({ trigger: "manual" });
  clock += 300;
  t.compacted({ trigger: "auto" });
  assert.equal(t.snapshot().compactions, 1);
  assert.equal(t.snapshot().lastCompaction.trigger, "manual", "o gatilho verdadeiro é mantido");
  clock += 5000;
  t.compacted({ trigger: "auto" });
  assert.equal(t.snapshot().compactions, 2, "uma compactação nova, depois, conta");
});

// Valores reais da issue #58 (Claude Code 2.1.316): 1ª chamada após ~4h parado, com cache expirado.
const ISSUE_58_USAGE = { input_tokens: 2, cache_read_input_tokens: 10571, cache_creation_input_tokens: 595831, output_tokens: 546 };

test("cache: Claude informa leitura e escrita da última chamada (issue #58)", () => {
  assert.deepEqual(claudeCacheUsage(ISSUE_58_USAGE), { read: 10571, write: 595831 });
  assert.deepEqual(claudeCacheUsage({ cache_read_input_tokens: 5 }), { read: 5 });
  assert.equal(claudeCacheUsage({ input_tokens: 2 }), null);
  assert.equal(claudeCacheUsage(undefined), null);
  assert.equal(claudeContextUsed(ISSUE_58_USAGE), 606404);
});

test("cache: Codex usa cachedInputTokens (lido) e cacheWriteInputTokens (escrito)", () => {
  const usage = { last: { totalTokens: 9000, cachedInputTokens: 7000, cacheWriteInputTokens: 1500 }, modelContextWindow: 272000 };
  assert.deepEqual(codexContext(usage), { used: 9000, window: 272000, cache: { read: 7000, write: 1500 } });
});

test("cache: o rastreador publica o cache e uma atualização sem cache não o apaga", () => {
  const sent = [];
  const t = createContextTracker({ emit: (c, d) => sent.push(d), sessionId: "s", source: "claude" });
  t.update({ used: 606404, cache: claudeCacheUsage(ISSUE_58_USAGE) });
  assert.deepEqual(sent.at(-1).cache, { read: 10571, write: 595831 });
  t.setWindow(1000000, true);
  assert.deepEqual(sent.at(-1).cache, { read: 10571, write: 595831 });
  t.update({ used: 607050, cache: claudeCacheUsage({ cache_read_input_tokens: 606402, cache_creation_input_tokens: 648 }) });
  assert.deepEqual(sent.at(-1).cache, { read: 606402, write: 648 });
});

test("cache: sem dado de cache (AGY) o snapshot não traz o campo", () => {
  const sent = [];
  const t = createContextTracker({ emit: (c, d) => sent.push(d), sessionId: "s", source: "antigravity" });
  t.update({ used: 1200 });
  assert.equal("cache" in sent.at(-1), false);
});

// Claude Code 2.1.316 real: a escrita vem separada por validade em cache_creation.
test("validade do cache: Claude informa 1 h ou 5 min pela escrita; leitura pura não diz nada", () => {
  assert.equal(claudeCacheTtl({ cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 3905 } }), 3600000);
  assert.equal(claudeCacheTtl({ cache_creation: { ephemeral_5m_input_tokens: 812, ephemeral_1h_input_tokens: 0 } }), 300000);
  assert.equal(claudeCacheTtl({ cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } }), null);
  assert.equal(claudeCacheTtl({ cache_read_input_tokens: 9000 }), null);
  assert.equal(claudeCacheTtl(undefined), null);
});

test("cache do AGY: cache_read_tokens vira leitura, sem escrita nem validade", () => {
  assert.deepEqual(agyCacheUsage({ input_tokens: 16572, cache_read_tokens: 9626 }), { read: 9626 });
  assert.deepEqual(agyCacheUsage({ input_tokens: 16572, cache_read_tokens: 0 }), { read: 0 });
  assert.equal(agyCacheUsage({ input_tokens: 16572 }), null);
  assert.equal(agyCacheUsage(undefined), null);
});

test("validade do cache: o rastreador marca cada chamada e mantém a validade conhecida", () => {
  const sent = [];
  let clock = 1000;
  const t = createContextTracker({ emit: (c, d) => sent.push(d), sessionId: "s", source: "claude", now: () => clock });
  t.setWindow(1000000, true);
  assert.equal("lastCallAt" in sent.at(-1), false, "sem chamada ao modelo não há horário");
  t.update({ used: 15406, cacheTtlMs: 3600000 });
  assert.equal(sent.at(-1).lastCallAt, 1000);
  assert.equal(sent.at(-1).cacheTtlMs, 3600000);
  clock = 5000;
  t.compacting(true);
  assert.equal(sent.at(-1).lastCallAt, 1000, "mudar só o estado não renova o cache");
  t.update({ used: 15500, cacheTtlMs: null });
  assert.equal(sent.at(-1).lastCallAt, 5000, "uma chamada de leitura renova o cache");
  assert.equal(sent.at(-1).cacheTtlMs, 3600000, "leitura pura não apaga a validade conhecida");
});

test("modelo do cache: o rastreador publica o modelo escolhido no app, inclusive o padrão", () => {
  const sent = [];
  createContextTracker({ emit: (c, d) => sent.push(d), sessionId: "s", source: "claude", model: "" }).update({ used: 10 });
  assert.equal(sent.at(-1).model, "");
  createContextTracker({ emit: (c, d) => sent.push(d), sessionId: "s", source: "claude" }).update({ used: 10 });
  assert.equal("model" in sent.at(-1), false, "sem modelo conhecido não publica");
});

test("validade do cache: Codex e AGY não informam validade", () => {
  const sent = [];
  const t = createContextTracker({ emit: (c, d) => sent.push(d), sessionId: "s", source: "codex", now: () => 42 });
  t.update(codexContext({ last: { totalTokens: 9000, cachedInputTokens: 7000 }, modelContextWindow: 272000 }));
  assert.equal(sent.at(-1).lastCallAt, 42);
  assert.equal("cacheTtlMs" in sent.at(-1), false);
});
