const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require("typescript");
const { claudeContextUsed, pickModelWindow, codexContext, createContextTracker } = require("../electron/context-usage");

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
