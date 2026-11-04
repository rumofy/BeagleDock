import { memo } from "react";
import { Minimize2, Timer } from "lucide-react";
import { useNow } from "../hooks/useNow";
import {
  cacheStatus,
  formatIdle,
  formatRemaining,
  GROWTH_ALERT,
  modelSwitch,
} from "../lib/staleContext";
import { contextLevel, contextPercent, formatTokens } from "../lib/tokens";
import type { ContextInfo } from "../types";

import { t } from "../i18n";
const BAR = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  danger: "bg-rose-600",
} as const;
const TEXT = {
  ok: "text-[#6d6657]",
  warn: "text-amber-800",
  danger: "text-rose-700",
} as const;

/** Cache write size from which the call is highlighted as expensive. */
const CACHE_WRITE_ALERT = 100_000;

function cacheText(cache?: { read?: number; write?: number }): string {
  if (!cache) return "";
  const parts: string[] = [];
  if (cache.read !== undefined) parts.push(t("context.cacheRead", { tokens: formatTokens(cache.read) }));
  if (cache.write !== undefined) parts.push(t("context.cacheWritten", { tokens: formatTokens(cache.write) }));
  return parts.length ? t("context.cacheParts", { parts: parts.join(" · ") }) : "";
}

/** With this much left, the warm cache is highlighted: worth sending the next message soon. */
const CACHE_ENDING_MS = 5 * 60 * 1000;

/**
 * Prompt cache validity. With the validity reported by the CLI (Claude Code), shows the countdown
 * until the cache expires; without it (Codex, AGY), only the time since the last call.
 */
