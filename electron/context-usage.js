// Contexto da sessão: quanto da janela do modelo está ocupado, e quando houve compactação.
// Fontes reais: Claude Code (usage do evento assistant + contextWindow do result + compact_boundary)
// e Codex (thread/tokenUsage/updated). O AGY informa o uso de cada chamada (usage.input_tokens da
// etapa agent_response), mas não a janela do modelo.
const num = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);

// Contexto ocupado numa chamada = entrada + cache lido + cache criado (a saída entra na próxima).
function claudeContextUsed(usage) {
  if (!usage || typeof usage !== "object") return null;
  const used = num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens);
  return used > 0 ? used : null;
}

// Escolhe a janela do modelo da conversa principal. A chave de modelUsage pode ter sufixo (ex.: [1m])
// ou haver modelos de subagente/título: casa pelo nome e, na dúvida, vale o modelo mais usado.
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

// Cache de prompt da última chamada: o que foi lido (barato) e o que foi escrito (caro, acontece
// quando o cache expirou ou o prefixo mudou). Só entra quando a CLI informa algum dos dois.
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

// Validade do cache que a chamada escreveu. O Claude Code informa por TTL (verificado com a CLI real,
// 2.1.316: cache_creation.ephemeral_1h_input_tokens). Uma chamada só de leitura não diz nada: null.
const CACHE_TTL_1H = 60 * 60 * 1000;
const CACHE_TTL_5M = 5 * 60 * 1000;
function claudeCacheTtl(usage) {
  const created = usage?.cache_creation;
  if (!created || typeof created !== "object") return null;
  if (num(created.ephemeral_1h_input_tokens) > 0) return CACHE_TTL_1H;
  if (num(created.ephemeral_5m_input_tokens) > 0) return CACHE_TTL_5M;
  return null;
}

// AGY 1.4.12: usage.cache_read_tokens da etapa agent_response (subconjunto de input_tokens).
// Não informa escrita nem validade do cache.
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

// `model` é o modelo como escolhido no app (antes de resolver aliases): o cache de prompt é separado
// por modelo, então trocar a escolha reprocessa o contexto inteiro.
function createContextTracker({ emit = () => {}, sessionId, source, model, now = Date.now }) {
  const state = {
    used: null,
    cache: null,
    // Última chamada ao modelo (lê e renova o cache) e validade do cache, quando a CLI informa.
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
      // Sem janela informada pela CLI não há estimativa: a barra mostra só os tokens reais em uso.
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
      // O Codex pode avisar a mesma compactação por mais de um evento: conta uma só vez.
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
