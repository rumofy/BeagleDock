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
  const {
    allSessions,
    pendingTurns,
    setActiveSessionId,
    setMessages,
    reopenSession,
    forgetSession,
  } = sessions;
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

  // Conversa do BeagleDock: reabre a própria sessão. Conversa só do terminal: importa o .jsonl
  // da CLI para uma sessão do BeagleDock, ligada ao mesmo ID nativo.
  const handleOpenFullConversation = async (item: HistorySessionItem) => {
    setShowHistoryModal(false);
    if (item.source === "beagledock" && item.beagleSessionId) {
      try {
        await reopenSession(item.beagleSessionId);
        setActiveTab("chat");
      } catch (err) {
        setAppError((err as Error).message);
      }
      return;
    }

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
            // Reimportar uma conversa que já existe mantém o modelo, o nível e a permissão dela.
            currentModel: existingSession?.currentModel || conversation.model || "",
            nativeSessionId: conversation.nativeSessionId,
            reasoningEffort: existingSession?.reasoningEffort || "",
            ...(existingSession?.permission
              ? { permission: existingSession.permission }
              : {}),
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
  // Apagar definitivamente: mensagens, anexos e a conversa nativa da CLI. Devolve se apagou.
  const handleDeleteConversation = async (item: HistorySessionItem) => {
    if (
      item.beagleSessionId &&
      (pendingTurns.current.get(item.beagleSessionId) || 0) > 0
    ) {
      setAppError("Pare a execução desta conversa antes de apagá-la.");
      return false;
    }
    try {
      const result = await beagleApi.deleteConversation({
        provider: item.provider,
        beagleSessionId: item.beagleSessionId,
        nativeId: item.beagleSessionId ? undefined : item.sessionId,
      });
      if (!result?.success)
        throw new Error(result?.error || "Não foi possível apagar a conversa.");
      if (item.beagleSessionId) forgetSession(item.beagleSessionId);
      return true;
    } catch (err) {
      setAppError((err as Error).message);
      return false;
    }
  };
  return {
    handleDeleteConversation,
    handleSelectSkill,
    handleSelectHistoryPrompt,
    handleOpenFullConversation,
  };
}
