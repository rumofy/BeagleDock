import type React from "react";
import { backendAvailable, beagleApi } from "../api/beagleApi";
import type {
  AIProviderStatus,
  ChatMessage,
  ChatSession,
  HistorySessionItem,
  SkillItem,
} from "../types";
import type { AppTab } from "./useUi";
import type { useSessions } from "./useSessions";

interface Params {
  sessions: ReturnType<typeof useSessions>;
  setProviders: React.Dispatch<React.SetStateAction<AIProviderStatus[]>>;
  setAppError: (message: string) => void;
  setActiveTab: (tab: AppTab) => void;
  setInputMessage: (text: string) => void;
  setShowSkillsModal: (show: boolean) => void;
  setShowHistoryModal: (show: boolean) => void;
}

/** Ações dos modais de skills e histórico que preenchem o chat ou importam conversas. */
export function useHistoryActions({
  sessions,
  setProviders,
  setAppError,
  setActiveTab,
  setInputMessage,
  setShowSkillsModal,
  setShowHistoryModal,
}: Params) {
  const { allSessions, pendingTurns, setActiveSessionId, setMessages } =
    sessions;
  const handleSelectSkill = (skill: SkillItem) => {
    setShowSkillsModal(false);
    if (skill.name === "revisao-interna") {
      setInputMessage("manda pro revisor");
    } else if (skill.name === "revisao-seguranca") {
      setInputMessage("revisar seguranca");
    } else {
      setInputMessage(`use skill ${skill.name}`);
    }
  };

  const handleSelectHistoryPrompt = (
    item: HistorySessionItem,
    e?: React.MouseEvent,
  ) => {
    if (e) e.stopPropagation();
    setShowHistoryModal(false);
    setInputMessage(item.prompt);
  };

  // Abre a conversa completa do histórico (.jsonl) e persiste no SQLite!
  const handleOpenFullConversation = async (item: HistorySessionItem) => {
    setShowHistoryModal(false);

    if (backendAvailable()) {
      try {
        const conversation = await beagleApi.loadFullConversation(
          item.provider,
          item.sessionId,
        );
        if (conversation.error) throw new Error(conversation.error);
        const fullMsgs: ChatMessage[] = conversation.messages || [];

        if (fullMsgs && fullMsgs.length > 0) {
          const existingSession = allSessions.find(
            (session) =>
              session.providerId === item.provider &&
              session.nativeSessionId === item.sessionId,
          );
          const newSessionId =
            existingSession?.id || `history-${item.provider}-${item.sessionId}`;
          if (pendingTurns.current.has(newSessionId)) {
            setActiveSessionId(newSessionId);
            setActiveTab("chat");
            return;
          }
          const newSessionObj: ChatSession = {
            id: newSessionId,
            providerId: item.provider,
            title: item.title,
            currentModel: conversation.model || "",
            nativeSessionId: conversation.nativeSessionId,
            reasoningEffort: "",
            status: "idle",
            createdAt: item.date,
            lastActive: "Histórico",
            cwd: conversation.cwd,
            ptyLog: [
              `$ Sessão restaurada do histórico (${fullMsgs.length} mensagens)`,
            ],
          };

          const saved = await beagleApi.saveSession(newSessionObj);
          if (!saved?.success)
            throw new Error(saved?.error || "Falha ao salvar sessão.");
          const imported = fullMsgs.map((msg) => ({
            ...msg,
            sessionId: newSessionId,
          }));
          const importedResult = await beagleApi.replaceChatMessages(
            newSessionId,
            imported.map((msg) => ({ ...msg, provider: item.provider })),
          );
          if (!importedResult?.success)
            throw new Error(
              importedResult?.error || "Falha ao importar histórico.",
            );
          setProviders((prev) =>
            prev.map((p) => {
              if (p.id === item.provider) {
                const exists = p.sessions.some((s) => s.id === newSessionId);
                return {
                  ...p,
                  sessions: exists
                    ? p.sessions.map((session) =>
                        session.id === newSessionId ? newSessionObj : session,
                      )
                    : [newSessionObj, ...p.sessions],
                };
              }
              return p;
            }),
          );

          setMessages((prev) => ({
            ...prev,
            [newSessionId]: imported,
          }));

          // Salvar configurações para ficar permanente

          setActiveSessionId(newSessionId);
          setActiveTab("chat");
          return;
        }
      } catch (err) {
        setAppError((err as Error).message);
      }
    }

    setInputMessage(item.prompt);
  };
  return {
    handleSelectSkill,
    handleSelectHistoryPrompt,
    handleOpenFullConversation,
  };
}
