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
