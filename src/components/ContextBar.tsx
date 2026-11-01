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
  const canCompact = providerId === "claude" || providerId === "codex";
  const hasData = info?.used !== null && info?.used !== undefined;
  const last = info?.lastCompaction;
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
            title="A compactação não está disponível em modo programático no AGY"
          >
            sem compactação no AGY
          </span>
        )}
      </span>
    </div>
  );
});
