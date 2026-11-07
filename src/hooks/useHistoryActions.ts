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
import type { useCliTerminals } from "./useCliTerminals";

import { t, tn } from "../i18n";
interface Params {
  sessions: ReturnType<typeof useSessions>;
  cliTerminals: ReturnType<typeof useCliTerminals>;
  setProviders: React.Dispatch<React.SetStateAction<AIProviderStatus[]>>;
  setAppError: (message: string) => void;
  setActiveTab: (tab: AppTab) => void;
  setInputMessage: (text: string) => void;
  setShowSkillsModal: (show: boolean) => void;
  setShowHistoryModal: (show: boolean) => void;
}

/** Actions of the skills and history modals that fill the conversation or import history. */
export function useHistoryActions({
  sessions,
  cliTerminals,
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
    currentSession,
  } = sessions;
  const fillPrompt = (text: string) => {
    if (currentSession && cliTerminals.isTerminal(currentSession.id)) {
      if (!currentSession.nativeSessionId && !currentSession.cwdLocked && !cliTerminals.hasStarted(currentSession.id)) {
        setAppError(t("terminal.startBeforePrompt"));
        return;
      }
      setActiveTab("chat");
      void cliTerminals.pasteToTerminal(currentSession.id, text);
    } else {
      setInputMessage(text);
    }
  };
  const handleSelectSkill = (skill: SkillItem) => {
    setShowSkillsModal(false);
    if (skill.name === "revisao-interna") {
      fillPrompt("manda pro revisor");
    } else if (skill.name === "revisao-seguranca") {
      fillPrompt("revisar seguranca");
    } else {
      fillPrompt(`use skill ${skill.name}`);
    }
  };

  const handleSelectHistoryPrompt = (
    item: HistorySessionItem,
    e?: React.MouseEvent,
  ) => {
    if (e) e.stopPropagation();
    setShowHistoryModal(false);
    fillPrompt(item.prompt);
  };

  // BeagleDock conversation: reopen its own session. Terminal-only conversation: import the CLI's
  // .jsonl into a BeagleDock session, linked to the same native ID.
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
            // Re-importing an existing conversation keeps its model, level and permission.
            currentModel: existingSession?.currentModel || conversation.model || "",
            nativeSessionId: conversation.nativeSessionId,
            reasoningEffort: existingSession?.reasoningEffort || "",
            ...(existingSession?.permission
              ? { permission: existingSession.permission }
              : {}),
            status: "idle",
            createdAt: item.date,
            lastActive: t("session.fromHistory"),
            // Just opened from the history: it goes to the top of the sidebar.
            lastMessageAt: Date.now(),
            cwd: conversation.cwd,
            ptyLog: [
              tn("session.restored", fullMsgs.length),
            ],
          };

          const saved = await beagleApi.saveSession(newSessionObj);
          if (!saved?.success)
            throw new Error(saved?.error || t("session.saveFailed"));
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
              importedResult?.error || t("history.importFailed"),
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

          // Save the settings so it's permanent

          setActiveSessionId(newSessionId);
          setActiveTab("chat");
          return;
        }
      } catch (err) {
        setAppError((err as Error).message);
      }
    }

    fillPrompt(item.prompt);
  };
  // Delete permanently: messages, attachments and the CLI's native conversation. Returns whether it did.
  const handleDeleteConversation = async (item: HistorySessionItem) => {
    if (
      item.beagleSessionId &&
      (pendingTurns.current.get(item.beagleSessionId) || 0) > 0
    ) {
      setAppError(t("session.stopBeforeDelete"));
      return false;
    }
    try {
      const result = await beagleApi.deleteConversation({
        provider: item.provider,
        beagleSessionId: item.beagleSessionId,
        nativeId: item.beagleSessionId ? undefined : item.sessionId,
      });
      if (!result?.success)
        throw new Error(result?.error || t("session.deleteFailed"));
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
