import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useTempCleanup } from "./useTempCleanup";

/**
 * Limpeza dos projetos temporários do ai-memory: prazo em dias para a limpeza automática
 * e botão para apagar todos agora. Só entram projetos cujas sessões vieram todas de pastas
 * temporárias (testes com CLI real); projetos de verdade nunca aparecem aqui.
 */
export function TempCleanupPanel({ onCleaned }: { onCleaned: () => void }) {
  const t = useTempCleanup(onCleaned);
  const [confirming, setConfirming] = useState(false);
  const count = t.temps.length;
  const names = t.temps.map((x) => x.project).join(", ");

  return (
    <div className="p-2.5 border-t border-[#eeeae0] space-y-1.5 text-[11px] text-[#4f493e]">
      <div className="font-bold text-[#1c1b18]">Projetos temporários</div>
      <label className="flex items-center gap-1.5">
        <span className="flex-1">Apagar parados há</span>
        <input
          type="number"
          min={0}
          max={365}
          value={t.draft}
          disabled={t.busy || t.days === null}
          onChange={(e) => t.setDraft(e.target.value)}
          onBlur={() => void t.saveDays()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void t.saveDays();
          }}
          aria-label="Dias para apagar projetos temporários (0 desliga)"
          className="w-12 px-1.5 py-0.5 rounded-lg border border-[#dfdacd] bg-white text-right"
        />
        <span>dias</span>
      </label>
      <div className="text-[10px] text-[#8c8270]">
        {t.days === 0
          ? "Limpeza automática desligada (0)."
          : "Verificado ao abrir o app e a cada 6 horas. 0 desliga."}
      </div>
      {confirming ? (
        <div className="space-y-1.5 rounded-lg border border-rose-200 bg-rose-50 p-2">
          <div className="text-rose-900">
            Apagar {count} projeto(s) temporário(s) com páginas e sessões?
          </div>
          <div className="text-[10px] text-rose-800 break-words max-h-16 overflow-y-auto">
            {names}
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                setConfirming(false);
                void t.cleanNow();
              }}
              className="px-2 py-1 rounded-lg font-bold bg-rose-600 hover:bg-rose-700 text-white"
            >
              Apagar
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="px-2 py-1 rounded-lg font-bold bg-[#ede9de] hover:bg-[#e2dcce]"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          disabled={t.busy || t.loading || !count}
          title={count ? names : "Nenhum projeto temporário encontrado"}
          className="w-full px-2 py-1 rounded-lg font-bold bg-[#f4f1e8] hover:bg-[#eae4d5] border border-[#dfdacd] text-[#332f28] flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          <Trash2 size={12} />
          {t.busy
            ? "Limpando…"
            : t.loading
              ? "Verificando…"
              : `Limpar temporários agora (${count})`}
        </button>
      )}
      {t.message && <div className="text-emerald-800">{t.message}</div>}
      {t.error && <div className="text-rose-800">{t.error}</div>}
    </div>
  );
}
