// Context limit above which the conversation compacts itself, while the prompt cache
// is still warm. Without it, a conversation that grows to hundreds of thousands of tokens and sits
// idle pays for the whole context again when resumed (expired cache), burning a lot of quota.
// Verified with the real CLIs: Claude Code 2.1.316 (CLAUDE_CODE_AUTO_COMPACT_WINDOW) and
// Codex CLI 0.166.0 (model_auto_compact_token_limit). AGY has no configurable limit.
const DEFAULT_AUTO_COMPACT_TOKENS = 200_000;
// Claude Code only accepts 100 thousand to 1 million tokens.
const MIN_AUTO_COMPACT_TOKENS = 100_000;
const MAX_AUTO_COMPACT_TOKENS = 1_000_000;

// undefined → default; 0 → off; any other value is clamped to the range the CLIs accept.
function resolveAutoCompactTokens(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_AUTO_COMPACT_TOKENS;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_AUTO_COMPACT_TOKENS;
  if (n <= 0) return 0;
  return Math.min(MAX_AUTO_COMPACT_TOKENS, Math.max(MIN_AUTO_COMPACT_TOKENS, Math.round(n)));
}

// With no value chosen by the user (undefined/null) the limit follows the model's window: 40% of it,
// from 100 thousand to 1 million. A window up to 200 thousand, or still unknown, keeps the 200 thousand default.
// A chosen value (or 0, which turns it off) always applies as is.
const AUTO_COMPACT_FRACTION = 0.4;
function resolveAutoCompactForWindow(value, window) {
  const chosen = value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value));
  if (chosen || !Number.isFinite(window) || window <= DEFAULT_AUTO_COMPACT_TOKENS)
    return resolveAutoCompactTokens(value);
  const derived = Math.round((window * AUTO_COMPACT_FRACTION) / 10_000) * 10_000;
  return Math.min(MAX_AUTO_COMPACT_TOKENS, Math.max(MIN_AUTO_COMPACT_TOKENS, derived));
}

module.exports = {
  resolveAutoCompactForWindow,
  DEFAULT_AUTO_COMPACT_TOKENS,
  MIN_AUTO_COMPACT_TOKENS,
  MAX_AUTO_COMPACT_TOKENS,
  resolveAutoCompactTokens,
};
