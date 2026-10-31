import { useState } from "react";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";
import { formatQuota, getQuotaColor, providerQuota } from "../../lib/format";
import { CompanyIcon } from "../../components/CompanyIcon";

export function ProviderList() {
  const {
    activeTab,
    setActiveTab,
    providers,
    activeSessionId,
    setActiveSessionId,
    handleCreateSession,
    handleDeleteSession,
  } = useApp();
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
                  {quota.quotaError && (
                    <div className="px-3 pb-2 text-[10px] text-amber-800">
                      {quota.quotaError}
                    </div>
                  )}
                  {isExpanded && (
                    <div className="py-1 px-1.5 space-y-0.5 border-t border-[#dfdacd]/40">
                      {provider.sessions.length === 0 ? (
                        <div className="px-3 py-2 text-[11px] text-[#938b7a] italic">
                          Nenhum chat ativo. Clique em + para iniciar.
                        </div>
                      ) : (
                        provider.sessions.map((session) => {
                          const isSelected =
                            activeSessionId === session.id &&
                            activeTab === "chat";
                          return (
                            <div
                              key={session.id}
                              data-session-id={session.id}
                              onClick={() => {
                                setActiveSessionId(session.id);
                                setActiveTab("chat");
                              }}
                              className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer text-xs transition ${
                                isSelected
                                  ? "bg-[#ffffff] font-semibold text-[#181715] shadow-xs"
                                  : "text-[#4e483d] hover:bg-[#eae4d5]"
                              }`}
                            >
                              <div className="flex items-center justify-between w-full">
                                <div className="flex items-center gap-2 truncate min-w-0">
                                  {session.status === "running" ? (
                                    <span
                                      className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0"
                                      title="Processo ativo"
                                    />
                                  ) : session.status === "waiting_input" ? (
                                    <span
                                      className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
                                      title="Aguardando confirmação"
                                    />
                                  ) : (
                                    <span
                                      className="w-1.5 h-1.5 rounded-full bg-[#a39b8b] shrink-0"
                                      title="Histórico / Idle"
                                    />
                                  )}

                                  <span className="truncate text-xs">
                                    {session.title}
                                  </span>
                                </div>

                                <div className="flex items-center gap-1 shrink-0 ml-2">
                                  <span className="text-[10px] font-mono text-[#8c8270] opacity-80">
                                    {session.currentModel
                                      .replace("Claude ", "")
                                      .replace("Gemini ", "")}
                                  </span>
                                  {session.reasoningEffort === "plan" && (
                                    <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1 py-0.2 rounded">
                                      PLAN
                                    </span>
                                  )}
                                  <button
                                    onClick={(e) =>
                                      handleDeleteSession(session.id, e)
                                    }
                                    className="p-0.5 hover:text-rose-600 rounded opacity-0 group-hover:opacity-100 transition ml-1"
                                    title="Encerrar e remover sessão"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })
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
