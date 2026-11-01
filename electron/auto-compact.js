// Limite de contexto a partir do qual a conversa é compactada sozinha, enquanto o cache de prompt
// ainda está quente. Sem isso, uma conversa que cresce até centenas de milhares de tokens e fica
// parada paga o contexto inteiro de novo ao ser retomada (cache expirado), consumindo muita cota.
// Verificado com as CLIs reais: Claude Code 2.1.316 (CLAUDE_CODE_AUTO_COMPACT_WINDOW) e
// Codex CLI 0.166.0 (model_auto_compact_token_limit). O AGY não tem limite configurável.
const DEFAULT_AUTO_COMPACT_TOKENS = 200_000;
// O Claude Code só aceita de 100 mil a 1 milhão de tokens.
const MIN_AUTO_COMPACT_TOKENS = 100_000;
const MAX_AUTO_COMPACT_TOKENS = 1_000_000;

// undefined → padrão; 0 → desligado; qualquer outro valor é limitado ao intervalo aceito pelas CLIs.
function resolveAutoCompactTokens(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_AUTO_COMPACT_TOKENS;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_AUTO_COMPACT_TOKENS;
  if (n <= 0) return 0;
  return Math.min(MAX_AUTO_COMPACT_TOKENS, Math.max(MIN_AUTO_COMPACT_TOKENS, Math.round(n)));
}

module.exports = {
  DEFAULT_AUTO_COMPACT_TOKENS,
  MIN_AUTO_COMPACT_TOKENS,
  MAX_AUTO_COMPACT_TOKENS,
  resolveAutoCompactTokens,
};
