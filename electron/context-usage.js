// Session context: how much of the model's window is used, and when a compaction happened.
// Real sources: Claude Code (usage of the assistant event + contextWindow of the result + compact_boundary)
// and Codex (thread/tokenUsage/updated). AGY reports the usage of each call (usage.input_tokens of the
// agent_response step), but not the model's window.
const num = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);

// Context used in a call = input + cache read + cache created (the output goes into the next one).
function claudeContextUsed(usage) {
  if (!usage || typeof usage !== "object") return null;
  const used = num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens);
  return used > 0 ? used : null;
}

// Picks the main conversation's model window. The modelUsage key may have a suffix (e.g. [1m])
// or there may be subagent/title models: match by name and, when in doubt, the most used model wins.
function pickModelWindow(modelUsage, preferredModel) {
  if (!modelUsage || typeof modelUsage !== "object") return null;
  const entries = Object.entries(modelUsage).filter(([, v]) => Number.isFinite(v?.contextWindow));
  if (!entries.length) return null;
  const model = String(preferredModel || "");
  const byName =
    entries.find(([name]) => name === model) ||
    entries.find(([name]) => model && (name.startsWith(model) || model.startsWith(name)));
  if (byName) return byName[1].contextWindow;
  const volume = (v) =>
    num(v.inputTokens) + num(v.outputTokens) + num(v.cacheReadInputTokens) + num(v.cacheCreationInputTokens);
  return entries.sort((a, b) => volume(b[1]) - volume(a[1]))[0][1].contextWindow;
}

// Prompt cache of the last call: what was read (cheap) and what was written (expensive, happens
// when the cache expired or the prefix changed). Only included when the CLI reports one of them.
function cacheUsage(read, write) {
  const hasRead = Number.isFinite(read) && read >= 0;
  const hasWrite = Number.isFinite(write) && write >= 0;
  if (!hasRead && !hasWrite) return null;
  return { ...(hasRead ? { read } : {}), ...(hasWrite ? { write } : {}) };
}

function claudeCacheUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  return cacheUsage(usage.cache_read_input_tokens, usage.cache_creation_input_tokens);
}

// Lifetime of the cache the call wrote. Claude Code reports it by TTL (verified with the real CLI,
// 2.1.316: cache_creation.ephemeral_1h_input_tokens). A read-only call says nothing: null.
const CACHE_TTL_1H = 60 * 60 * 1000;
const CACHE_TTL_5M = 5 * 60 * 1000;
function claudeCacheTtl(usage) {
  const created = usage?.cache_creation;
  if (!created || typeof created !== "object") return null;
  if (num(created.ephemeral_1h_input_tokens) > 0) return CACHE_TTL_1H;
  if (num(created.ephemeral_5m_input_tokens) > 0) return CACHE_TTL_5M;
  return null;
}

// AGY 1.4.12: usage.cache_read_tokens of the agent_response step (a subset of input_tokens).
// It doesn't report cache writes or lifetime.
function agyCacheUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  return cacheUsage(usage.cache_read_tokens, undefined);
}

function codexContext(tokenUsage) {
  const used = num(tokenUsage?.last?.totalTokens);
  const window = Number.isFinite(tokenUsage?.modelContextWindow) ? tokenUsage.modelContextWindow : null;
  if (!(used > 0)) return null;
  const cache = cacheUsage(tokenUsage?.last?.cachedInputTokens, tokenUsage?.last?.cacheWriteInputTokens);
  return { used, window, ...(cache ? { cache } : {}) };
}

// `model` is the model as chosen in the app (before resolving aliases): the prompt cache is separate
// per model, so changing the choice reprocesses the whole context.
function createContextTracker({ emit = () => {}, sessionId, source, model, now = Date.now }) {
  const state = {
    used: null,
    cache: null,
    // Last model call (reads and renews the cache) and cache lifetime, when the CLI reports it.
    lastCallAt: null,
    cacheTtlMs: null,
    window: null,
    windowKnown: false,
    compacting: false,
    compactions: 0,
    last: null,
  };
  const publish = () =>
    emit("cli-context", { sessionId, ...snapshot() });
  function snapshot() {
    return {
      source,
      used: state.used,
      ...(state.cache ? { cache: state.cache } : {}),
      ...(state.lastCallAt !== null ? { lastCallAt: state.lastCallAt } : {}),
      ...(state.cacheTtlMs !== null ? { cacheTtlMs: state.cacheTtlMs } : {}),
      ...(typeof model === "string" ? { model } : {}),
      window: state.window,
      windowKnown: state.windowKnown,
      compacting: state.compacting,
      compactions: state.compactions,
      ...(state.last ? { lastCompaction: state.last } : {}),
      updatedAt: now(),
    };
  }
  return {
    update({ used, window, windowKnown, model, cache, cacheTtlMs }) {
      if (Number.isFinite(used)) {
        state.used = used;
        state.lastCallAt = now();
      }
      if (cache) state.cache = cache;
      if (Number.isFinite(cacheTtlMs) && cacheTtlMs > 0) state.cacheTtlMs = cacheTtlMs;
      if (Number.isFinite(window)) {
        state.window = window;
        state.windowKnown = windowKnown !== false;
      }
      // Without a window reported by the CLI there's no estimate: the bar shows only the real tokens in use.
      publish();
    },
    setWindow(window, known = true) {
      if (!Number.isFinite(window)) return;
      state.window = window;
      state.windowKnown = known;
      publish();
    },
    compacting(value) {
      if (state.compacting === !!value) return;
      state.compacting = !!value;
      publish();
    },
    compacted({ pre, post, trigger } = {}) {
      // Codex may report the same compaction through more than one event: count it once.
      if (!state.compacting && state.last && now() - state.last.at < 2000) {
        state.last = {
          ...state.last,
          ...(Number.isFinite(pre) ? { pre } : {}),
          ...(Number.isFinite(post) ? { post } : {}),
        };
        if (Number.isFinite(post)) state.used = post;
        publish();
        return;
      }
      state.compacting = false;
      state.compactions += 1;
      state.last = {
        ...(Number.isFinite(pre) ? { pre } : {}),
        ...(Number.isFinite(post) ? { post } : {}),
        ...(trigger ? { trigger: String(trigger) } : {}),
        at: now(),
      };
      if (Number.isFinite(post)) state.used = post;
      publish();
    },
    snapshot,
    hasData: () => state.used !== null,
  };
}

module.exports = {
  claudeContextUsed,
  claudeCacheUsage,
  claudeCacheTtl,
  agyCacheUsage,
  pickModelWindow,
  codexContext,
  createContextTracker,
};