function CacheTimer({ info, busy }: { info?: ContextInfo; busy: boolean }) {
  // 1 s clock only in the last minute; before that, 15 s is enough for a countdown in minutes.
  const initial = cacheStatus(info, Date.now());
  const fast = initial?.kind === "warm" && initial.remainingMs <= 70_000;
  const now = useNow(!!initial && !busy, fast ? 1000 : 15_000);
  const status = cacheStatus(info, Math.max(now, Date.now() - 1000));
  if (!status) return null;
  if (busy)
    return (
      <span className="shrink-0 flex items-center gap-1 text-emerald-700" data-testid="context-cache-timer">
        <Timer size={11} /> cache em uso
      </span>
    );
  if (status.kind === "unknown")
    return (
      <span
        className="shrink-0 flex items-center gap-1 text-[#938b7a]"
        title={t("context.cacheUnknownHint")}
        data-testid="context-cache-timer"
      >
        <Timer size={11} /> {t("context.cacheUnknown", { idle: formatIdle(status.idleMs) })}
      </span>
    );
  const ttl = formatRemaining(status.ttlMs);
  if (status.kind === "expired")
    return (
      <span
        className="shrink-0 flex items-center gap-1 font-semibold text-amber-800"
        title={t("context.cacheExpiredHint", { ttl })}
        data-testid="context-cache-timer"
      >
        <Timer size={11} /> {t("context.cacheExpired", { idle: formatIdle(status.idleMs - status.ttlMs) })}
      </span>
    );
  const ending = status.remainingMs <= CACHE_ENDING_MS;
  const percent = (status.remainingMs / status.ttlMs) * 100;
  return (
    <span
      className={`shrink-0 flex items-center gap-1.5 ${ending ? "font-semibold text-amber-800" : "text-emerald-700"}`}
      title={t("context.cacheWarmHint", { ttl })}
      data-testid="context-cache-timer"
    >
      <Timer size={11} />
      <span
        className="relative h-1.5 w-10 rounded-full bg-[#e6e0d2] overflow-hidden"
        role="progressbar"
        aria-label={t("context.cacheRemainingLabel")}
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          className={`absolute inset-y-0 left-0 ${ending ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      {t("context.cacheExpiresIn", { remaining: formatRemaining(status.remainingMs) })}
    </span>
  );
}

/** Session context bar: how full the model window is, compaction in progress and the last one done. */
export const ContextBar = memo(function ContextBar({
  info,
  providerId,
  selectedModel,
  busy,
  onCompact,
}: {
  info?: ContextInfo;
  providerId?: string;
  /** Model for the next message; if it differs from the last call's, the cache doesn't help. */
  selectedModel?: string;
  busy: boolean;
  onCompact?: () => void;
}) {
  const percent = contextPercent(info?.used ?? null, info?.window ?? null);
  const level = contextLevel(percent);
  const canCompact =
    providerId === "claude" || providerId === "codex" || providerId === "antigravity";
  const hasData = info?.used !== null && info?.used !== undefined;
  const last = info?.lastCompaction;
  const cache = info?.cache;
  const cacheLabel = cacheText(cache);
  const cacheHeavy = (cache?.write ?? 0) >= CACHE_WRITE_ALERT;
  const growth = info?.turnGrowth;
  const growthHeavy = (growth ?? 0) >= GROWTH_ALERT;
  const switched = selectedModel === undefined ? null : modelSwitch(info, selectedModel);
  return (
    <div
      className="flex items-center gap-3 px-3 py-1.5 rounded-xl border border-[#e4dec9] bg-[#faf8f4] text-[11px]"
      data-testid="context-bar"
    >
      <span className="font-bold text-[#443e33] shrink-0">{t("context.label")}</span>
      {!hasData ? (
        <span className="text-[#938b7a] truncate">
          {t("context.afterFirstReply")}
        </span>
      ) : (
        <>
          {percent !== null && (
            <div
              className="relative h-2 flex-1 min-w-[80px] max-w-[260px] rounded-full bg-[#e6e0d2] overflow-hidden"
              role="progressbar"
              aria-label={t("context.sessionLabel")}
              aria-valuenow={Math.round(percent)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`absolute inset-y-0 left-0 ${BAR[level]} transition-[width] duration-300`}
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
          <span className={`font-mono shrink-0 ${TEXT[level]}`}>
            {percent === null
              ? t("context.usedNoWindow", { used: formatTokens(info?.used) })
              : `${Math.round(percent)}% · ${formatTokens(info?.used)} / ${formatTokens(info?.window)}`}
          </span>
          {cacheLabel && (
            <span
              className={`shrink-0 font-mono ${cacheHeavy ? "font-bold text-amber-800" : "text-[#938b7a]"}`}
              title={
                cacheHeavy
                  ? t("context.cacheHeavyHint")
                  : t("context.cacheHint")
              }
              data-testid="context-cache"
            >
              {cacheLabel}
            </span>
          )}
          {growth !== undefined && growth >= 1000 && (
            <span
              className={`shrink-0 font-mono ${growthHeavy ? "font-bold text-amber-800" : "text-[#938b7a]"}`}
              title={
                growthHeavy
                  ? t("context.growthHeavyHint")
                  : t("context.growthHint")
              }
              data-testid="context-growth"
            >
              {t("context.growth", { tokens: formatTokens(growth) })}
            </span>
          )}
          {switched && !busy ? (
            <span
              className="shrink-0 font-semibold text-amber-800"
              title={t("context.modelSwitchHint")}
              data-testid="context-model-switch"
            >
              {t("context.modelSwitch", { tokens: formatTokens(switched.used) })}
            </span>
          ) : (
            <CacheTimer info={info} busy={busy} />
          )}
        </>
      )}
      {info?.compacting && (
        <span
          role="status"
          className="shrink-0 flex items-center gap-1 font-bold text-white bg-amber-600 rounded-full px-2 py-0.5 animate-pulse"
        >
          <Minimize2 size={10} /> {t("context.compacting")}
        </span>
      )}
      {!info?.compacting && last && (last.pre || last.post) && (
        <span
          className="shrink-0 text-[#7d7565]"
          title={last.trigger === "manual" ? t("context.compactionManual") : t("context.compactionAuto")}
        >
          {t("context.compacted", { pre: formatTokens(last.pre), post: formatTokens(last.post) })}
        </span>
      )}
      {level !== "ok" && !info?.compacting && (
        <span className={`shrink-0 font-semibold ${TEXT[level]}`}>
          {level === "danger" ? t("context.almostFull") : t("context.considerCompacting")}
        </span>
      )}
      <span className="ml-auto shrink-0">
        {canCompact ? (
          <button
            type="button"
            onClick={onCompact}
            disabled={busy || !!info?.compacting}
            title={
              busy
                ? t("context.waitRun")
                : t("context.compactHint")
            }
            className="px-2.5 py-1 rounded-lg border border-[#d6cfbe] bg-[#f4f1e8] hover:bg-[#ede9de] disabled:opacity-40 font-bold text-[#2c2822]"
          >
            {t("context.compact")}
          </button>
        ) : (
          <span
            className="text-[#938b7a]"
            title={t("context.noCompactionHint")}
          >
            {t("context.noCompaction")}
          </span>
        )}
      </span>
    </div>
  );
});
