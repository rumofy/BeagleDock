import { memo, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { approvalTitle, PROVIDER_NAMES } from "../lib/approvalLabels";
import type { ApprovalOption, CliApproval } from "../types/api";

/**
 * Pedido de permissão com as opções nativas da própria CLI (permitir uma vez, sempre, nesta
 * sessão, negar com instrução…). A escolha volta à CLI no formato dela.
 */
export const ApprovalCard = memo(function ApprovalCard({
  approval,
  onResolve,
  compact = false,
}: {
  approval: CliApproval;
  onResolve: (id: string, decision: string, message?: string) => void;
  compact?: boolean;
}) {
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  // Opções perigosas (ignorar permissões, regras para todos os projetos) pedem um segundo clique.
  const [armed, setArmed] = useState<string | null>(null);
  const allow = approval.options.filter((o) => o.kind === "allow");
  const deny = approval.options.filter((o) => o.kind === "deny");
  const noteOption = deny.find((o) => o.allowsMessage);

  const button = (option: ApprovalOption, primary: boolean) => (
    <button
      key={option.id}
      type="button"
      onClick={() => {
        if (option.danger && armed !== option.id) {
          setArmed(option.id);
          return;
        }
        onResolve(approval.id, option.id);
      }}
      title={
        option.persistent
          ? "Grava uma regra que continua valendo depois desta ação"
          : option.description
      }
      className={`text-left px-3 py-2 rounded-lg text-xs font-bold border transition ${
        option.kind === "deny"
          ? "bg-[#ede9de] border-[#d6cfbe] text-[#2c2822] hover:bg-[#e2dcce]"
          : primary
            ? "bg-emerald-700 border-emerald-800 text-white hover:bg-emerald-800"
            : option.danger
              ? "bg-rose-50 border-rose-300 text-rose-800 hover:bg-rose-100"
              : "bg-white border-emerald-300 text-emerald-900 hover:bg-emerald-50"
      }`}
    >
      {option.danger && armed === option.id ? "Confirmar: " : ""}
      {option.label}
      {option.persistent && (
        <span className="ml-2 text-[9px] uppercase tracking-wider font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-800 align-middle">
          regra permanente
        </span>
      )}
    </button>
  );

  return (
    <div
      role="group"
      aria-label="Autorizar ação da CLI"
      data-testid="approval-card"
      className="rounded-2xl border-2 border-amber-400 bg-amber-50 shadow-md p-3.5 space-y-2.5"
    >
      <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
        <ShieldAlert size={16} className="shrink-0" />
        <span>Aguardando permissão</span>
        <span className="text-[11px] font-semibold text-amber-800/80">
          · {PROVIDER_NAMES[approval.providerId] || approval.providerId}
        </span>
      </div>
      <div className="text-xs font-semibold text-[#2c2822]">
        {approvalTitle(approval.tool)}
      </div>
      <pre
        className={`text-[11px] whitespace-pre-wrap break-all overflow-auto bg-white/70 border border-amber-200 p-2 rounded-lg ${compact ? "max-h-24" : "max-h-48"}`}
      >
        {approval.input}
      </pre>
      <div className="flex flex-col gap-1.5">
        {allow.map((o, i) => button(o, i === 0))}
        {deny.map((o) => button(o, false))}
      </div>
      {noteOption && (
        <div className="pt-0.5">
          {!asking ? (
            <button
              type="button"
              onClick={() => setAsking(true)}
              className="text-[11px] underline text-amber-900"
            >
              Negar e dizer à IA o que fazer
            </button>
          ) : (
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                onResolve(approval.id, noteOption.id, note);
              }}
            >
              <input
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ex.: use o diretório de testes, não o home"
                className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded-lg border border-amber-300 bg-white outline-none"
              />
              <button
                type="submit"
                className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#2c2822] text-white"
              >
                Negar e enviar
              </button>
            </form>
          )}
        </div>
      )}
      <p className="text-[10px] text-amber-900/70">
        Regras explícitas de bloqueio continuam valendo, mesmo ao permitir.
      </p>
    </div>
  );
});
