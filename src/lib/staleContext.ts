import type { ContextInfo } from "../types";

/** Tempo de vida do cache de prompt observado (Claude Code: ephemeral_1h). Vale quando a CLI não
 *  informa a validade da última escrita; depois disso o contexto inteiro é reprocessado. */
export const CACHE_TTL_MS = 60 * 60 * 1000;
/** Abaixo disso o reprocessamento é barato demais para valer um aviso. */
export const STALE_MIN_TOKENS = 100_000;

export interface StaleContext {
  used: number;
  idleMs: number;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Momento da última chamada ao modelo; contextos salvos antes desse campo usam `updatedAt`. */
function lastCall(info: ContextInfo): number | null {
  if (finite(info.lastCallAt)) return info.lastCallAt;
  return finite(info.updatedAt) ? info.updatedAt : null;
}

/** Validade do cache: a informada pela CLI ou a estimativa observada de 1 h. */
function cacheTtl(info: ContextInfo): number {
  return finite(info.cacheTtlMs) && info.cacheTtlMs > 0 ? info.cacheTtlMs : CACHE_TTL_MS;
}

/** Conversa parada além do cache com contexto grande: a próxima mensagem sai cara. */
export function staleContext(info: ContextInfo | undefined, now: number): StaleContext | null {
  if (!info || info.compacting) return null;
  const used = info.used;
  if (typeof used !== "number" || !Number.isFinite(used) || used < STALE_MIN_TOKENS) return null;
  const at = lastCall(info);
  if (at === null) return null;
  const idleMs = now - at;
  return idleMs >= cacheTtl(info) ? { used, idleMs } : null;
}

/**
 * Estado do cache de prompt da conversa, para o indicador da barra de contexto.
 * - `warm`/`expired`: a CLI informou a validade (Claude Code), há contagem regressiva real.
 * - `unknown`: a CLI não informa a validade (Codex, AGY); só o tempo desde a última chamada é real.
 */
export type CacheStatus =
  | { kind: "warm"; remainingMs: number; ttlMs: number; idleMs: number }
  | { kind: "expired"; ttlMs: number; idleMs: number }
  | { kind: "unknown"; idleMs: number };

export function cacheStatus(info: ContextInfo | undefined, now: number): CacheStatus | null {
  if (!info) return null;
  const at = finite(info.lastCallAt) ? info.lastCallAt : null;
  if (at === null) return null;
  const idleMs = Math.max(0, now - at);
  if (!finite(info.cacheTtlMs) || info.cacheTtlMs <= 0) return { kind: "unknown", idleMs };
  const ttlMs = info.cacheTtlMs;
  const remainingMs = ttlMs - idleMs;
  return remainingMs > 0 ? { kind: "warm", remainingMs, ttlMs, idleMs } : { kind: "expired", ttlMs, idleMs };
}

/** "12 min", "4 h 20 min", "2 dias". */
export function formatIdle(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 48) return `${Math.floor(hours / 24)} dias`;
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** Tempo restante arredondado para cima: "42 min", "1 h", "30 s" no último minuto. */
export function formatRemaining(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.ceil(ms / 1000))} s`;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/**
 * Troca de modelo numa conversa grande. O cache de prompt é separado por modelo, então a próxima
 * mensagem reprocessa o contexto inteiro mesmo com o cache quente. `model` no contexto é o modelo
 * da última chamada, como escolhido no app; `selected` é o que vai ser enviado agora.
 */
export function modelSwitch(
  info: ContextInfo | undefined,
  selected: string,
): { from: string; to: string; used: number } | null {
  if (!info || info.compacting || typeof info.model !== "string") return null;
  const used = info.used;
  if (!finite(used) || used < STALE_MIN_TOKENS) return null;
  return info.model === selected ? null : { from: info.model, to: selected, used };
}

/** A partir disso a resposta é destacada: algo grande entrou no contexto (arquivo, log, saída). */
export const GROWTH_ALERT = 50_000;

/** Ponto de comparação entre turnos: contexto ao fim de uma resposta e a última compactação vista. */
export interface TurnMark {
  used: number;
  compactedAt?: number;
}

export function turnMark(info: Partial<ContextInfo> | undefined): TurnMark | null {
  if (!info || !finite(info.used)) return null;
  const at = info.lastCompaction?.at;
  return { used: info.used, ...(finite(at) ? { compactedAt: at } : {}) };
}

/** Quanto o contexto cresceu numa resposta. Sem referência ou com compactação no meio: null. */
export function turnGrowth(before: TurnMark | null | undefined, after: TurnMark | null): number | null {
  if (!before || !after) return null;
  if (after.compactedAt !== undefined && after.compactedAt !== before.compactedAt) return null;
  return after.used - before.used;
}

/** Abaixo disso compactar antes de o cache expirar não compensa: custa quase o mesmo que reprocessar. */
export const PRECOMPACT_MIN_TOKENS = 200_000;
/** Janela antes do fim do cache em que a compactação preventiva roda. */
export const PRECOMPACT_WINDOW_MS = 5 * 60_000;

/**
 * Conversa parada com contexto grande e cache (cuja validade a CLI informa) prestes a expirar:
 * compactar agora lê o contexto do cache, que é barato; depois de expirar, a próxima mensagem
 * reprocessaria tudo a preço cheio. Devolve o momento da última chamada (chave de "já feito").
 */
export function precompactDue(info: ContextInfo | undefined, now: number): number | null {
  if (!info || info.compacting) return null;
  if (!finite(info.used) || info.used < PRECOMPACT_MIN_TOKENS) return null;
  const status = cacheStatus(info, now);
  if (status?.kind !== "warm" || status.remainingMs > PRECOMPACT_WINDOW_MS) return null;
  return info.lastCallAt ?? null;
}
