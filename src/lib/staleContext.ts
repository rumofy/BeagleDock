import type { ContextInfo } from "../types";

/** Tempo de vida do cache de prompt observado (Claude Code: ephemeral_1h). Depois disso, o contexto
 *  inteiro é reprocessado na próxima mensagem. É uma estimativa: a CLI não informa a expiração. */
export const CACHE_TTL_MS = 60 * 60 * 1000;
/** Abaixo disso o reprocessamento é barato demais para valer um aviso. */
export const STALE_MIN_TOKENS = 100_000;

export interface StaleContext {
  used: number;
  idleMs: number;
}

/** Conversa parada além do cache com contexto grande: a próxima mensagem sai cara. */
export function staleContext(info: ContextInfo | undefined, now: number): StaleContext | null {
  if (!info || info.compacting) return null;
  const used = info.used;
  if (typeof used !== "number" || !Number.isFinite(used) || used < STALE_MIN_TOKENS) return null;
  if (typeof info.updatedAt !== "number" || !Number.isFinite(info.updatedAt)) return null;
  const idleMs = now - info.updatedAt;
  return idleMs >= CACHE_TTL_MS ? { used, idleMs } : null;
}

/** "1 h", "4 h 20 min", "2 dias". */
export function formatIdle(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 48) return `${Math.floor(hours / 24)} dias`;
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
