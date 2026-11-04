const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_AUTO_COMPACT_TOKENS,
  resolveAutoCompactTokens,
} = require("../electron/auto-compact");

test("auto-compaction: 200 thousand default, 0 turns it off and the range accepted by the CLIs is respected", () => {
  assert.equal(DEFAULT_AUTO_COMPACT_TOKENS, 200000);
  assert.equal(resolveAutoCompactTokens(undefined), 200000);
  assert.equal(resolveAutoCompactTokens(null), 200000);
  assert.equal(resolveAutoCompactTokens("abc"), 200000);
  assert.equal(resolveAutoCompactTokens(0), 0);
  assert.equal(resolveAutoCompactTokens(-5), 0);
  assert.equal(resolveAutoCompactTokens(150000), 150000);
  assert.equal(resolveAutoCompactTokens(50000), 100000, "Claude Code doesn't accept less than 100 thousand");
  assert.equal(resolveAutoCompactTokens(5000000), 1000000);
});

test("auto-compaction without a chosen value follows the model's window", () => {
  const { resolveAutoCompactForWindow } = require("../electron/auto-compact");
  assert.equal(resolveAutoCompactForWindow(undefined, 1_000_000), 400000, "40% of 1 million");
  assert.equal(resolveAutoCompactForWindow(null, 1_000_000), 400000);
  assert.equal(resolveAutoCompactForWindow(undefined, 200_000), 200000, "a 200 thousand window keeps the default");
  assert.equal(resolveAutoCompactForWindow(undefined, null), 200000, "an unknown window keeps the default");
  assert.equal(resolveAutoCompactForWindow(undefined, 272_000), 110000);
  assert.equal(resolveAutoCompactForWindow(150000, 1_000_000), 150000, "the chosen value always wins");
  assert.equal(resolveAutoCompactForWindow(0, 1_000_000), 0, "0 turns it off even with a large window");
});
