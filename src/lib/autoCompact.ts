/** Padrão e opções da compactação automática do contexto (0 = desligada). */
export const DEFAULT_AUTO_COMPACT_TOKENS = 200_000;
export const AUTO_COMPACT_CHOICES = [100_000, 150_000, 200_000, 300_000, 400_000, 600_000, 1_000_000];

/** undefined → padrão; valores fora do intervalo aceito pelas CLIs são limitados, 0 desliga. */
export function resolveAutoCompact(value: number | undefined | null): number {
  if (value === undefined || value === null || !Number.isFinite(value)) return DEFAULT_AUTO_COMPACT_TOKENS;
  if (value <= 0) return 0;
  return Math.min(1_000_000, Math.max(100_000, Math.round(value)));
}
