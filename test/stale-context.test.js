const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./load-ts.cjs");

const { staleContext, cacheStatus, modelSwitch, turnMark, turnGrowth, formatIdle, formatRemaining, CACHE_TTL_MS, STALE_MIN_TOKENS } = loadTs("src/lib/staleContext.ts");

const NOW = Date.parse("2026-11-01T22:40:50Z");
// Issue #58: 606 thousand tokens, last real call ~4 h before the "continue".
const ISSUE_58 = { used: 606404, updatedAt: NOW - (4 * 60 + 19) * 60_000 };

test("notice: a large conversation idle past the cache (issue #58 case)", () => {
  assert.deepEqual({ ...staleContext(ISSUE_58, NOW) }, { used: 606404, idleMs: (4 * 60 + 19) * 60_000 });
});

test("notice: doesn't show with a warm cache, small context, compacting or no data", () => {
  assert.equal(staleContext({ used: 606404, updatedAt: NOW - CACHE_TTL_MS + 1000 }, NOW), null);
  assert.equal(staleContext({ used: STALE_MIN_TOKENS - 1, updatedAt: NOW - 5 * CACHE_TTL_MS }, NOW), null);
  assert.equal(staleContext({ ...ISSUE_58, compacting: true }, NOW), null);
  assert.equal(staleContext({ used: null, updatedAt: NOW - 5 * CACHE_TTL_MS }, NOW), null);
  assert.equal(staleContext({ used: 606404 }, NOW), null, "without the last reading's time there's no way to estimate");
  assert.equal(staleContext(undefined, NOW), null);
});

test("notice: the exact time and size limits count", () => {
  assert.notEqual(staleContext({ used: STALE_MIN_TOKENS, updatedAt: NOW - CACHE_TTL_MS }, NOW), null);
});

test("idle time as text", () => {
  assert.equal(formatIdle(30 * 60_000), "30 min");
  assert.equal(formatIdle(60 * 60_000), "1 h");
  assert.equal(formatIdle((4 * 60 + 19) * 60_000), "4 h 19 min");
  assert.equal(formatIdle(72 * 3600_000), "3 days");
});

test("notice: uses the lifetime reported by the CLI and the last call's time", () => {
  const fiveMin = 5 * 60_000;
  const info = { used: 300000, cacheTtlMs: fiveMin, lastCallAt: NOW - fiveMin, updatedAt: NOW };
  assert.deepEqual({ ...staleContext(info, NOW) }, { used: 300000, idleMs: fiveMin }, "5 min cache already expired");
  assert.equal(staleContext({ ...info, lastCallAt: NOW - fiveMin + 1000 }, NOW), null);
});

test("cache indicator: countdown when the CLI reports the lifetime", () => {
  const info = { used: 15406, window: null, cacheTtlMs: CACHE_TTL_MS, lastCallAt: NOW - 18 * 60_000 };
  assert.deepEqual({ ...cacheStatus(info, NOW) }, { kind: "warm", remainingMs: 42 * 60_000, ttlMs: CACHE_TTL_MS, idleMs: 18 * 60_000 });
  assert.deepEqual({ ...cacheStatus({ ...info, lastCallAt: NOW - CACHE_TTL_MS - 60_000 }, NOW) }, { kind: "expired", ttlMs: CACHE_TTL_MS, idleMs: CACHE_TTL_MS + 60_000 });
  assert.equal(cacheStatus({ ...info, lastCallAt: NOW - CACHE_TTL_MS }, NOW).kind, "expired", "at the exact limit it already expired");
});

test("cache indicator: without a reported lifetime (Codex, AGY) only the time since the last call", () => {
  assert.deepEqual({ ...cacheStatus({ used: 9000, window: 272000, lastCallAt: NOW - 7 * 60_000 }, NOW) }, { kind: "unknown", idleMs: 7 * 60_000 });
  assert.equal(cacheStatus({ used: 9000, window: null, updatedAt: NOW }, NOW), null, "without a recorded call there's no indicator");
  assert.equal(cacheStatus(undefined, NOW), null);
});

test("the remaining time format rounds up", () => {
  assert.equal(formatRemaining(42 * 60_000), "42 min");
  assert.equal(formatRemaining(41 * 60_000 + 1), "42 min");
  assert.equal(formatRemaining(CACHE_TTL_MS), "1 h");
  assert.equal(formatRemaining(30_500), "31 s");
  assert.equal(formatRemaining(5 * 60_000), "5 min");
  assert.equal(formatIdle(20_000), "less than 1 min");
});

test("model switch: a large conversation with another model reprocesses the whole context", () => {
  const info = { used: 400000, window: 1000000, model: "opus", lastCallAt: NOW };
  assert.deepEqual({ ...modelSwitch(info, "sonnet") }, { from: "opus", to: "sonnet", used: 400000 });
  assert.deepEqual({ ...modelSwitch({ ...info, model: "" }, "opus") }, { from: "", to: "opus", used: 400000 }, "from the CLI default to an explicit model also switches");
  assert.equal(modelSwitch(info, "opus"), null, "same model: the cache works");
  assert.equal(modelSwitch({ ...info, used: STALE_MIN_TOKENS - 1 }, "sonnet"), null, "small context: too cheap to warn");
  assert.equal(modelSwitch({ ...info, compacting: true }, "sonnet"), null);
  assert.equal(modelSwitch({ used: 400000, window: null }, "sonnet"), null, "context saved before the model was recorded doesn't warn");
  assert.equal(modelSwitch(undefined, "sonnet"), null);
});

test("growth per reply: compares with the end of the previous one and ignores a compaction midway", () => {
  const before = turnMark({ used: 100000, lastCompaction: { at: 10 } });
  assert.deepEqual({ ...before }, { used: 100000, compactedAt: 10 });
  assert.equal(turnGrowth(before, turnMark({ used: 220000, lastCompaction: { at: 10 } })), 120000);
  assert.equal(turnGrowth(before, turnMark({ used: 30000, lastCompaction: { at: 99 } })), null, "compacted in this reply");
  assert.equal(turnGrowth(turnMark({ used: 5000 }), turnMark({ used: 9000 })), 4000);
  assert.equal(turnGrowth(undefined, turnMark({ used: 9000 })), null, "no previous reference");
  assert.equal(turnMark({ used: null }), null);
  assert.equal(turnMark(undefined), null);
});

test("preventive compaction: only with a large context, a reported cache and close to expiring", () => {
  const { precompactDue } = loadTs("src/lib/staleContext.ts");
  const base = { used: 300_000, lastCallAt: NOW - 56 * 60_000, cacheTtlMs: 60 * 60_000 };
  assert.equal(precompactDue(base, NOW), base.lastCallAt, "4 min left: the 5 min window expires");
  assert.equal(precompactDue({ ...base, lastCallAt: NOW - 30 * 60_000 }, NOW), null, "cache far from expiring");
  assert.equal(precompactDue({ ...base, lastCallAt: NOW - 61 * 60_000 }, NOW), null, "already expired: compacting now costs full price");
  assert.equal(precompactDue({ ...base, used: 150_000 }, NOW), null, "a small context isn't worth it");
  assert.equal(precompactDue({ ...base, cacheTtlMs: undefined }, NOW), null, "without a reported lifetime there's nothing to anticipate");
  assert.equal(precompactDue({ ...base, compacting: true }, NOW), null);
  assert.equal(precompactDue(undefined, NOW), null);
});
