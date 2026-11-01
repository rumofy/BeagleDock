import { memo } from "react";
import { Minimize2 } from "lucide-react";
import { contextLevel, contextPercent, formatTokens } from "../lib/tokens";
import type { ContextInfo } from "../types";

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

/** Escrita de cache a partir da qual a chamada é destacada como cara. */
const CACHE_WRITE_ALERT = 100_000;

function cacheText(cache?: { read?: number; write?: number }): string {
  if (!cache) return "";
  const parts: string[] = [];
  if (cache.read !== undefined) parts.push(`lido ${formatTokens(cache.read)}`);
  if (cache.write !== undefined) parts.push(`escrito ${formatTokens(cache.write)}`);
  return parts.length ? `cache: ${parts.join(" · ")}` : "";
}

/** Barra do contexto da sessão: ocupação da janela do modelo, compactação em curso e a última feita. */
export const ContextBar = memo(function ContextBar({
  info,
  providerId,
  busy,
  onCompact,
}: {
  info?: ContextInfo;
  providerId?: string;
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
  return (
    <div
      className="flex items-center gap-3 px-3 py-1.5 rounded-xl border border-[#e4dec9] bg-[#faf8f4] text-[11px]"
      data-testid="context-bar"
    >
      <span className="font-bold text-[#443e33] shrink-0">Contexto</span>
      {!hasData ? (
        <span className="text-[#938b7a] truncate">
          aparece depois da primeira resposta
        </span>
      ) : (
        <>
          {percent !== null && (
            <div
              className="relative h-2 flex-1 min-w-[80px] max-w-[260px] rounded-full bg-[#e6e0d2] overflow-hidden"
              role="progressbar"
              aria-label="Contexto da sessão"
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
              ? `${formatTokens(info?.used)} em uso · janela não informada pela CLI`
              : `${Math.round(percent)}% · ${formatTokens(info?.used)} / ${formatTokens(info?.window)}`}
          </span>
          {cacheLabel && (
            <span
              className={`shrink-0 font-mono ${cacheHeavy ? "font-bold text-amber-800" : "text-[#938b7a]"}`}
              title={
                cacheHeavy
                  ? "Cache de prompt reescrito: o contexto inteiro foi reprocessado e consome bastante cota. Acontece quando a conversa fica parada além do tempo do cache. Compactar com a conversa ativa reduz esse custo."
                  : "Cache de prompt da última chamada: lido é barato; escrito é caro."
              }
              data-testid="context-cache"
            >
              {cacheLabel}
            </span>
          )}
        </>
      )}
      {info?.compacting && (
        <span
          role="status"
          className="shrink-0 flex items-center gap-1 font-bold text-white bg-amber-600 rounded-full px-2 py-0.5 animate-pulse"
        >
          <Minimize2 size={10} /> compactando…
        </span>
      )}
      {!info?.compacting && last && (last.pre || last.post) && (
        <span
          className="shrink-0 text-[#7d7565]"
          title={`Compactação ${last.trigger === "manual" ? "manual" : "automática"}`}
        >
          compactado: {formatTokens(last.pre)} → {formatTokens(last.post)}
        </span>
      )}
      {level !== "ok" && !info?.compacting && (
        <span className={`shrink-0 font-semibold ${TEXT[level]}`}>
          {level === "danger" ? "quase cheio" : "considere compactar"}
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
                ? "Aguarde o fim da execução"
                : "Compacta o histórico para liberar contexto"
            }
            className="px-2.5 py-1 rounded-lg border border-[#d6cfbe] bg-[#f4f1e8] hover:bg-[#ede9de] disabled:opacity-40 font-bold text-[#2c2822]"
          >
            Compactar
          </button>
        ) : (
          <span
            className="text-[#938b7a]"
            title="Esta CLI não oferece compactação"
          >
            sem compactação
          </span>
        )}
      </span>
    </div>
  );
});
