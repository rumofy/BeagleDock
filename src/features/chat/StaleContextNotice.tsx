import { AlertTriangle } from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";
import { formatIdle } from "../../lib/staleContext";
import { formatTokens } from "../../lib/tokens";

const modelName = (model: string) => model || "padrão da CLI";

/**
 * Aviso antes de enviar numa conversa grande cujo contexto seria reprocessado inteiro: o cache
 * expirou (conversa parada) e/ou o modelo foi trocado (o cache é separado por modelo).
 */
export function StaleContextNotice() {
  const { staleNotice, resolveStaleNotice, activeSessionId } = useApp();
  if (!staleNotice || staleNotice.session.id !== activeSessionId) return null;
  const { used, idleMs, switched } = staleNotice;
  const tokens = formatTokens(used);
  const button = "px-3 py-1.5 rounded-lg border font-bold disabled:opacity-40";
  const title = switched
    ? idleMs !== undefined
      ? `Modelo trocado numa conversa parada há ${formatIdle(idleMs)} com ${tokens} tokens de contexto.`
      : `Modelo trocado numa conversa com ${tokens} tokens de contexto.`
    : `Esta conversa está parada há ${formatIdle(idleMs ?? 0)} e tem ${tokens} tokens de contexto.`;
  return (
    <div
      role="alertdialog"
      aria-label={switched ? "Modelo trocado numa conversa grande" : "Conversa grande e parada"}
      className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950"
      data-testid="stale-context-notice"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="font-bold">{title}</p>
          {switched ? (
            <p>
              O cache de prompt é separado por modelo: enviar com <b>{modelName(switched.to)}</b> reprocessa o contexto
              inteiro (cerca de {tokens} tokens) e pode consumir bastante cota.
              {idleMs === undefined
                ? ` Voltar para ${modelName(switched.from)} aproveita o cache, que ainda está quente.`
                : ""}{" "}
              Compactar antes, ainda em {modelName(switched.from)}, faz o novo modelo ler só o resumo, mas resume o
              histórico antigo.
            </p>
          ) : (
            <p>
              O cache de prompt provavelmente expirou: a próxima mensagem reprocessa o contexto inteiro (cerca de{" "}
              {tokens} tokens) e pode consumir bastante cota. Depois dela o cache volta a ficar quente. Compactar antes
              paga essa leitura uma vez e deixa as próximas mensagens muito mais baratas, mas resume o histórico antigo.
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void resolveStaleNotice("send")}
          className={`${button} border-amber-400 bg-white hover:bg-amber-100`}
        >
          Enviar assim mesmo
        </button>
        {switched && idleMs === undefined && (
          <button
            type="button"
            onClick={() => void resolveStaleNotice("previous")}
            className={`${button} border-amber-400 bg-white hover:bg-amber-100`}
          >
            Enviar com {modelName(switched.from)}
          </button>
        )}
        <button
          type="button"
          onClick={() => void resolveStaleNotice("compact")}
          className={`${button} border-amber-600 bg-amber-600 text-white hover:bg-amber-700`}
        >
          Compactar e enviar
        </button>
        <button
          type="button"
          onClick={() => void resolveStaleNotice("cancel")}
          className={`${button} border-transparent text-amber-900 hover:underline`}
        >
          Voltar e editar
        </button>
      </div>
    </div>
  );
}
