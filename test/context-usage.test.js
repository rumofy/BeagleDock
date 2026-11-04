const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./load-ts.cjs");
const { claudeContextUsed, claudeCacheUsage, claudeCacheTtl, agyCacheUsage, pickModelWindow, codexContext, createContextTracker } = require("../electron/context-usage");

const { formatTokens, contextPercent, contextLevel } = loadTs("src/lib/tokens.ts");

// Values captured from the real Claude Code 2.1.316.
const REAL_USAGE = { input_tokens: 2, cache_creation_input_tokens: 6390, cache_read_input_tokens: 9014, output_tokens: 4 };
const REAL_MODEL_USAGE = { "claude-haiku-5-5": { inputTokens: 2, contextWindow: 1000000, maxOutputTokens: 128000, costUSD: 0.00137 } };

test("Claude: context = input + cache created + cache read (the output goes into the next call)", () => {
  assert.equal(claudeContextUsed(REAL_USAGE), 15406);
  assert.equal(claudeContextUsed({}), null);
  assert.equal(claudeContextUsed(undefined), null);
  assert.equal(claudeContextUsed({ input_tokens: -5 }), null);
});

test("Claude: the real window comes from the result", () => {
  assert.equal(pickModelWindow(REAL_MODEL_USAGE, "claude-haiku-5-5"), 1000000);
  assert.equal(pickModelWindow({ a: { contextWindow: 200000 }, b: { contextWindow: 1000000 } }, "b"), 1000000);
  assert.equal(pickModelWindow({}, "x"), null);
});

test("Codex: context comes from last.totalTokens and the window from modelContextWindow", () => {
  assert.deepEqual(codexContext({ last: { totalTokens: 8200 }, total: { totalTokens: 90000 }, modelContextWindow: 272000 }), { used: 8200, window: 272000 });
  assert.deepEqual(codexContext({ last: { totalTokens: 10 }, modelContextWindow: null }), { used: 10, window: null });
  assert.equal(codexContext({ last: { totalTokens: 0 } }), null);
  assert.equal(codexContext(undefined), null);
});

test("tracker: doesn't estimate Claude's window (only the real one, from the result), and compaction resets usage for what follows", () => {
  const sent = [];
  const t = createContextTracker({ emit: (c, d) => sent.push(d), sessionId: "s", source: "claude" });
  t.update({ used: 15406, model: "claude-haiku-5-5" });
  assert.equal(sent.at(-1).window, null, "without a window reported by the CLI there's no guess");
  assert.equal(sent.at(-1).used, 15406);
  t.setWindow(1000000, true);
  assert.equal(sent.at(-1).window, 1000000);
  assert.equal(sent.at(-1).windowKnown, true);
  assert.equal(sent.at(-1).used, 15406, "a new window doesn't erase the usage");
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

test("the Codex tracker uses the reported window and doesn't make up an estimate", () => {
  const t = createContextTracker({ sessionId: "s", source: "codex" });
  t.update({ used: 5000 });
  assert.equal(t.snapshot().window, null);
  t.update({ used: 6000, window: 272000 });
  assert.equal(t.snapshot().window, 272000);
  assert.equal(t.snapshot().windowKnown, true);
});

test("bar formatting and levels", () => {
  assert.equal(formatTokens(850), "850");
  assert.equal(formatTokens(15406), "15k");
  assert.equal(formatTokens(3451), "3.5k");
  assert.equal(formatTokens(1000000), "1.0M");
  assert.equal(formatTokens(null), "N/A");
  assert.equal(contextPercent(15406, 1000000).toFixed(2), "1.54");
  assert.equal(contextPercent(5, 0), null);
  assert.equal(contextPercent(300, 200), 100);
  assert.equal(contextLevel(50), "ok");
  assert.equal(contextLevel(70), "warn");
  assert.equal(contextLevel(90), "danger");
  assert.equal(contextLevel(null), "ok");
});

test("Claude window: a model with a suffix matches by name and, when in doubt, the most used one wins (not the subagent)", () => {
  const usage = {
    "claude-opus-5-5[1m]": { contextWindow: 1000000, inputTokens: 100, cacheReadInputTokens: 90000 },
    "claude-haiku-5-5": { contextWindow: 200000, inputTokens: 5 },
  };
  assert.equal(pickModelWindow(usage, "claude-opus-5-5"), 1000000, "the prefix matches the [1m] suffix");
  assert.equal(pickModelWindow(usage, "modelo-desconhecido"), 1000000, "with no match, the most used one");
});

test("the same compaction reported by two events counts once", () => {
  let clock = 1000;
  const t = createContextTracker({ sessionId: "s", source: "codex", now: () => clock });
  t.compacting(true);
  t.compacted({ trigger: "manual" });
  clock += 300;
  t.compacted({ trigger: "auto" });
  assert.equal(t.snapshot().compactions, 1);
  assert.equal(t.snapshot().lastCompaction.trigger, "manual", "the true trigger is kept");
  clock += 5000;
  t.compacted({ trigger: "auto" });
  assert.equal(t.snapshot().compactions, 2, "a new compaction, later, counts");
});

// Real values from issue #58 (Claude Code 2.1.316): 1st call after ~4h idle, with an expired cache.
const ISSUE_58_USAGE = { input_tokens: 2, cache_read_input_tokens: 10571, cache_creation_input_tokens: 595831, output_tokens: 546 };

test("cache: Claude reports the last call's read and write (issue #58)", () => {
  assert.deepEqual(claudeCacheUsage(ISSUE_58_USAGE), { read: 10571, write: 595831 });
  assert.deepEqual(claudeCacheUsage({ cache_read_input_tokens: 5 }), { read: 5 });
  assert.equal(claudeCacheUsage({ input_tokens: 2 }), null);
  assert.equal(claudeCacheUsage(undefined), null);
  assert.equal(claudeContextUsed(ISSUE_58_USAGE), 606404);
});

test("cache: Codex uses cachedInputTokens (read) and cacheWriteInputTokens (written)", () => {
  const usage = { last: { totalTokens: 9000, cachedInputTokens: 7000, cacheWriteInputTokens: 1500 }, modelContextWindow: 272000 };
  assert.deepEqual(codexContext(usage), { used: 9000, window: 272000, cache: { read: 7000, write: 1500 } });
});

test("cache: the tracker publishes the cache and an update without cache doesn't erase it", () => {
  const sent = [];
  const t = createContextTracker({ emit: (c, d) => sent.push(d), sessionId: "s", source: "claude" });
  t.update({ used: 606404, cache: claudeCacheUsage(ISSUE_58_USAGE) });
  assert.deepEqual(sent.at(-1).cache, { read: 10571, write: 595831 });
  t.setWindow(1000000, true);
  assert.deepEqual(sent.at(-1).cache, { read: 10571, write: 595831 });
  t.update({ used: 607050, cache: claudeCacheUsage({ cache_read_input_tokens: 606402, cache_creation_input_tokens: 648 }) });
  assert.deepEqual(sent.at(-1).cache, { read: 606402, write: 648 });
});

test("cache: without cache data (AGY) the snapshot has no field", () => {
  const sent = [];
  const t = createContextTracker({ emit: (c, d) => sent.push(d), sessionId: "s", source: "antigravity" });
  t.update({ used: 1200 });
  assert.equal("cache" in sent.at(-1), false);
});

// Real Claude Code 2.1.316: the write comes split by lifetime in cache_creation.
test("cache lifetime: Claude reports 1 h or 5 min through the write; a pure read says nothing", () => {
  assert.equal(claudeCacheTtl({ cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 3905 } }), 3600000);
  assert.equal(claudeCacheTtl({ cache_creation: { ephemeral_5m_input_tokens: 812, ephemeral_1h_input_tokens: 0 } }), 300000);
  assert.equal(claudeCacheTtl({ cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } }), null);
  assert.equal(claudeCacheTtl({ cache_read_input_tokens: 9000 }), null);
  assert.equal(claudeCacheTtl(undefined), null);
});

