import { useCallback, useEffect, useRef, useLayoutEffect, useState } from "react";
import { ArrowDown } from "lucide-react";
import { beagleApi } from "../../api/beagleApi";
import { useApp } from "../../hooks/AppStateProvider";
import { ApprovalCard } from "../../components/ApprovalCard";
import { ContextBar } from "../../components/ContextBar";
import { ChatMessageList } from "../../components/ChatMessageList";
import type { ChatMessage } from "../../types";
import type { FileTarget } from "../../components/LinkedText";
import { ChatComposer } from "./ChatComposer";
import { StaleContextNotice } from "./StaleContextNotice";
import { ContinuationBanner } from "./ContinueInCli";
import { ChatFindBar } from "./ChatFindBar";
import { useChatFind } from "./useChatFind";

export function ChatView() {
  const {
    activeTab,
    userProfile,
    activeSessionId,
    currentMessages,
    currentSession,
    currentModelSelection,
    setAppError,
    cliApprovals,
    resolveApproval,
    contextBySession,
    compactContext,
    isExecutingPrompt,
    forceQueuedPrompt,
    cancelQueuedPrompt,
    answerNowPrompt,
  } = useApp();
  const pendingApprovals = cliApprovals.filter(
    (a) => a.sessionId === activeSessionId,
  );
  const sessionCwd = currentSession?.cwd;
  const onForceQueued = useCallback(
    (m: ChatMessage) => void forceQueuedPrompt(m),
    [forceQueuedPrompt],
  );
  const onCancelQueued = useCallback(
    (m: ChatMessage) => void cancelQueuedPrompt(m),
    [cancelQueuedPrompt],
  );
  const onAnswerNow = useCallback(
    (m: ChatMessage, mode: "background" | "interrupt") => void answerNowPrompt(m, mode),
    [answerNowPrompt],
  );
  // Identidade estável: a lista de mensagens é memoizada e só re-renderiza o que mudou.
  const openFile = useCallback(
    async (target: FileTarget) => {
      if (!sessionCwd) return;
      try {
        const result = await beagleApi.openInEditor({
          cwd: sessionCwd,
          target: target.path,
          line: target.line,
          column: target.column,
        });
        if (!result?.ok)
          setAppError(result?.error || "Não foi possível abrir o arquivo.");
      } catch (error) {
        setAppError((error as Error).message);
      }
    },
    [sessionCwd, setAppError],
  );
  const chatScrollRef = useRef<HTMLDivElement>(null);
  // Acompanha o fim só enquanto a pessoa está no fim; ao subir para ler, não puxa de volta.
  const stickRef = useRef(true);
  const lastSessionRef = useRef(activeSessionId);
  const lastCountRef = useRef(currentMessages.length);
  const [awayFromEnd, setAwayFromEnd] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const find = useChatFind(chatScrollRef, messagesRef);
  const [findFocus, setFindFocus] = useState(0);
  const { setOpen: setFindOpen, setQuery: setFindQuery } = find;
  // Ctrl+F abre a busca na conversa; com texto selecionado (uma linha), já busca por ele.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "f") return;
      e.preventDefault();
      const selected = window.getSelection()?.toString().trim() ?? "";
      if (selected && selected.length <= 200 && !selected.includes("\n")) setFindQuery(selected);
      setFindOpen(true);
      setFindFocus((n) => n + 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setFindOpen, setFindQuery]);
  const scrollToEnd = () => {
    const scroller = chatScrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  };
  useLayoutEffect(() => {
    if (activeTab !== "chat") return;
    if (lastSessionRef.current !== activeSessionId) {
      lastSessionRef.current = activeSessionId;
      stickRef.current = true;
    }
    const last = currentMessages[currentMessages.length - 1];
    if (
      currentMessages.length > lastCountRef.current &&
      last?.sender === "user"
    )
      stickRef.current = true;
    lastCountRef.current = currentMessages.length;
    if (stickRef.current) scrollToEnd();
  }, [currentMessages, activeSessionId, activeTab, pendingApprovals.length]);
  const onScroll = () => {
    const scroller = chatScrollRef.current;
    if (!scroller) return;
    const near =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    stickRef.current = near;
    setAwayFromEnd((prev) => (prev === !near ? prev : !near));
  };
  return (
    <>
      <div
        ref={chatScrollRef}
        onScroll={onScroll}
        data-testid="chat-scroll"
        className="flex-1 overflow-y-auto p-6 flex flex-col justify-between"
      >
        <div className="max-w-4xl w-full mx-auto flex-1 flex flex-col justify-between space-y-4">
          {/* LISTA DE MENSAGENS */}
          <div ref={messagesRef} data-testid="chat-messages" className="space-y-6 pt-2 flex-1">
            {currentMessages.length === 0 ? (
              <div className="text-center py-16 text-[#8c8270] text-sm">
                Crie uma conversa no botão + de uma CLI instalada ou abra o
                histórico (Ctrl+H). O catálogo é importado das ferramentas desta
                máquina.
              </div>
            ) : (
              <ChatMessageList
                messages={currentMessages}
                userProfile={userProfile}
                onOpenFile={openFile}
                onForceQueued={onForceQueued}
                onCancelQueued={onCancelQueued}
                onAnswerNow={onAnswerNow}
              />
            )}
          </div>

          {currentSession && (
            <ContextBar
              info={contextBySession[currentSession.id]}
              providerId={currentSession.providerId}
              selectedModel={currentModelSelection.model}
              busy={isExecutingPrompt}
              onCompact={() => void compactContext(currentSession)}
            />
          )}
          {pendingApprovals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onResolve={resolveApproval}
            />
          ))}
          <ContinuationBanner />
          <StaleContextNotice />
          <ChatComposer />
        </div>
      </div>
      {find.open && (
        <ChatFindBar
          query={find.query}
          onQuery={find.setQuery}
          total={find.total}
          current={find.current}
          onNext={find.next}
          onPrev={find.prev}
          onClose={find.close}
          focusToken={findFocus}
        />
      )}
      {awayFromEnd && (
        <button
          type="button"
          onClick={() => {
            stickRef.current = true;
            scrollToEnd();
            setAwayFromEnd(false);
          }}
          className="absolute bottom-28 right-8 z-10 flex items-center gap-1.5 rounded-full bg-[#262420] text-amber-50 text-xs font-bold px-3 py-1.5 shadow-lg"
          data-testid="chat-jump-to-end"
        >
          <ArrowDown size={13} /> Ir para o fim
        </button>
      )}
    </>
  );
}
