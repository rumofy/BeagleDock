import { useState } from "react";
import { beagleApi } from "../../api/beagleApi";
import type { AIProviderId } from "../../types";
import type { CliApproval } from "../../types/api";
import type { useSessions } from "../../hooks/useSessions";
import type { AppTab } from "../../hooks/useUi";

interface Params {
  sessions: ReturnType<typeof useSessions>;
  cliApprovals: CliApproval[];
  setAppError: (message: string) => void;
  setActiveTab: (tab: AppTab) => void;
}

/** Sessão de Manutenção Assistida do ai-memory exibida dentro do explorador. */
export function useMaintenanceChat({
  sessions,
  cliApprovals,
  setAppError,
  setActiveTab,
}: Params) {
  const {
    allSessions,
    messages,
    executingSessions,
    stoppingSessions,
    setActiveSessionId,
    createSession,
    sendPrompt,
    handleStopSession,
  } = sessions;
  const [maintenanceSessionId, setMaintenanceSessionId] = useState("");
  const handleStartMaintenance = async (args: {
    providerId: AIProviderId;
    model: string;
    effort: string;
    title: string;
    prompt: string;
  }): Promise<string | null> => {
    try {
      const cwd = await beagleApi.getAIMemoryMaintenanceCwd();
      const session = await createSession(args.providerId, {
        title: args.title,
        cwd,
        model: args.model,
        effort: args.effort,
        permission: "inherit",
        activate: false,
      });
      if (!session) return null;
      setMaintenanceSessionId(session.id);
      void sendPrompt(session, args.prompt);
      return session.id;
    } catch (error) {
      setAppError((error as Error).message);
      return null;
    }
  };
  const maintenanceSession = allSessions.find(
    (x) => x.id === maintenanceSessionId,
  );
  const maintenanceChat = maintenanceSession
    ? {
        session: maintenanceSession,
        messages: messages[maintenanceSession.id] || [],
        executing: (executingSessions[maintenanceSession.id] || 0) > 0,
        stopping: !!stoppingSessions[maintenanceSession.id],
        approvals: cliApprovals.filter(
          (a) => a.sessionId === maintenanceSession.id,
        ),
        onSend: (text: string) => {
          void sendPrompt(maintenanceSession, text);
        },
        onStop: () => void handleStopSession(maintenanceSession.id),
        onResolveApproval: async (id: string, decision: string, message?: string) => {
          try {
            await beagleApi.resolveCliApproval(id, decision, message);
          } catch (e) {
            setAppError((e as Error).message);
          }
        },
        onOpenInChat: () => {
          setActiveSessionId(maintenanceSession.id);
          setActiveTab("chat");
        },
        onClose: () => setMaintenanceSessionId(""),
      }
    : null;
  return {
    maintenanceSessionId,
    maintenanceChat,
    handleStartMaintenance,
  };
}
