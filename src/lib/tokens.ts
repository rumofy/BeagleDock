import { decimal, t } from "../i18n";
/** "850", "15.4k", "1.0M" (with a decimal comma in Spanish and Portuguese). */
export function formatTokens(value: number | null | undefined): string {
  if (!Number.isFinite(value as number) || (value as number) < 0) return t("common.na");
  const n = value as number;
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${decimal(n / 1000, n < 10_000 ? 1 : 0)}k`;
  return `${decimal(n / 1_000_000, 1)}M`;
}

export type ContextLevel = "ok" | "warn" | "danger";

export function contextPercent(used: number | null, window: number | null): number | null {
  if (!Number.isFinite(used as number) || !Number.isFinite(window as number) || (window as number) <= 0)
    return null;
  return Math.min(100, Math.max(0, ((used as number) / (window as number)) * 100));
}

export function contextLevel(percent: number | null): ContextLevel {
  if (percent === null) return "ok";
  if (percent >= 90) return "danger";
  if (percent >= 70) return "warn";
  return "ok";
}
