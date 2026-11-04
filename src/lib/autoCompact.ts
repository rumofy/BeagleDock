/** Default and choices for automatic context compaction (0 = off). */
export const DEFAULT_AUTO_COMPACT_TOKENS = 200_000;
export const AUTO_COMPACT_CHOICES = [100_000, 150_000, 200_000, 300_000, 400_000, 600_000, 1_000_000];
const AUTO_COMPACT_FRACTION = 0.4;

const chosen = (value: number | undefined | null): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Without a chosen value the limit follows the model's window (40% of it, from 100k to 1M); a
 * window up to 200k, or an unknown one, keeps the default. A chosen value is used as is (clamped
 * to the range the CLIs accept) and 0 turns it off. Mirrors `electron/auto-compact.js`.
 */
export function resolveAutoCompact(
  value: number | undefined | null,
  window?: number | null,
): number {
  if (chosen(value)) {
    if (value <= 0) return 0;
    return Math.min(1_000_000, Math.max(100_000, Math.round(value)));
  }
  if (typeof window !== "number" || !Number.isFinite(window) || window <= DEFAULT_AUTO_COMPACT_TOKENS)
    return DEFAULT_AUTO_COMPACT_TOKENS;
  const derived = Math.round((window * AUTO_COMPACT_FRACTION) / 10_000) * 10_000;
  return Math.min(1_000_000, Math.max(100_000, derived));
}

/** Did the user choose a value (including 0)? Otherwise the automatic one applies. */
export const isAutoCompactChosen = chosen;
