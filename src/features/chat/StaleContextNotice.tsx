import { AlertTriangle } from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";
import { formatIdle } from "../../lib/staleContext";
import { formatTokens } from "../../lib/tokens";

/** Aviso antes de enviar numa conversa grande e parada: o cache expirou e a mensagem sairia cara. */
export function StaleContextNotice() {
  const { staleNotice, resolveStaleNotice, activeSessionId } = useApp();
  if (!staleNotice || staleNotice.session.id !== activeSessionId) return null;
  const button = "px-3 py-1.5 rounded-lg border font-bold disabled:opacity-40";
  return (
    <div
      role="alertdialog"
      aria-label="Conversa grande e parada"
      className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950"
      data-testid="stale-context-notice"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="font-bold">
            Esta conversa está parada há {formatIdle(staleNotice.idleMs)} e tem {formatTokens(staleNotice.used)} tokens de contexto.
          </p>
          <p>
            O cache de prompt provavelmente expirou: a próxima mensagem reprocessa o contexto inteiro (cerca de{" "}
            {formatTokens(staleNotice.used)} tokens) e pode consumir bastante cota. Depois dela o cache volta a ficar quente.
            Compactar antes paga essa leitura uma vez e deixa as próximas mensagens muito mais baratas, mas resume o
            histórico antigo.
          </p>
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
