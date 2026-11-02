/** Padrão e opções da compactação automática do contexto (0 = desligada). */
export const DEFAULT_AUTO_COMPACT_TOKENS = 200_000;
export const AUTO_COMPACT_CHOICES = [100_000, 150_000, 200_000, 300_000, 400_000, 600_000, 1_000_000];
const AUTO_COMPACT_FRACTION = 0.4;

const chosen = (value: number | undefined | null): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Sem valor escolhido o limite acompanha a janela do modelo (40% dela, de 100 mil a 1 milhão);
 * janela de até 200 mil ou desconhecida mantém o padrão. Um valor escolhido vale como está
 * (limitado ao intervalo aceito pelas CLIs) e 0 desliga. Espelha `electron/auto-compact.js`.
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

/** O usuário escolheu um valor (inclusive 0)? Senão vale o automático. */
export const isAutoCompactChosen = chosen;
