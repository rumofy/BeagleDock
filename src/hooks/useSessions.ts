import { HANDOFF_PROMPT } from "../lib/handoffPrompt";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { backendAvailable, beagleApi } from "../api/beagleApi";
import { conversationTitle } from "../lib/conversationTitle";
import { modelSelection } from "../lib/modelSelection";
import { providerQuota, stripAnsi } from "../lib/format";
import { createFrameBatcher } from "../lib/frameBatcher";
import { appendShellOutput } from "../lib/shellTabs";
import { storableAttachments } from "../lib/attachments";
import { buildContinuation } from "../lib/continuation";
import { PROVIDER_NAMES } from "../lib/approvalLabels";
import { recordStreamSample } from "../lib/streamMetrics";
import { applyStreamItems, type StreamItem } from "../lib/streamApply";
import type {
  AIProviderId,
  AIProviderStatus,
  ChatAttachment,
  ChatEvent,
  ChatMessage,
  ContextInfo,
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
  // Referências para os ouvintes de eventos, que não são recriados a cada renderização.
  const providersRef = useRef(providers);
  providersRef.current = providers;
  const activeRef = useRef("");
  activeRef.current = activeSessionId;
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  // Conversas com resposta nova (de um turno espontâneo) que você ainda não viu.
  const [unreadSessionIds, setUnreadSessionIds] = useState<string[]>([]);
  const [contextBySession, setContextBySession] = useState<
    Record<string, ContextInfo>
  >({});
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
        const title = session.titleLocked
          ? session.title
          : (saved.messagesBySession?.[session.id] || [])
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
    setActiveSessionId(
      (sessions.find((s) => !s.archived) || sessions[0])?.id || "",
    );
    setMessages(saved.messagesBySession || {});
    setContextBySession(
      Object.fromEntries(
        sessions
          .filter((s) => s.context)
          .map((s) => [s.id, s.context as ContextInfo]),
      ),
    );
  };

  // Ao abrir a conversa, a resposta nova deixa de ser "nova".
  useEffect(() => {
    if (activeSessionId)
      setUnreadSessionIds((prev) =>
        prev.includes(activeSessionId)
          ? prev.filter((id) => id !== activeSessionId)
          : prev,
      );
  }, [activeSessionId]);

  // Listener de streaming do PTY e execução de CLIs
  useEffect(() => {
    if (!backendAvailable()) return;
    // Cada fonte de eventos é entregue à tela em, no máximo, uma renderização por quadro:
    // sem timers que segurem dados, sempre com o estado mais recente.
    const ptyBatcher = createFrameBatcher<{
      sessionId: string;
      data: string;
      pid?: number;
      shellId?: string;
    }>((items) => {
      const bySession = new Map<
        string,
        { data: string; pid?: number; shells: Map<string, string> }
      >();
      for (const item of items) {
        const entry = bySession.get(item.sessionId) ?? {
          data: "",
          shells: new Map<string, string>(),
        };
        entry.data += item.data;
        entry.pid = item.pid || entry.pid;
        if (item.shellId)
          entry.shells.set(
            item.shellId,
            (entry.shells.get(item.shellId) ?? "") + item.data,
          );
        bySession.set(item.sessionId, entry);
      }
      setProviders((prev) =>
        prev.map((p) => {
          if (!p.sessions.some((s) => bySession.has(s.id))) return p;
          return {
            ...p,
            sessions: p.sessions.map((s) => {
              const batch = bySession.get(s.id);
              if (!batch) return s;
              const lines = stripAnsi(batch.data)
                .split(/\r?\n/)
                .filter((l) => l.trim().length > 0);
              return {
                ...s,
                pid: batch.pid || s.pid,
                ptyLog: lines.length
                  ? [...(s.ptyLog || []), ...lines].slice(-150)
                  : s.ptyLog,
                ptyRaw: ((s.ptyRaw || "") + batch.data).slice(-512 * 1024),
                ...(batch.shells.size
                  ? { shellRaw: appendShellOutput(s.shellRaw, batch.shells) }
                  : {}),
              };
            }),
          };
        }),
      );
    });
    const unsubscribePty = beagleApi.on("pty-data", (payload) => {
      if (payload?.sessionId) ptyBatcher.push(payload);
    });

    const streamBatcher = createFrameBatcher<StreamItem>((items) => {
      const wallStart = Date.now();
      const start = performance.now();
      // flushSync mantém o commit dentro do quadro e permite medir o custo real da renderização.
      flushSync(() =>
        setMessages((prev) => applyStreamItems(prev, items, wallStart)),
      );
      const commitMs = performance.now() - start;
      for (const item of items)
        recordStreamSample({
          ipcMs: Math.max(
            0,
            item.receivedAt - (item.payload.emittedAt ?? item.receivedAt),
          ),
          frameWaitMs: wallStart - item.receivedAt,
          commitMs,
        });
    });
    const unsubscribeStream = beagleApi.on("cli-stream-chunk", (payload) => {
      if (payload?.sessionId)
        streamBatcher.push({ kind: "chunk", payload, receivedAt: Date.now() });
    });
    // Turno que a CLI começou sozinha (o agente principal recebeu o resultado de um agente em
    // segundo plano e responde): aparece como uma mensagem nova, ao vivo.
    const unsubscribeTurnStarted = beagleApi.on(
      "cli-turn-started",
      ({ sessionId, responseMessageId, providerId, model }) => {
        setMessages((prev) => {
          const list = prev[sessionId] || [];
          if (list.some((m) => m.id === responseMessageId)) return prev;
          const provider = providersRef.current.find(
            (p) => p.id === providerId,
          );
          return {
            ...prev,
            [sessionId]: [
              ...list,
              {
                id: responseMessageId,
                sessionId,
                sender: providerId,
                senderName:
                  provider?.name || PROVIDER_NAMES[providerId] || providerId,
                modelBadge: model,
                text: "",
                isStreaming: true,
                activity: "Respondendo…",
                startedAt: Date.now(),
                timestamp: new Date().toLocaleTimeString(),
              },
            ],
          };
        });
      },
    );
    const unsubscribeNotice = beagleApi.on("cli-notice", ({ message }) =>
      setAppError(message),
    );
    // Menu da bandeja ou notificação: leva o chat até a conversa.
    const unsubscribeOpen = beagleApi.on("open-session", ({ sessionId }) => {
      setActiveSessionId(sessionId);
      setActiveTab("chat");
    });
    const unsubscribeTurnFinished = beagleApi.on(
      "cli-turn-finished",
      ({ sessionId, responseMessageId, ok, text, error, events, discard }) => {
        setMessages((prev) => {
          const list = prev[sessionId];
          if (!list) return prev;
          if (discard)
            return {
              ...prev,
              [sessionId]: list.filter((m) => m.id !== responseMessageId),
            };
          return {
            ...prev,
            [sessionId]: list.map((m) =>
              m.id === responseMessageId
                ? {
                    ...m,
                    text: stripAnsi(
                      ok
                        ? text || "Execução concluída."
                        : `Erro: ${error || "Falha na execução."}${text ? "\n\n" + text : ""}`,
                    ),
                    isStreaming: false,
                    activity: undefined,
                    detail: undefined,
                    events: events?.length ? events : m.events,
                  }
                : m,
            ),
          };
        });
        if (!discard && activeRef.current !== sessionId)
          setUnreadSessionIds((prev) =>
            prev.includes(sessionId) ? prev : [...prev, sessionId],
          );
      },
    );
    const unsubscribeContext = beagleApi.on(
      "cli-context",
      ({ sessionId, ...info }) => {
        setContextBySession((prev) => ({
          ...prev,
          // Uma atualização só da janela ou do estado "compactando" não apaga o uso já conhecido.
          [sessionId]: {
            ...prev[sessionId],
            ...info,
            used: info.used ?? prev[sessionId]?.used ?? null,
            // Um rastreador novo (app-server reiniciado) começa em zero: o histórico não retrocede.
            compactions: Math.max(
              prev[sessionId]?.compactions ?? 0,
              info.compactions ?? 0,
            ),
            lastCompaction:
              info.lastCompaction ?? prev[sessionId]?.lastCompaction,
          },
        }));
      },
    );
    const unsubscribeEvents = beagleApi.on("cli-activity-event", (payload) => {
      if (payload?.sessionId && payload.event)
        streamBatcher.push({ kind: "event", payload, receivedAt: Date.now() });
    });
    return () => {
      unsubscribePty();
      unsubscribeStream();
      unsubscribeEvents();
      unsubscribeContext();
      unsubscribeTurnStarted();
      unsubscribeOpen();
      unsubscribeNotice();
      unsubscribeTurnFinished();
    };
  }, []);

  const persistSession = async (session: ChatSession) => {
    try {
      // A saída dos shells é só da tela: não é gravada e não precisa cruzar o IPC a cada salvamento.
      const { shellRaw: _shellRaw, ...persistable } = session;
      const result = await beagleApi.saveSession(persistable);
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
                  shellRaw: s.shellRaw,
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

  // O atalho pede à própria CLI da conversa que rode a skill de handoff do ai-memory
  // (antes só listava os handoffs pendentes e nunca criava um).
  const handleTriggerHandoff = async () => {
    if (!currentSession || isExecutingPrompt) return;
    await sendPrompt(currentSession, HANDOFF_PROMPT);
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
      beagleApi
        .saveChatMessage({ ...initMsg, provider: providerId })
        .catch(() => {});

    if (activate) {
      setActiveSessionId(newId);
      setActiveTab("chat");
    }
    return newSession;
  };

  // Continua a tarefa em outra CLI: cria uma sessão nova com o resumo do histórico local. A conversa
  // original e o identificador nativo dela não são tocados.
  const handleContinueInCli = async (targetProviderId: AIProviderId) => {
    if (!currentSession) return;
    const from = providers.find((p) => p.id === currentSession.providerId);
    const to = providers.find((p) => p.id === targetProviderId);
    if (!to || to.id === currentSession.providerId) return;
    const prompt = buildContinuation({
      fromProviderName: from?.name || "outra CLI",
      toProviderName: to.name,
      title: currentSession.title,
      cwd: currentSession.cwd,
      messages: currentMessages,
    });
    const session = await createSession(targetProviderId, {
      title: `Continuação: ${currentSession.title}`,
      cwd: currentSession.cwd,
      permission: currentSession.permission,
    });
    if (session) void sendPrompt(session, prompt);
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

  // Renomear grava o título escolhido: o título automático só troca títulos genéricos, então um
  // nome dado pela pessoa nunca é sobrescrito.
  const renameSession = async (sessionId: string, title: string) => {
    const clean = title.replace(/\s+/g, " ").trim().slice(0, 120);
    const session = allSessions.find((s) => s.id === sessionId);
    if (!clean || !session || clean === session.title) return;
    try {
      const result = await beagleApi.saveSession({
        ...session,
        title: clean,
        titleLocked: true,
      });
      if (!result?.success)
        throw new Error(
          result?.error || "Não foi possível renomear a conversa.",
        );
      setProviders((prev) =>
        prev.map((p) => ({
          ...p,
          sessions: p.sessions.map((s) =>
            s.id === sessionId ? { ...s, title: clean, titleLocked: true } : s,
          ),
        })),
      );
    } catch (error) {
      setAppError((error as Error).message);
    }
  };

  // Arquivar tira da lista principal sem apagar nada; a busca e o histórico continuam enxergando.
  const setSessionArchived = async (sessionId: string, archived: boolean) => {
    if (archived && (pendingTurns.current.get(sessionId) || 0) > 0) {
      setAppError("Pare a execução desta conversa antes de arquivá-la.");
      return;
    }
    try {
      const result = await beagleApi.setSessionArchived(sessionId, archived);
      if (!result?.success)
        throw new Error(
          result?.error || "Não foi possível arquivar a conversa.",
        );
      setProviders((prev) =>
        prev.map((p) => ({
          ...p,
          sessions: p.sessions.map((s) =>
            s.id === sessionId ? { ...s, archived } : s,
          ),
        })),
      );
      if (archived && activeSessionId === sessionId)
        setActiveSessionId(
          allSessions.find((s) => s.id !== sessionId && !s.archived)?.id || "",
        );
    } catch (error) {
      setAppError((error as Error).message);
    }
  };

  // Claude Code: a compactação é a mensagem /compact (testado com a CLI real); Codex tem comando
  // próprio; o AGY não oferece compactação em modo programático.
  const compactContext = async (session: ChatSession) => {
    if (session.providerId === "claude") {
      await sendPrompt(session, "/compact");
      return;
    }
    try {
      const result = await beagleApi.compactSession(
        session.id,
        session.providerId,
      );
      if (!result?.ok)
        setAppError(result?.error || "Não foi possível compactar.");
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

  // Mensagem que ainda espera na fila: remove sem a CLI chegar a recebê-la.
  const cancelQueuedPrompt = async (reply: ChatMessage) => {
    if (!reply.queuedFor) return;
    try {
      const result = await beagleApi.cancelQueuedPrompt({
        sessionId: reply.sessionId,
        responseMessageId: reply.id,
        userMessageId: reply.queuedFor,
      });
      if (!result?.ok)
        throw new Error(result?.error || "Não foi possível remover da fila.");
      setMessages((prev) =>
        !prev[reply.sessionId]
          ? prev
          : {
              ...prev,
              [reply.sessionId]: prev[reply.sessionId].filter(
                (m) => m.id !== reply.id && m.id !== reply.queuedFor,
              ),
            },
      );
    } catch (error) {
      setAppError((error as Error).message);
    }
  };

  // "Enviar agora": interrompe a execução atual para esta mensagem da fila ser a próxima.
  const forceQueuedPrompt = async (reply: ChatMessage) => {
    if (!reply.queuedFor) return;
    try {
      const result = await beagleApi.forceQueuedPrompt({
        sessionId: reply.sessionId,
        responseMessageId: reply.id,
        userMessageId: reply.queuedFor,
      });
      if (!result?.ok)
        throw new Error(result?.error || "Não foi possível enviar agora.");
    } catch (error) {
      setAppError((error as Error).message);
    }
  };

  // Envia um prompt para uma sessão (chat principal ou Manutenção Assistida).
  const sendPrompt = async (
    session: ChatSession,
    promptText: string,
    attachments: ChatAttachment[] = [],
  ) => {
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
      title:
        session.titleLocked || promptText === HANDOFF_PROMPT
          ? session.title
          : conversationTitle(session.title, promptText),
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
      ...(attachments.length ? { attachments: storableAttachments(attachments) } : {}),
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
      ...(wasPending ? { queuedFor: userMsg.id } : {}),
      activity: wasPending ? "Na fila" : "Aguardando a CLI…",
      startedAt: Date.now(),
      timestamp: new Date().toLocaleTimeString(),
    };
    setMessages((prev) => ({
      ...prev,
      [id]: [...(prev[id] || []), userMsg, reply],
    }));
    const finishReply = (text: string, events?: ChatEvent[], ok = false) =>
      setMessages((prev) =>
        !prev[id]
          ? prev
          : {
              ...prev,
              [id]: prev[id].map((m) =>
                m.id === responseId
                  ? {
                      ...m,
                      text,
                      isStreaming: false,
                      queuedFor: undefined,
                      activity: undefined,
                      detail: undefined,
                      // A lista final vem do backend; sem ela, encerra o que ainda estava rodando.
                      events: events?.length
                        ? events
                        : m.events?.map((e) =>
                            e.status === "running"
                              ? { ...e, status: ok ? "done" : "error" }
                              : e,
                          ),
                    }
                  : m,
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
        ...(attachments.length ? { attachments } : {}),
        cwd: sendingSession.cwd,
        model: selected.model,
        effort: selected.effort,
        permission: sendingSession.permission || "inherit",
        cancelled: (runGenerations.current.get(id) || 0) !== generation,
      });
      // A CLI recebeu a mensagem no meio da execução (próxima etapa): a resposta sai no mesmo
      // balão da execução em andamento, então este balão da fila deixa de existir.
      if (res?.injected) {
        setMessages((prev) =>
          !prev[id]
            ? prev
            : { ...prev, [id]: prev[id].filter((m) => m.id !== responseId) },
        );
        return;
      }
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
        res?.events,
        !!res?.ok,
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
    handleContinueInCli,
    handleCreateSession,
    createSession,
    handleDeleteSession,
    renameSession,
    setSessionArchived,
    contextBySession,
    compactContext,
    unreadSessionIds,
    handleStopSession,
    cancelQueuedPrompt,
    forceQueuedPrompt,
    sendPrompt,
  };
}
