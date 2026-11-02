import { useState } from "react";
import { Plus, ChevronDown, ChevronRight } from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";
import {
  formatQuota,
  formatReset,
  localUtcLabel,
  getQuotaColor,
  providerQuota,
} from "../../lib/format";
import { CompanyIcon } from "../../components/CompanyIcon";
import { SessionRow } from "./SessionRow";
import { useNow } from "../../hooks/useNow";

export function ProviderList() {
  const { providers, handleCreateSession } = useApp();
  // Um relógio só para a lista: o selo "fria" das conversas muda na escala de minutos.
  const now = useNow(true, 60_000);
  // Detalhes da cota (leitura, reinício, tokens, grupos): recolhidos por padrão para sobrar espaço
  // à lista de conversas; os percentuais de 5h e semana continuam no cabeçalho do provedor.
  const [showDetails, setShowDetails] = useState<Record<string, boolean>>({});
  const [expandedProviders, setExpandedProviders] = useState<
    Record<string, boolean>
  >({
    claude: true,
    codex: true,
    antigravity: true,
  });

  const toggleExpand = (providerId: string) => {
    setExpandedProviders((prev) => ({
      ...prev,
      [providerId]: !prev[providerId],
    }));
  };

  return (
    <>
      <div className="px-4 py-2 flex items-center justify-between text-[11px] font-bold text-[#8c8270] uppercase tracking-wider">
        <span>CLIs & Cotas Reais</span>
        <span className="text-[10px] text-[#9c9381] font-normal">
          Uso: 5h | Sem
        </span>
      </div>

      {/* ÁRVORE DINÂMICA DE MODELOS */}
      <div className="flex-1 overflow-y-auto px-3 space-y-2.5 pb-4">
        {providers.map((provider) => {
          const quota = providerQuota(provider);
          const isExpanded = expandedProviders[provider.id] ?? true;
          // Fechadas ficam só no histórico (Ctrl+H).
          const active = provider.sessions.filter((s) => !s.archived);

          return (
            <div
              key={provider.id}
              className="rounded-xl border border-[#dfdacd]/70 bg-[#f7f5ef]/60 overflow-hidden shadow-2xs"
            >
              <div
                onClick={() => toggleExpand(provider.id)}
                className="p-2.5 flex items-center justify-between cursor-pointer hover:bg-[#eae4d5] transition"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[#8c8270]">
                    {isExpanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </span>

                  <CompanyIcon
                    id={provider.id}
                    size={20}
                    className="shrink-0"
                  />

                  <div className="truncate">
                    <div className="font-bold text-xs text-[#221f1a] truncate">
                      {provider.name}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="flex items-center gap-1">
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border font-bold ${getQuotaColor(quota.window5hPercent)}`}
                      title={`${quota.sourceLabel || "Sem leitura"} · ${quota.updatedAt || "Sem data"}${quota.stale ? " · Desatualizado" : ""}`}
                    >
                      5h: {formatQuota(quota.window5hPercent)}
                    </span>

                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border font-bold ${getQuotaColor(quota.weeklyPercent)}`}
                      title={quota.sourceLabel || "Cota indisponível"}
                    >
                      S: {formatQuota(quota.weeklyPercent)}
                    </span>
                  </div>

                  <button
                    onClick={(e) => handleCreateSession(provider.id, e)}
                    className="p-1 hover:bg-[#d6cfbe] rounded text-[#443e33] transition"
                    disabled={!provider.installed}
                    title={
                      provider.installed
                        ? "Abrir nova conversa"
                        : "CLI não encontrada nesta máquina"
                    }
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowDetails((prev) => ({
                    ...prev,
                    [provider.id]: !prev[provider.id],
                  }))
                }
                aria-expanded={!!showDetails[provider.id]}
                aria-label={`Detalhes da cota de ${provider.name}`}
                className="w-full text-left px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8c8270] hover:text-[#443e33]"
              >
                {showDetails[provider.id] ? "▾" : "▸"} Detalhes da cota
              </button>
              {showDetails[provider.id] && (
                <div data-testid="quota-details">
                  <div
                    className="px-3 pb-2 text-[10px] text-[#7d7565]"
                    title={[quota.groupLabel, quota.sourceLabel]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    {quota.groupLabel && (
                      <span className="block">{quota.groupLabel}</span>
                    )}
                    {!provider.installed
                      ? "CLI não encontrada"
                      : quota.updatedAt
                        ? `${quota.stale ? "Leitura desatualizada" : "Última leitura"}: ${new Date(quota.updatedAt).toLocaleTimeString()}`
                        : "Cota indisponível"}
                  </div>
                  {provider.installed &&
                    (quota.window5hResetAt || quota.weeklyResetAt) && (
                      <div
                        className="px-3 pb-2 text-[10px] text-[#7d7565]"
                        title={`Horários de reinício informados pela própria CLI, no seu fuso (${localUtcLabel()})`}
                      >
                        Reinicia · 5h: {formatReset(quota.window5hResetAt)} ·
                        Semana: {formatReset(quota.weeklyResetAt)} (
                        {localUtcLabel()})
                      </div>
                    )}
                  <div
                    className="px-3 pb-2 text-[10px] text-[#7d7565]"
                    title={[quota.groupLabel, quota.sourceLabel]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    {quota.totalTokens == null
                      ? "Tokens indisponíveis"
                      : `Tokens (7d): ${quota.totalTokens.toLocaleString()}`}
                    {provider.id === "antigravity" &&
                    quota.prompts5h !== undefined
                      ? ` · ${quota.prompts5h} prompts (5h)`
                      : ""}
                  </div>
                  {quota.groups && quota.groups.length > 0 && (
                    <div
                      className="px-3 pb-2 space-y-1"
                      aria-label="Cotas por grupo do AGY"
                    >
                      {quota.groups.map((group) => (
                        <div
                          key={group.name}
                          className="text-[10px] flex justify-between gap-1"
                          title={`Reinício 5h: ${group.window5hResetAt || "Não informado"} · Semanal: ${group.weeklyResetAt || "Não informado"}`}
                        >
                          <span className="text-[#7d7565] truncate">
                            {group.name}
                          </span>
                          <span className="font-mono whitespace-nowrap">
                            5h: {formatQuota(group.window5hPercent)} · S:{" "}
                            {formatQuota(group.weeklyPercent)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {quota.quotaError && (
                <div className="px-3 pb-2 text-[10px] text-amber-800">
                  {quota.quotaError}
                </div>
              )}
              {isExpanded && (
                <div className="py-1 px-1.5 space-y-0.5 border-t border-[#dfdacd]/40">
                  {active.length === 0 ? (
                    <div className="px-3 py-2 text-[11px] text-[#938b7a] italic">
                      Nenhum chat ativo. Clique em + para iniciar.
                    </div>
                  ) : (
                    active.map((session) => (
                      <SessionRow key={session.id} session={session} now={now} />
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
