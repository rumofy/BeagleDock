import React from "react";
import {
  Copy,
  RefreshCw,
  Trash2,
  FileText,
  MessageSquare,
} from "lucide-react";
import { useMemoryExplorerState } from "./MemoryExplorerContext";
import { PaneMessage } from "./PaneMessage";
import { MarkdownView } from "./MarkdownView";
import { MaintenanceChatPane } from "./MaintenanceChatPane";

export function PageReader() {
  const {
    userProfile,
    chat,
    rightTab,
    setRightTab,
    reader,
    page,
    pageLoading,
    pageError,
    linkMissing,
    copied,
    setDeleteOpen,
    setDeleteInput,
    setActionError,
    openPage,
    handleWikiLink,
    copyPath,
    meta,
  } = useMemoryExplorerState();
  return (
      <section
        aria-label="Leitor"
        className="flex-1 min-w-0 flex flex-col min-h-0 bg-white"
      >
        {chat && (
          <div className="flex border-b border-[#eeeae0] text-xs font-bold">
            {(
              [
                ["reader", "Leitor", FileText],
                ["chat", "Manutenção", MessageSquare],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setRightTab(id)}
                className={`px-3 py-2 flex items-center gap-1.5 border-b-2 ${rightTab === id ? "border-[#1c1b18] text-[#1c1b18]" : "border-transparent text-[#8c8270]"}`}
              >
                <Icon size={12} /> {label}
                {id === "chat" && chat.executing && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                )}
                {id === "chat" && chat.approvals.length > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                )}
              </button>
            ))}
          </div>
        )}
        {chat && rightTab === "chat" ? (
          <MaintenanceChatPane chat={chat} userProfile={userProfile} />
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            {!reader && (
              <PaneMessage>
                Selecione uma página para ler. Links [[assim]] abrem a página
                no mesmo projeto.
              </PaneMessage>
            )}
            {pageLoading && <PaneMessage>Carregando página…</PaneMessage>}
            {pageError && <PaneMessage tone="error">{pageError}</PaneMessage>}
            {page && meta && reader && (
              <>
                <div className="px-3 py-2 border-b border-[#eeeae0] flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold break-words">
                      {page.title}
                    </div>
                    <div className="text-[10px] font-mono text-[#8c8270] break-all">
                      {reader.ws}/{reader.p} · {page.path}
                    </div>
                  </div>
                  <button
                    onClick={copyPath}
                    title="Copiar caminho"
                    className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-[#f4f1e8] hover:bg-[#eae4d5] border border-[#dfdacd] flex items-center gap-1"
                  >
                    <Copy size={11} /> {copied ? "Copiado" : "Copiar"}
                  </button>
                  <button
                    onClick={() => void openPage({ ws: reader.ws, p: reader.p }, page.path)}
                    title="Atualizar página"
                    className="p-1.5 rounded-lg hover:bg-[#ede9de] text-[#6d6657]"
                  >
                    <RefreshCw size={13} />
                  </button>
                  <button
                    onClick={() => {
                      setActionError("");
                      setDeleteInput("");
                      setDeleteOpen(true);
                    }}
                    className="px-2 py-1 rounded-lg text-[11px] font-semibold text-rose-700 border border-rose-200 hover:bg-rose-50 flex items-center gap-1"
                  >
                    <Trash2 size={11} /> Excluir página
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-4">
                  {linkMissing && (
                    <div className="mb-3 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                      Página não encontrada: <code>{linkMissing}</code>
                    </div>
                  )}
                  {meta.entries.length > 0 && (
                    <details className="mb-3 rounded-xl border border-[#e6e1d5] bg-[#faf8f4] text-xs">
                      <summary className="cursor-pointer px-3 py-1.5 font-bold text-[#665e4f]">
                        Metadados
                      </summary>
                      <dl className="px-3 pb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                        {meta.entries.map(([k, v]) => (
                          <React.Fragment key={k}>
                            <dt className="font-mono text-[#8c8270]">{k}</dt>
                            <dd className="break-all whitespace-pre-wrap">{v}</dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    </details>
                  )}
                  <MarkdownView body={meta.body} onWikiLink={handleWikiLink} />
                </div>
              </>
            )}
          </div>
        )}
      </section>
  );
}
