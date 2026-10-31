import { useRef, useLayoutEffect } from "react";
import { useApp } from "../../hooks/AppStateProvider";
import { ChatMessageList } from "../../components/ChatMessageList";
import { ChatComposer } from "./ChatComposer";

export function ChatView() {
  const {
    activeTab,
    userProfile,
    activeSessionId,
    currentMessages,
  } = useApp();
  const chatScrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (activeTab !== "chat") return;
    const scroller = chatScrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [currentMessages, activeSessionId, activeTab]);
  return (
            <div
              ref={chatScrollRef}
              data-testid="chat-scroll"
              className="flex-1 overflow-y-auto p-6 flex flex-col justify-between"
            >
              <div className="max-w-4xl w-full mx-auto flex-1 flex flex-col justify-between space-y-4">
                {/* LISTA DE MENSAGENS */}
                <div className="space-y-6 pt-2 flex-1">
                  {currentMessages.length === 0 ? (
                    <div className="text-center py-16 text-[#8c8270] text-sm">
                      Crie uma conversa no botão + de uma CLI instalada ou abra
                      o histórico (Ctrl+H). O catálogo é importado das
                      ferramentas desta máquina.
                    </div>
                  ) : (
                    <ChatMessageList
                      messages={currentMessages}
                      userProfile={userProfile}
                    />
                  )}
                </div>

                <ChatComposer />
              </div>
            </div>
  );
}
