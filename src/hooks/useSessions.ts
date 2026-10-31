import { useEffect, useRef, useState } from "react";
import { backendAvailable, beagleApi } from "../api/beagleApi";
import { conversationTitle } from "../lib/conversationTitle";
import { modelSelection } from "../lib/modelSelection";
import { providerQuota, stripAnsi } from "../lib/format";
import type {
  AIProviderId,
  AIProviderStatus,
  ChatMessage,
  ChatSession,
  PermissionLevel,
  UserProfile,
  WorkspaceItem,
} from "../types";
import type { SavedState } from "../types/api";
import type { AppTab } from "./useUi";

interface Params {
  providers: AIProviderStatus[];
  setProviders: React.Dispatch<React.SetStateAction<AIProviderStatus[]>>;
  workspaces: WorkspaceItem[];
  userProfile: UserProfile;
  setAppError: (message: string) => void;
  setActiveTab: (tab: AppTab) => void;
  setShowWorkspaceModal: (show: boolean) => void;
}

/** Conversas, mensagens, turnos pendentes e eventos de streaming das CLIs. */
export function useSessions({
  providers,
  setProviders,
  workspaces,
  userProfile,
  setAppError,
  setActiveTab,
  setShowWorkspaceModal,
}: Params) {
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [executingSessions, setExecutingSessions] = useState<
    Record<string, number>
  >({});
  const [stoppingSessions, setStoppingSessions] = useState<
    Record<string, boolean>
  >({});
  const pendingTurns = useRef(new Map<string, number>());
  const runGenerations = useRef(new Map<string, number>());
  const isExecutingPrompt = (executingSessions[activeSessionId] || 0) > 0;
  const hasRunningPrompts = Object.values(executingSessions).some(
    (count) => count > 0,
  );

  const allSessions = providers.flatMap((p) => p.sessions);
  const currentSession =
    allSessions.find((s) => s.id === activeSessionId) || allSessions[0];
  const currentProvider = providers.find(
    (p) => p.id === currentSession?.providerId,
  );
  const currentQuota = currentProvider
    ? providerQuota(currentProvider)
    : undefined;
  const currentMessages = messages[currentSession?.id || ""] || [];
  const currentModelSelection = modelSelection(
    currentProvider?.modelOptions || [],
    currentSession?.currentModel || "",
    currentSession?.reasoningEffort || "",
  );

  // Estado salvo no SQLite (sessões e mensagens) aplicado na inicialização
  const hydrateSessions = (saved: SavedState) => {
    const sessions: ChatSession[] = (saved.sessions || []).map(
      (session: ChatSession) => {
        const title = (saved.messagesBySession?.[session.id] || [])
          .filter((m: ChatMessage) => m.sender === "user")
          .reduce(
            (current: string, m: ChatMessage) =>
              conversationTitle(current, m.text),
            session.title,
          );
        if (title !== session.title)
          void beagleApi
            .saveSession({ ...session, title })
            .catch((e: Error) => setAppError(e.message));
        return { ...session, title };
      },
    );
    setProviders((prev) =>
      prev.map((p) => ({
        ...p,
        sessions: sessions.filter((s) => s.providerId === p.id),
      })),
    );
    setActiveSessionId(sessions[0]?.id || "");
    setMessages(saved.messagesBySession || {});
  };

  // Listener de streaming do PTY e execução de CLIs
  useEffect(() => {
    if (!backendAvailable()) return;
    const unsubscribePty = beagleApi.on("pty-data", (payload) => {
      if (!payload || !payload.sessionId) return;
      const cleanChunk = stripAnsi(payload.data);
      const lines = cleanChunk
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0);
      if (lines.length === 0) return;

      setProviders((prev) =>
        prev.map((p) => ({
          ...p,
          sessions: p.sessions.map((s) => {
            if (s.id !== payload.sessionId) return s;
            const currentLogs = s.ptyLog || [];
            const updatedLogs = [...currentLogs, ...lines].slice(-150);
            return {
              ...s,
              pid: payload.pid || s.pid,
              ptyLog: updatedLogs,
              ptyRaw: ((s.ptyRaw || "") + payload.data).slice(-512 * 1024),
            };
          }),
        })),
      );
    });

    const unsubscribeStream = beagleApi.on("cli-stream-chunk", (payload) => {
      if (!payload || !payload.sessionId) return;
      setMessages((prev) => {
        const sessionMsgs = prev[payload.sessionId] || [];
        const lastIdx = payload.responseMessageId
          ? sessionMsgs.findIndex((m) => m.id === payload.responseMessageId)
          : sessionMsgs.findIndex((m) => m.isStreaming);
        if (lastIdx >= 0 && sessionMsgs[lastIdx].isStreaming) {
          const updated = [...sessionMsgs];
          updated[lastIdx] = {
            ...updated[lastIdx],
            text:
              typeof payload.fullText === "string"
                ? stripAnsi(payload.fullText)
                : updated[lastIdx].text,
            activity: payload.activity || updated[lastIdx].activity,
          };
          return { ...prev, [payload.sessionId]: updated };
        }
        return prev;
      });
    });
    return () => {
      unsubscribePty();
      unsubscribeStream();
    };
  }, []);

  const persistSession = async (session: ChatSession) => {
    try {
      const result = await beagleApi.saveSession(session);
      if (!result?.success)
        throw new Error(result?.error || "Não foi possível salvar a conversa.");
      setProviders((prev) =>
        prev.map((p) => ({
          ...p,
          sessions: p.sessions.map((s) =>
            s.id === session.id
              ? {
                  ...s,
                  ...session,
                  title: conversationTitle(s.title, session.title),
                  nativeSessionId: s.nativeSessionId || session.nativeSessionId,
                  ptyLog: s.ptyLog,
                  ptyRaw: s.ptyRaw,
                  pid: s.pid || session.pid,
                }
              : s,
          ),
        })),
      );
      return true;
    } catch (error) {
      setAppError((error as Error).message);
      return false;
    }
  };

  const handleWorkspaceChange = (newPath: string) => {
    if (!currentSession) return;
    if (currentSession.nativeSessionId || isExecutingPrompt) {
      setAppError("Crie uma nova conversa para mudar de projeto.");
      return;
    }
    void persistSession({ ...currentSession, cwd: newPath });
  };


  const handleModelChange = (model: string) => {
    if (!currentSession || isExecutingPrompt) return;
    const selected = modelSelection(
      currentProvider?.modelOptions || [],
      model,
      currentModelSelection.effort,
    );
    void persistSession({
      ...currentSession,
      currentModel: selected.model,
      reasoningEffort: selected.effort,
      permission:
        currentSession.reasoningEffort === "plan"
          ? "plan"
          : currentSession.permission,
    });
  };
  const handlePermissionChange = (permission: PermissionLevel) => {
    if (currentSession && !isExecutingPrompt)
      void persistSession({ ...currentSession, permission });
  };


  const handleReasoningChange = (reasoningEffort: string) => {
    if (currentSession && !isExecutingPrompt)
      void persistSession({
        ...currentSession,
        currentModel: currentModelSelection.model,
        reasoningEffort,
        permission:
          currentSession.reasoningEffort === "plan"
            ? "plan"
            : currentSession.permission,
      });
  };


  const handleTriggerHandoff = async () => {
    if (!currentSession) return;

    const handoffMsg: ChatMessage = {
      id: `handoff-usr-${Date.now()}`,
      sessionId: currentSession.id,
      sender: "user",
      senderName: userProfile.firstName,
      text: "/handoff",
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    let realHandoffOutput = "";
    if (backendAvailable()) {
      try {
        const res = await beagleApi.runAIMemoryCommand(
          ["handoffs"],
          currentSession.cwd,
        );
        if (!res?.ok)
          throw new Error(res?.error || "Falha ao consultar handoffs.");
        if (res && res.rawText) {
          realHandoffOutput = `\n\nStatus no servidor:\n${res.rawText.trim()}`;
        }
      } catch (e) {
        setAppError((e as Error).message);
        return;
      }
    }

    const handoffResponse: ChatMessage = {
      id: `handoff-resp-${Date.now() + 1}`,
      sessionId: currentSession.id,
      sender: currentSession.providerId,
      senderName: currentProvider?.name || "IA",
      modelBadge: currentSession.currentModel,
      reasoningBadge: currentSession.reasoningEffort,
      text: `📦 Consulta de handoffs no ai-memory. Nenhum handoff foi criado por esta ação.\n\n• Sessão: "${currentSession.title}"\n• Usuário OS: ${userProfile.fullName} (${userProfile.email})\n• Modelo: ${currentSession.currentModel} (${currentSession.reasoningEffort})\n• Workspace: ${currentSession.cwd}${realHandoffOutput}`,
      commandSnippet: `ai-memory handoffs --cwd "${currentSession.cwd}"`,
      executionSeconds: 1,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((prev) => ({
      ...prev,
      [currentSession.id]: [
        ...(prev[currentSession.id] || []),
        handoffMsg,
        handoffResponse,
      ],
    }));

    if (backendAvailable()) {
      beagleApi
        .saveChatMessage({ ...handoffMsg, provider: currentSession.providerId })
        .catch(() => {});
      beagleApi
        .saveChatMessage({
          ...handoffResponse,
          provider: currentSession.providerId,
        })
        .catch(() => {});
    }
  };


  const handleCreateSession = async (
    providerId: AIProviderId,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    await createSession(providerId);
  };


  // Cria (e persiste) uma sessão de chat; usada pelo botão + e pela Manutenção Assistida.
  const createSession = async (
    providerId: AIProviderId,
    opts: {
      title?: string;
      cwd?: string;
      model?: string;
      effort?: string;
      permission?: PermissionLevel;
      activate?: boolean;
    } = {},
  ): Promise<ChatSession | null> => {
    const activate = opts.activate !== false;
    const provider = providers.find((p) => p.id === providerId);
    if (!provider?.installed) {
      setAppError("Instale e autentique a CLI antes de criar uma conversa.");
      return null;
    }
    const newId = `session-${providerId}-${crypto.randomUUID()}`;
    const defaultCwd =
      opts.cwd ||
      workspaces.find((ws) => ws.path === currentSession?.cwd)?.path ||
      workspaces[0]?.path;
    if (!defaultCwd) {
      setShowWorkspaceModal(true);
      return null;
    }

    const initialSelection = modelSelection(
      provider.modelOptions || [],
      opts.model !== undefined ? opts.model : provider.activeModel || "",
      opts.effort || "",
    );
    const newSession: ChatSession = {
      id: newId,
      providerId,
      permission: opts.permission || "inherit",
      title:
        opts.title || `Nova sessão #${(provider?.sessions.length || 0) + 1}`,
      currentModel: initialSelection.model,
      reasoningEffort: initialSelection.effort,
      status: "idle",
      createdAt: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      lastActive: "Agora",
      cwd: defaultCwd,
      ptyLog: [],
    };
    try {
      const saved = await beagleApi.saveSession(newSession);
      if (!saved?.success)
        throw new Error(saved?.error || "Não foi possível salvar a sessão.");
    } catch (error) {
      setAppError((error as Error).message);
      return null;
    }
    setProviders((prev) =>
      prev.map((p) => {
        if (p.id === providerId) {
          return { ...p, sessions: [newSession, ...p.sessions] };
        }
        return p;
      }),
    );

    const initMsg: ChatMessage = {
      id: `init-${newId}`,
      sessionId: newId,
      sender: providerId,
      senderName: provider?.name || "IA",
      modelBadge: newSession.currentModel,
      reasoningBadge: newSession.reasoningEffort,
      text: `Sessão iniciada com ${provider?.name} (${newSession.currentModel || "padrão da CLI"}) em \`${defaultCwd}\`. Digite uma mensagem para executar na CLI real ou use o terminal PTY.`,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((prev) => ({
      ...prev,
      [newId]: [initMsg],
    }));

    if (backendAvailable())
      beagleApi.saveChatMessage({ ...initMsg, provider: providerId }).catch(() => {});

    if (activate) {
      setActiveSessionId(newId);
      setActiveTab("chat");
    }
    return newSession;
  };


  const handleDeleteSession = async (
    sessionId: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    try {
      const result = await beagleApi.deleteSession(sessionId);
      if (!result?.success)
        throw new Error(result?.error || "Falha ao excluir conversa.");
      setProviders((prev) =>
        prev.map((p) => ({
          ...p,
          sessions: p.sessions.filter((s) => s.id !== sessionId),
        })),
      );
      setMessages((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      if (activeSessionId === sessionId)
        setActiveSessionId(
          allSessions.find((s) => s.id !== sessionId)?.id || "",
        );
    } catch (error) {
      setAppError((error as Error).message);
    }
  };


  const handleStopSession = async (id: string) => {
    if (stoppingSessions[id]) return;
    runGenerations.current.set(id, (runGenerations.current.get(id) || 0) + 1);
    setStoppingSessions((prev) => ({ ...prev, [id]: true }));
    try {
      const result = await beagleApi.interruptCliSession(id);
      if (!result?.ok)
        throw new Error(result?.error || "Não foi possível parar a execução.");
    } catch (error) {
      setAppError((error as Error).message);
    } finally {
      setStoppingSessions((prev) => ({ ...prev, [id]: false }));
    }
  };


  // Envia um prompt para uma sessão (chat principal ou Manutenção Assistida).
  const sendPrompt = async (session: ChatSession, promptText: string) => {
    const provider = providers.find((p) => p.id === session.providerId);
    const selected = modelSelection(
      provider?.modelOptions || [],
      session.currentModel,
      session.reasoningEffort,
    );
    const sendingSession = {
      ...session,
      currentModel: selected.model,
      reasoningEffort: selected.effort,
      title: conversationTitle(session.title, promptText),
      status: "running" as const,
    };
    const id = sendingSession.id;
    const generation = runGenerations.current.get(id) || 0;
    const wasPending = (pendingTurns.current.get(id) || 0) > 0;
    pendingTurns.current.set(id, (pendingTurns.current.get(id) || 0) + 1);
    setExecutingSessions(Object.fromEntries(pendingTurns.current));
    setAppError("");
    const responseId = `ai-${crypto.randomUUID()}`;
    const userMsg: ChatMessage = {
      id: `usr-${crypto.randomUUID()}`,
      sessionId: id,
      sender: "user",
      senderName: userProfile.firstName,
      text: promptText,
      timestamp: new Date().toLocaleTimeString(),
    };
    const reply: ChatMessage = {
      id: responseId,
      sessionId: id,
      sender: sendingSession.providerId,
      senderName: provider?.name || "IA",
      modelBadge: selected.model,
      reasoningBadge: selected.effort,
      text: wasPending
        ? "Na fila · envio automático após a resposta atual…"
        : "Executando na CLI local…",
      isStreaming: true,
      activity: wasPending ? "Na fila" : "Aguardando a CLI…",
      startedAt: Date.now(),
      timestamp: new Date().toLocaleTimeString(),
    };
    setMessages((prev) => ({
      ...prev,
      [id]: [...(prev[id] || []), userMsg, reply],
    }));
    const finishReply = (text: string) =>
      setMessages((prev) =>
        !prev[id]
          ? prev
          : {
              ...prev,
              [id]: prev[id].map((m) =>
                m.id === responseId ? { ...m, text, isStreaming: false } : m,
              ),
            },
      );
    try {
      if (!(await persistSession(sendingSession)))
        throw new Error("Não foi possível salvar a conversa.");
      const saved = await beagleApi.saveChatMessage({
        ...userMsg,
        provider: sendingSession.providerId,
      });
      if (!saved?.success)
        throw new Error(saved?.error || "Não foi possível salvar a mensagem.");
      const res = await beagleApi.executeCliPrompt({
        sessionId: id,
        providerId: sendingSession.providerId,
        responseMessageId: responseId,
        prompt: promptText,
        cwd: sendingSession.cwd,
        model: selected.model,
        effort: selected.effort,
        permission: sendingSession.permission || "inherit",
        cancelled: (runGenerations.current.get(id) || 0) !== generation,
      });
      if (res?.cancelled && !res?.stopped) {
        setMessages((prev) =>
          !prev[id]
            ? prev
            : { ...prev, [id]: prev[id].filter((m) => m.id !== responseId) },
        );
        return;
      }
      finishReply(
        stripAnsi(
          res?.stopped
            ? res.output || "Execução interrompida pelo usuário."
            : res?.ok
              ? res.output || "Execução concluída."
              : `Erro: ${res?.error || "Falha na execução."}${res?.output ? "\n\n" + res.output : ""}`,
        ),
      );
      setProviders((prev) =>
        prev.map((p) => ({
          ...p,
          sessions: p.sessions.map((session) =>
            session.id === id
              ? {
                  ...session,
                  nativeSessionId:
                    res?.nativeSessionId || session.nativeSessionId,
                  status:
                    (pendingTurns.current.get(id) || 0) > 1
                      ? "running"
                      : res?.ok || res?.stopped
                        ? "idle"
                        : "error",
                }
              : session,
          ),
        })),
      );
    } catch (error) {
      setAppError((error as Error).message);
      finishReply(`Erro: ${(error as Error).message}`);
    } finally {
      const count = (pendingTurns.current.get(id) || 1) - 1;
      if (count) pendingTurns.current.set(id, count);
      else pendingTurns.current.delete(id);
      setExecutingSessions(Object.fromEntries(pendingTurns.current));
    }
  };

  return {
    activeSessionId,
    setActiveSessionId,
    messages,
    setMessages,
    executingSessions,
    stoppingSessions,
    pendingTurns,
    runGenerations,
    isExecutingPrompt,
    hasRunningPrompts,
    allSessions,
    currentSession,
    currentProvider,
    currentQuota,
    currentMessages,
    currentModelSelection,
    hydrateSessions,
    persistSession,
    handleWorkspaceChange,
    handleModelChange,
    handlePermissionChange,
    handleReasoningChange,
    handleTriggerHandoff,
    handleCreateSession,
    createSession,
    handleDeleteSession,
    handleStopSession,
    sendPrompt,
  };
}
