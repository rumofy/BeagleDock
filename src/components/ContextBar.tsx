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

/** Faltando isto, o cache quente é destacado: vale mandar a próxima mensagem logo. */
const CACHE_ENDING_MS = 5 * 60 * 1000;

/**
 * Validade do cache de prompt. Com a validade informada pela CLI (Claude Code), mostra a contagem
 * regressiva até o cache expirar; sem ela (Codex, AGY), só o tempo desde a última chamada.
 */
function CacheTimer({ info, busy }: { info?: ContextInfo; busy: boolean }) {
  // Relógio de 1 s só no último minuto; antes disso 15 s bastam para a contagem em minutos.
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
        title="Esta CLI não informa por quanto tempo o cache de prompt fica guardado. Quanto mais tempo parada, maior a chance de a próxima mensagem reprocessar o contexto inteiro."
        data-testid="context-cache-timer"
      >
        <Timer size={11} /> última chamada há {formatIdle(status.idleMs)} · validade do cache não informada
      </span>
    );
  const ttl = formatRemaining(status.ttlMs);
  if (status.kind === "expired")
    return (
      <span
        className="shrink-0 flex items-center gap-1 font-semibold text-amber-800"
        title={`O cache de prompt (validade de ${ttl}) expirou: a próxima mensagem reprocessa o contexto inteiro e consome mais cota. Depois dela o cache volta a ficar quente.`}
        data-testid="context-cache-timer"
      >
        <Timer size={11} /> cache expirado há {formatIdle(status.idleMs - status.ttlMs)}
      </span>
    );
  const ending = status.remainingMs <= CACHE_ENDING_MS;
  const percent = (status.remainingMs / status.ttlMs) * 100;
  return (
    <span
      className={`shrink-0 flex items-center gap-1.5 ${ending ? "font-semibold text-amber-800" : "text-emerald-700"}`}
      title={`Cache de prompt quente (validade de ${ttl}, renovada a cada mensagem). Enquanto estiver quente, a próxima mensagem lê o contexto do cache, o que é bem mais barato.`}
      data-testid="context-cache-timer"
    >
      <Timer size={11} />
      <span
        className="relative h-1.5 w-10 rounded-full bg-[#e6e0d2] overflow-hidden"
        role="progressbar"
        aria-label="Validade restante do cache"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          className={`absolute inset-y-0 left-0 ${ending ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      cache expira em {formatRemaining(status.remainingMs)}
    </span>
  );
}

/** Barra do contexto da sessão: ocupação da janela do modelo, compactação em curso e a última feita. */
export const ContextBar = memo(function ContextBar({
  info,
  providerId,
  selectedModel,
  busy,
  onCompact,
}: {
  info?: ContextInfo;
  providerId?: string;
  /** Modelo que vai na próxima mensagem; diferente do da última chamada, o cache não serve. */
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
          {growth !== undefined && growth >= 1000 && (
            <span
              className={`shrink-0 font-mono ${growthHeavy ? "font-bold text-amber-800" : "text-[#938b7a]"}`}
              title={
                growthHeavy
                  ? "A última resposta acrescentou muito ao contexto, em geral um arquivo grande, um log ou a saída longa de um comando. Isso fica no histórico e encarece cada mensagem seguinte e cada retomada. Peça trechos menores (ex.: só as linhas relevantes) ou compacte."
                  : "Quanto a última resposta acrescentou ao contexto."
              }
              data-testid="context-growth"
            >
              +{formatTokens(growth)} na última resposta
            </span>
          )}
          {switched && !busy ? (
            <span
              className="shrink-0 font-semibold text-amber-800"
              title="O cache de prompt é separado por modelo: com o modelo trocado, a próxima mensagem reprocessa o contexto inteiro, mesmo com o cache quente."
              data-testid="context-model-switch"
            >
              modelo trocado: a próxima mensagem reprocessa {formatTokens(switched.used)}
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
