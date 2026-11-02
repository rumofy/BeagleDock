import { useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";
import { staleContext } from "../../lib/staleContext";
import { formatTokens } from "../../lib/tokens";
import type { ChatSession } from "../../types";

/** Uma conversa aberta: selecionar, renomear (duplo clique) e fechar (ela continua no histórico). */
export function SessionRow({ session, now }: { session: ChatSession; now: number }) {
  const {
    activeTab,
    setActiveTab,
    activeSessionId,
    setActiveSessionId,
    draftIds,
    unreadSessionIds,
    cliApprovals,
    renameSession,
    setSessionArchived,
    contextBySession,
  } = useApp();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const input = useRef<HTMLInputElement>(null);
  // Escape cancela: o blur que vem junto não pode salvar o nome.
  const cancelled = useRef(false);
  const isSelected = activeSessionId === session.id && activeTab === "chat";

  useEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    void renameSession(session.id, draft);
  };
  const startEditing = () => {
    cancelled.current = false;
    setDraft(session.title);
    setEditing(true);
  };
  const waitingPermission = cliApprovals.some(
    (a) => a.sessionId === session.id,
  );
  // Conversa grande com o cache expirado: retomar reprocessa o contexto inteiro.
  const context = contextBySession[session.id];
  const cold = session.status === "running" ? null : staleContext(context, now);

  return (
    <div
      data-session-id={session.id}
      role="button"
      tabIndex={0}
      aria-current={isSelected ? "true" : undefined}
      aria-label={`Conversa ${session.title}`}
      onKeyDown={(e) => {
        if (editing || e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setActiveSessionId(session.id);
          setActiveTab("chat");
        } else if (e.key === "F2") {
          e.preventDefault();
          startEditing();
        }
      }}
      onClick={() => {
        if (editing) return;
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
          {editing ? (
            <input
              ref={input}
              value={draft}
              maxLength={120}
              aria-label="Novo nome da conversa"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") {
                  cancelled.current = true;
                  setEditing(false);
                }
              }}
              className="min-w-0 flex-1 px-1 py-0.5 text-xs rounded border border-[#968d7a] bg-white outline-none"
            />
          ) : (
            <span
              className="truncate text-xs"
              data-session-title
              title={`${session.title}${session.currentModel ? `\nModelo: ${session.currentModel}` : ""}\nDuplo clique para renomear`}
              onDoubleClick={(e) => {
                e.stopPropagation();
                startEditing();
              }}
            >
              {session.title}
            </span>
          )}
          {waitingPermission && (
            <span
              className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-white bg-amber-600 rounded px-1 animate-pulse"
              title="Aguardando a sua permissão"
            >
              permissão
            </span>
          )}
          {unreadSessionIds.includes(session.id) && (
            <span
              className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-white bg-emerald-600 rounded px-1"
              title="A CLI respondeu sozinha (ex.: um agente em segundo plano terminou)"
            >
              novo
            </span>
          )}
          {cold && (
            <span
              className="shrink-0 text-[9px] font-bold tracking-wider text-amber-800 bg-amber-100 rounded px-1"
              title={`Parada há mais tempo que o cache de prompt${context?.cacheTtlMs ? "" : " (estimado em 1 h: esta CLI não informa a validade)"}. Retomar reprocessa cerca de ${formatTokens(cold.used)} tokens de contexto; compactar antes ou começar uma conversa nova sai mais barato.`}
              data-testid="session-cold"
            >
              fria · {formatTokens(cold.used)}
            </span>
          )}
          {draftIds.includes(session.id) && session.id !== activeSessionId && (
            <span
              className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-amber-800 bg-amber-100 rounded px-1"
              title="Mensagem não enviada"
            >
              rascunho
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0 ml-1">
          {session.reasoningEffort === "plan" && (
            <span className="text-[9px] font-bold text-emerald-800 bg-emerald-100 px-1 py-0.2 rounded">
              PLAN
            </span>
          )}
          {!editing && (
            <span className="hidden group-hover:flex group-focus-within:flex items-center">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  startEditing();
                }}
                className="p-0.5 hover:text-[#181715] rounded"
                title="Renomear"
                aria-label="Renomear conversa"
              >
                <Pencil size={11} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void setSessionArchived(session.id, true);
                }}
                className="p-0.5 hover:text-[#181715] rounded ml-0.5"
                title="Fechar (encerra a CLI; a conversa fica no histórico, Ctrl+H)"
                aria-label="Fechar conversa"
              >
                <X size={12} />
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
