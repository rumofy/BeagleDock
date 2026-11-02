import { useState } from "react";
import {
  ChevronRight,
  X,
  History,
  Search,
  Copy,
  Clock,
} from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";
import { CompanyIcon } from "../../components/CompanyIcon";

export function HistoryModal() {
  const {
    showHistoryModal,
    setShowHistoryModal,
    cliHistory,
    handleSelectHistoryPrompt,
    handleOpenFullConversation,
  } = useApp();
  const [historySearch, setHistorySearch] = useState<string>("");
  if (!showHistoryModal) return null;

  return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#ffffff] border border-[#d8d2c3] rounded-2xl shadow-2xl max-w-3xl w-full flex flex-col overflow-hidden max-h-[85vh]">
            <div className="p-4 border-b border-[#eeeae0] bg-[#faf8f4] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 flex-1">
                <History size={20} className="text-indigo-600" />
                <div className="relative flex-1">
                  <Search
                    size={15}
                    className="absolute left-3 top-2.5 text-[#8c8270]"
                  />
                  <input
                    type="text"
                    autoFocus
                    placeholder="Buscar histórico de conversas e sessões passadas..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-[#d6cfbe] bg-[#ffffff] text-xs outline-none focus:border-[#968d7a]"
                  />
                </div>
              </div>
              <span className="font-mono text-[10px] bg-[#ede9de] px-2 py-1 rounded text-[#6b6251]">
                ESC para fechar
              </span>
              <button
                onClick={() => setShowHistoryModal(false)}
                className="p-1 hover:bg-[#ede9de] rounded-lg text-[#6d6657]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
              <div className="text-[11px] font-bold text-[#8c8270] uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>
                  Histórico de sessões locais (Claude Code & Codex CLI)
                </span>
                <span className="text-[10px] text-indigo-800 font-semibold bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
                  Clique para abrir a conversa inteira com todas as mensagens
                </span>
              </div>

              {cliHistory.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#8c8270] space-y-2">
                  <History size={28} className="mx-auto text-[#c5bea9]" />
                  <p>Nenhum histórico local carregado.</p>
                </div>
              ) : (
                cliHistory
                  .filter(
                    (h) =>
                      h.prompt
                        .toLowerCase()
                        .includes(historySearch.toLowerCase()) ||
                      h.title
                        .toLowerCase()
                        .includes(historySearch.toLowerCase()) ||
                      h.providerName
                        .toLowerCase()
                        .includes(historySearch.toLowerCase()),
                  )
                  .map((item) => (
                    <div
                      key={item.id}
                      onClick={() => handleOpenFullConversation(item)}
                      className="group p-3 rounded-xl border border-[#ded8cb] hover:border-[#968d7a] hover:bg-[#fbf9f5] transition cursor-pointer flex items-start justify-between gap-3"
                    >
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <CompanyIcon
                            id={item.provider}
                            size={16}
                            className="shrink-0"
                          />
                          <span className="font-bold text-xs text-[#1c1b18] group-hover:text-indigo-700">
                            {item.providerName}
                          </span>
                          <span className="text-[10px] font-mono text-[#8c8270] bg-[#ede9de] px-1.5 py-0.2 rounded">
                            {item.project}
                          </span>
                          <span className="text-[10px] text-[#9c9381] flex items-center gap-1 ml-auto">
                            <Clock size={11} />
                            {item.date}
                          </span>
                        </div>
                        <p className="text-xs text-[#38332a] font-medium line-clamp-2 leading-relaxed">
                          "{item.prompt}"
                        </p>
                      </div>

                      <div className="shrink-0 flex items-center gap-2 self-center pl-2">
                        <button
                          type="button"
                          onClick={(e) => handleSelectHistoryPrompt(item, e)}
                          className="px-2 py-1 rounded-lg bg-[#ede9de] hover:bg-[#dfdacd] text-[#443e33] font-mono text-[10px] font-bold transition flex items-center gap-1"
                          title="Copiar apenas este prompt para o input"
                        >
                          <span>Prompt</span>
                          <Copy size={11} />
                        </button>

                        <span className="px-2.5 py-1 rounded-lg bg-indigo-50 group-hover:bg-indigo-600 group-hover:text-white font-mono text-[10px] font-bold text-indigo-800 transition flex items-center gap-1 shadow-2xs">
                          <span>Abrir Conversa</span>
                          <ChevronRight size={12} />
                        </span>
                      </div>
                    </div>
                  ))
              )}
            </div>

            <div className="p-3 bg-[#faf8f4] border-t border-[#eeeae0] text-center text-xs text-[#7d7565]">
              Atalho global: pressione{" "}
              <kbd className="font-bold bg-[#ede9de] px-1.5 py-0.5 rounded text-[#332f28]">
                Ctrl + H
              </kbd>{" "}
              para abrir o histórico de qualquer tela.
            </div>
          </div>
        </div>
  );
}