test("AGY cache: cache_read_tokens becomes a read, without write or lifetime", () => {
  assert.deepEqual(agyCacheUsage({ input_tokens: 16572, cache_read_tokens: 9626 }), { read: 9626 });
  assert.deepEqual(agyCacheUsage({ input_tokens: 16572, cache_read_tokens: 0 }), { read: 0 });
  assert.equal(agyCacheUsage({ input_tokens: 16572 }), null);
  assert.equal(agyCacheUsage(undefined), null);
});

test("cache lifetime: the tracker marks each call and keeps the known lifetime", () => {
  const sent = [];
  let clock = 1000;
  const t = createContextTracker({ emit: (c, d) => sent.push(d), sessionId: "s", source: "claude", now: () => clock });
  t.setWindow(1000000, true);
  assert.equal("lastCallAt" in sent.at(-1), false, "without a model call there's no time");
  t.update({ used: 15406, cacheTtlMs: 3600000 });
  assert.equal(sent.at(-1).lastCallAt, 1000);
  assert.equal(sent.at(-1).cacheTtlMs, 3600000);
  clock = 5000;
  t.compacting(true);
  assert.equal(sent.at(-1).lastCallAt, 1000, "changing only the state doesn't renew the cache");
  t.update({ used: 15500, cacheTtlMs: null });
  assert.equal(sent.at(-1).lastCallAt, 5000, "a read call renews the cache");
  assert.equal(sent.at(-1).cacheTtlMs, 3600000, "a pure read doesn't erase the known lifetime");
});

test("cache model: the tracker publishes the model chosen in the app, including the default", () => {
  const sent = [];
  createContextTracker({ emit: (c, d) => sent.push(d), sessionId: "s", source: "claude", model: "" }).update({ used: 10 });
  assert.equal(sent.at(-1).model, "");
  createContextTracker({ emit: (c, d) => sent.push(d), sessionId: "s", source: "claude" }).update({ used: 10 });
  assert.equal("model" in sent.at(-1), false, "without a known model it doesn't publish");
});

test("cache lifetime: Codex and AGY don't report a lifetime", () => {
  const sent = [];
  const t = createContextTracker({ emit: (c, d) => sent.push(d), sessionId: "s", source: "codex", now: () => 42 });
  t.update(codexContext({ last: { totalTokens: 9000, cachedInputTokens: 7000 }, modelContextWindow: 272000 }));
  assert.equal(sent.at(-1).lastCallAt, 42);
  assert.equal("cacheTtlMs" in sent.at(-1), false);
});
