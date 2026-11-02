const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_AUTO_COMPACT_TOKENS,
  resolveAutoCompactTokens,
} = require("../electron/auto-compact");

test("compactação automática: padrão de 200 mil, 0 desliga e o intervalo aceito pelas CLIs é respeitado", () => {
  assert.equal(DEFAULT_AUTO_COMPACT_TOKENS, 200000);
  assert.equal(resolveAutoCompactTokens(undefined), 200000);
  assert.equal(resolveAutoCompactTokens(null), 200000);
  assert.equal(resolveAutoCompactTokens("abc"), 200000);
  assert.equal(resolveAutoCompactTokens(0), 0);
  assert.equal(resolveAutoCompactTokens(-5), 0);
  assert.equal(resolveAutoCompactTokens(150000), 150000);
  assert.equal(resolveAutoCompactTokens(50000), 100000, "o Claude Code não aceita menos de 100 mil");
  assert.equal(resolveAutoCompactTokens(5000000), 1000000);
});

test("compactação automática sem valor escolhido acompanha a janela do modelo", () => {
  const { resolveAutoCompactForWindow } = require("../electron/auto-compact");
  assert.equal(resolveAutoCompactForWindow(undefined, 1_000_000), 400000, "40% de 1 milhão");
  assert.equal(resolveAutoCompactForWindow(null, 1_000_000), 400000);
  assert.equal(resolveAutoCompactForWindow(undefined, 200_000), 200000, "janela de 200 mil mantém o padrão");
  assert.equal(resolveAutoCompactForWindow(undefined, null), 200000, "janela desconhecida mantém o padrão");
  assert.equal(resolveAutoCompactForWindow(undefined, 272_000), 110000);
  assert.equal(resolveAutoCompactForWindow(150000, 1_000_000), 150000, "o valor escolhido sempre vale");
  assert.equal(resolveAutoCompactForWindow(0, 1_000_000), 0, "0 desliga mesmo com janela grande");
});
