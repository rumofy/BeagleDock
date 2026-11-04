import type { ContextInfo } from "../types";

import { t, tn } from "../i18n";
/** Observed prompt cache lifetime (Claude Code: ephemeral_1h). Used when the CLI doesn't report
 *  the validity of the last write; after that the whole context is processed again. */
export const CACHE_TTL_MS = 60 * 60 * 1000;
/** Below this, reprocessing is too cheap to be worth a warning. */
export const STALE_MIN_TOKENS = 100_000;

export interface StaleContext {
  used: number;
  idleMs: number;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Time of the last model call; contexts saved before this field existed use `updatedAt`. */
function lastCall(info: ContextInfo): number | null {
  if (finite(info.lastCallAt)) return info.lastCallAt;
  return finite(info.updatedAt) ? info.updatedAt : null;
}

/** Cache validity: the one reported by the CLI or the observed 1 h estimate. */
function cacheTtl(info: ContextInfo): number {
  return finite(info.cacheTtlMs) && info.cacheTtlMs > 0 ? info.cacheTtlMs : CACHE_TTL_MS;
}

/** Conversation idle past the cache with a large context: the next message will be expensive. */
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
 * State of the conversation's prompt cache, for the context bar indicator.
 * - `warm`/`expired`: the CLI reported the validity (Claude Code); the countdown is real.
 * - `unknown`: the CLI doesn't report it (Codex, AGY); only the time since the last call is real.
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

/** "12 min", "4 h 20 min", "2 days" (in the interface language). */
export function formatIdle(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return t("time.lessThanMinute");
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 48) return tn("time.days", Math.floor(hours / 24));
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** Remaining time rounded up: "42 min", "1 h", "30 s" in the last minute. */
export function formatRemaining(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.ceil(ms / 1000))} s`;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/**
 * Model switch in a large conversation. The prompt cache is per model, so the next message
 * processes the whole context again even with a warm cache. `model` in the context is the model of
 * the last call, as chosen in the app; `selected` is what will be sent now.
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

/** From this size the reply is highlighted: something big entered the context (file, log, output). */
export const GROWTH_ALERT = 50_000;

/** Comparison point between turns: context at the end of a reply and the last compaction seen. */
export interface TurnMark {
  used: number;
  compactedAt?: number;
}

export function turnMark(info: Partial<ContextInfo> | undefined): TurnMark | null {
  if (!info || !finite(info.used)) return null;
  const at = info.lastCompaction?.at;
  return { used: info.used, ...(finite(at) ? { compactedAt: at } : {}) };
}

/** How much the context grew in a reply. Null without a reference or with a compaction in between. */
export function turnGrowth(before: TurnMark | null | undefined, after: TurnMark | null): number | null {
  if (!before || !after) return null;
  if (after.compactedAt !== undefined && after.compactedAt !== before.compactedAt) return null;
  return after.used - before.used;
}

/** Below this, compacting before the cache expires doesn't pay off: it costs about as much as reprocessing. */
export const PRECOMPACT_MIN_TOKENS = 200_000;
/** Window before the cache ends in which the preventive compaction runs. */
export const PRECOMPACT_WINDOW_MS = 5 * 60_000;

/**
 * Idle conversation with a large context and a cache (whose validity the CLI reports) about to expire:
 * compacting now reads the context from the cache, which is cheap; once it expires, the next message
 * would process everything again at full price. Returns the time of the last call (the "already done" key).
 */
export function precompactDue(info: ContextInfo | undefined, now: number): number | null {
  if (!info || info.compacting) return null;
  if (!finite(info.used) || info.used < PRECOMPACT_MIN_TOKENS) return null;
  const status = cacheStatus(info, now);
  if (status?.kind !== "warm" || status.remainingMs > PRECOMPACT_WINDOW_MS) return null;
  return info.lastCallAt ?? null;
}
