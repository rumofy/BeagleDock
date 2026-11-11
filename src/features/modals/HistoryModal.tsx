import { useEffect, useState } from "react";
import { ChevronRight, X, History, Search, Copy, Clock, Trash2 } from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";
import { CompanyIcon } from "../../components/CompanyIcon";
import type { HistorySessionItem } from "../../types";
import { useConversationHistory } from "./useConversationHistory";

import { t } from "../../i18n";
function statusLabel(item: HistorySessionItem) {
  if (item.source === "native") return { text: t("history.terminalOnly"), tone: "bg-[#ede9de] text-[#6b6251]" };
  if (item.closed) return { text: t("history.closed"), tone: "bg-[#ede9de] text-[#6b6251]" };
  return { text: t("history.open"), tone: "bg-emerald-50 text-emerald-800" };
}

export function HistoryModal() {
  const {
    showHistoryModal,
    setShowHistoryModal,
    handleSelectHistoryPrompt,
    handleOpenFullConversation,
    handleDeleteConversation,
  } = useApp();
  const [historySearch, setHistorySearch] = useState<string>("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const { items, loading, error, removeItem } = useConversationHistory(
    showHistoryModal,
    historySearch.trim(),
  );
  // The confirmation expires on its own: a stray click doesn't leave the button armed.
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(id);
  }, [confirming]);
  if (!showHistoryModal) return null;

  const remove = async (item: HistorySessionItem) => {
    setConfirming(null);
    if (await handleDeleteConversation(item)) removeItem(item.id);
  };

  return (
    <div data-testid="history-modal" className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-[#ffffff] border border-[#d8d2c3] rounded-2xl shadow-2xl max-w-3xl w-full flex flex-col overflow-hidden max-h-[85vh]">
        <div className="p-4 border-b border-[#eeeae0] bg-[#faf8f4] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-1">
            <History size={20} className="text-indigo-600" />
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-2.5 text-[#8c8270]" />
              <input
                type="text"
                autoFocus
                placeholder={t("history.searchPlaceholder")}
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-[#d6cfbe] bg-[#ffffff] text-xs outline-none focus:border-[#968d7a]"
              />
            </div>
          </div>
          <span className="font-mono text-[10px] bg-[#ede9de] px-2 py-1 rounded text-[#6b6251]">
            {t("history.escToClose")}
          </span>
          <button
            onClick={() => setShowHistoryModal(false)}
            className="p-1 hover:bg-[#ede9de] rounded-lg text-[#6d6657]"
            aria-label={t("history.close")}
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
          <div className="text-[11px] font-bold text-[#8c8270] uppercase tracking-wider mb-1 flex items-center justify-between gap-2">
            <span>{t("history.subtitle")}</span>
            {loading && <span className="text-[10px] normal-case font-normal">{t("common.loading")}</span>}
          </div>
          {error && <p className="text-xs text-rose-700">{error}</p>}

          {items.length === 0 && !loading ? (
            <div className="p-8 text-center text-xs text-[#8c8270] space-y-2">
              <History size={28} className="mx-auto text-[#c5bea9]" />
              <p>{historySearch ? t("history.noMatches") : t("history.empty")}</p>
            </div>
          ) : (
            items.map((item) => {
              const status = statusLabel(item);
              const armed = confirming === item.id;
              return (
                <div
                  key={item.id}
                  data-history-id={item.id}
                  onClick={() => handleOpenFullConversation(item)}
                  className="group p-3 rounded-xl border border-[#ded8cb] hover:border-[#968d7a] hover:bg-[#fbf9f5] transition cursor-pointer flex items-start justify-between gap-3"
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <CompanyIcon id={item.provider} size={16} className="shrink-0" />
                      <span className="font-bold text-xs text-[#1c1b18] group-hover:text-indigo-700 truncate">
                        {item.source === "beagledock" ? item.title : item.providerName}
                      </span>
                      <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wider rounded px-1 ${status.tone}`}>
                        {status.text}
                      </span>
                      <span className="text-[10px] text-[#9c9381] flex items-center gap-1 ml-auto shrink-0">
                        <Clock size={11} />
                        {item.date}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-mono text-[#8c8270] bg-[#ede9de] px-1.5 py-0.2 rounded truncate">
                        {item.project}
                      </span>
                      {item.messageCount !== undefined && (
                        <span className="text-[10px] text-[#9c9381] shrink-0">
                          {item.messageCount} mensagens
                        </span>
                      )}
                    </div>
                    {item.prompt && (
                      <p className="text-xs text-[#38332a] font-medium line-clamp-2 leading-relaxed">
                        "{item.prompt}"
                      </p>
                    )}
                  </div>

                  <div className="shrink-0 flex items-center gap-2 self-center pl-2">
                    {item.prompt && (
                      <button
                        type="button"
                        onClick={(e) => handleSelectHistoryPrompt(item, e)}
                        className="px-2 py-1 rounded-lg bg-[#ede9de] hover:bg-[#dfdacd] text-[#443e33] font-mono text-[10px] font-bold transition flex items-center gap-1"
                        title={t("history.copyPromptHint")}
                      >
                        <span>Prompt</span>
                        <Copy size={11} />
                      </button>
                    )}
                    <span className="px-2.5 py-1 rounded-lg bg-indigo-50 group-hover:bg-indigo-600 group-hover:text-white font-mono text-[10px] font-bold text-indigo-800 transition flex items-center gap-1 shadow-2xs">
                      <span>{item.source === "beagledock" && !item.closed ? t("history.goTo") : t("history.openAction")}</span>
                      <ChevronRight size={12} />
                    </span>
                    {armed ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(item);
                        }}
                        className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-bold"
                        title={t("history.deleteHint")}
                      >
                        {t("history.deleteConfirm")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirming(item.id);
                        }}
                        className="p-1 rounded-lg text-[#8c8270] hover:text-rose-600 hover:bg-rose-50"
                        title={t("history.delete")}
                        aria-label={t("history.deleteLabel")}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="p-3 bg-[#faf8f4] border-t border-[#eeeae0] text-center text-xs text-[#7d7565]">
          Atalho global: pressione{" "}
          {t("history.footerBefore")}{" "}<kbd className="font-bold bg-[#ede9de] px-1.5 py-0.5 rounded text-[#332f28]">Ctrl + H</kbd>{" "}
          {t("history.footerAfter")}
        </div>
      </div>
    </div>
  );
}
