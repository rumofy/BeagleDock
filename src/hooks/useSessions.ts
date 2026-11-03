import { HANDOFF_PROMPT } from "../lib/handoffPrompt";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { backendAvailable, beagleApi } from "../api/beagleApi";
import { conversationTitle } from "../lib/conversationTitle";
import { modelSelection } from "../lib/modelSelection";
import { rememberedChoice, type SessionChoice, type SessionChoices } from "../lib/sessionDefaults";
import {
  livePermissionNotice,
  PERMISSION_LABELS,
  PLAN_APPROVED_PROMPT,
} from "../lib/permissionModes";
import { providerQuota, stripAnsi } from "../lib/format";
import { createFrameBatcher } from "../lib/frameBatcher";
import { appendShellOutput } from "../lib/shellTabs";
import { storableAttachments } from "../lib/attachments";
import { buildContinuation } from "../lib/continuation";
import { PROVIDER_NAMES } from "../lib/approvalLabels";
import { resolveAutoCompact } from "../lib/autoCompact";
import { recordStreamSample } from "../lib/streamMetrics";
import { applyStreamItems, type StreamItem } from "../lib/streamApply";
import { precompactDue, turnGrowth, turnMark, type TurnMark } from "../lib/staleContext";
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
  /** Contexto (tokens) a partir do qual a conversa é compactada sozinha; 0 desliga. */
  autoCompactTokens?: number | null;
  /** Chats novos pelo botão + repetem a última escolha da CLI. */
  rememberSessionChoices?: boolean;
  lastSessionChoices?: SessionChoices;
  /** Avisado quando a pessoa troca modelo, nível ou permissão numa conversa. */
  onSessionChoice?: (providerId: AIProviderId, choice: SessionChoice) => void;
}

/** Conversas, mensagens, turnos pendentes e eventos de streaming das CLIs. */
/** Balão da mensagem que espera a resposta atual terminar (fila do app). */
const QUEUED_TEXT = "Na fila · envio automático após a resposta atual…";
/** Mensagem entregue no meio da resposta, ainda não lida pela IA (ver `deliveredFor`). */
const DELIVERED_ACTIVITY = "Entregue · a IA lê quando a etapa atual terminar";

export function useSessions({
  providers,
  setProviders,
  workspaces,
  userProfile,
  setAppError,
  setActiveTab,
  setShowWorkspaceModal,
  autoCompactTokens,
  rememberSessionChoices,
  lastSessionChoices,
  onSessionChoice,
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
  // Contexto ao fim da última resposta de cada conversa: base para medir o crescimento da próxima.
  const turnMarks = useRef(new Map<string, TurnMark>());
  const [executingSessions, setExecutingSessions] = useState<
    Record<string, number>
  >({});
  const [stoppingSessions, setStoppingSessions] = useState<
    Record<string, boolean>
  >({});
  const contextRef = useRef(contextBySession);
  contextRef.current = contextBySession;
  const autoCompactRef = useRef(autoCompactTokens);
  autoCompactRef.current = autoCompactTokens;
  const pendingTurns = useRef(new Map<string, number>());
  const runGenerations = useRef(new Map<string, number>());
  const isExecutingPrompt = (executingSessions[activeSessionId] || 0) > 0;
  const hasRunningPrompts = Object.values(executingSessions).some(
    (count) => count > 0,
  );

  const allSessions = providers.flatMap((p) => p.sessions);
  const currentSession =
    allSessions.find((s) => s.id === activeSessionId) ||
    allSessions.find((s) => !s.archived);
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
    setActiveSessionId(sessions.find((s) => !s.archived)?.id || "");
    setMessages(saved.messagesBySession || {});
    setContextBySession(
      Object.fromEntries(
        sessions
          .filter((s) => s.context)
          .map((s) => [s.id, s.context as ContextInfo]),
      ),
    );
    turnMarks.current = new Map(
      sessions.flatMap((s) => {
        const mark = turnMark(s.context as ContextInfo | undefined);
        return mark ? [[s.id, mark] as const] : [];
      }),
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
    // A CLI saiu do modo plano sozinha (plano aprovado no pedido do Claude Code): a conversa grava o
    // novo nível, para a próxima mensagem não reiniciar a CLI no modo plano.
    const unsubscribePermission = beagleApi.on(
      "cli-permission-changed",
      ({ sessionId, permission, reason }) => {
        const session = providersRef.current
          .flatMap((p) => p.sessions)
          .find((s) => s.id === sessionId);
        if (!session || (session.permission || "inherit") === permission) return;
        void persistSession({ ...session, permission });
        setPermissionNotice({
          sessionId,
          text:
            reason === "plan-approved"
              ? `Plano aprovado: a conversa saiu do modo plano e agora está em “${PERMISSION_LABELS[permission]}”.`
              : `A CLI mudou o nível da conversa para “${PERMISSION_LABELS[permission]}”.`,
        });
      },
    );
    // Menu da bandeja ou notificação: leva o chat até a conversa.
    const unsubscribeOpen = beagleApi.on("open-session", ({ sessionId }) => {
      setActiveSessionId(sessionId);
      setActiveTab("chat");
    });
    const unsubscribeTurnFinished = beagleApi.on(
      "cli-turn-finished",
      ({ sessionId, responseMessageId, ok, text, error, events, discard, context }) => {
        // Crescimento do contexto nesta resposta, comparado ao fim da anterior (sobrevive a reiniciar
        // a CLI, porque a base vem do contexto salvo). Compactação no meio não tem comparação justa.
        const mark = turnMark(context);
        if (mark) {
          const growth = turnGrowth(turnMarks.current.get(sessionId), mark);
          turnMarks.current.set(sessionId, mark);
          setContextBySession((prev) => {
            if (!prev[sessionId]) return prev;
            const { turnGrowth: _old, ...rest } = prev[sessionId];
            return {
              ...prev,
              [sessionId]: growth === null ? rest : { ...rest, turnGrowth: growth },
            };
          });
        }
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
      unsubscribePermission();
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
    const next = {
      ...currentSession,
      currentModel: selected.model,
      reasoningEffort: selected.effort,
      permission:
        currentSession.reasoningEffort === "plan"
          ? "plan"
          : currentSession.permission,
    };
    void persistSession(next);
    noteChoice(next);
  };
  // Aviso discreto junto ao seletor quando a troca acontece com a resposta em andamento.
  const [permissionNotice, setPermissionNotice] = useState<{
    sessionId: string;
    text: string;
  } | null>(null);
  useEffect(() => {
    if (!permissionNotice) return;
    const timer = setTimeout(() => setPermissionNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [permissionNotice]);
  // Pode trocar a qualquer momento: a conversa grava o nível e a CLI aberta o recebe ao vivo quando
  // consegue (Claude Code; AGY pela ponte de aprovação). Senão vale a partir da próxima mensagem.
  const handlePermissionChange = (permission: PermissionLevel) => {
    if (!currentSession || permission === (currentSession.permission || "inherit")) return;
    const session = currentSession;
    const executing = isExecutingPrompt;
    noteChoice({ ...session, permission });
    void persistSession({ ...session, permission }).then(async (saved) => {
      if (!saved || !backendAvailable()) return;
      try {
        const result = await beagleApi.setLivePermission(session.id, permission);
        const text = livePermissionNotice(result, executing);
        setPermissionNotice(text ? { sessionId: session.id, text } : null);
      } catch (error) {
        setAppError((error as Error).message);
      }
    });
  };

  const handleReasoningChange = (reasoningEffort: string) => {
    if (!currentSession || isExecutingPrompt) return;
    const next = {
      ...currentSession,
      currentModel: currentModelSelection.model,
      reasoningEffort,
      permission:
        currentSession.reasoningEffort === "plan"
          ? "plan"
          : currentSession.permission,
    };
    void persistSession(next);
    noteChoice(next);
  };

  // Guarda a escolha da CLI sempre, para que ligar a opção depois já traga a última usada.
  const noteChoice = (session: ChatSession) =>
    onSessionChoice?.(session.providerId, {
      model: session.currentModel || "",
      effort: session.reasoningEffort || "",
      permission: session.permission || "inherit",
    });

  // "Aprovar plano e executar": tira a conversa do modo plano (Aceitar edições, ao vivo quando a CLI
  // aceita) e pede a implementação. Mesmo caminho nas três CLIs; Codex e AGY reiniciam e retomam a
  // conversa já podendo escrever.
  const handleApprovePlan = async () => {
    if (!currentSession || isExecutingPrompt || currentSession.permission !== "plan") return;
    const session: ChatSession = { ...currentSession, permission: "edits" };
    if (!(await persistSession(session))) return;
    if (backendAvailable())
      await beagleApi.setLivePermission(session.id, "edits").catch(() => undefined);
    await sendPrompt(session, PLAN_APPROVED_PROMPT);
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
    const provider = providers.find((p) => p.id === providerId);
    const remembered = rememberedChoice(
      rememberSessionChoices,
      lastSessionChoices,
      providerId,
      provider?.modelOptions || [],
    );
    await createSession(
      providerId,
      remembered
        ? {
            // Modelo que saiu do catálogo: volta ao padrão da CLI, mas mantém a permissão.
            ...(remembered.model
              ? { model: remembered.model, effort: remembered.effort }
              : {}),
            permission: remembered.permission,
          }
        : {},
    );
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

  // Fechar tira a conversa da barra lateral e encerra o processo da CLI; ela continua no
  // histórico (campo `archived` no banco) e as mensagens saem da memória até ser reaberta.
  const setSessionArchived = async (sessionId: string, archived: boolean) => {
    if (archived && (pendingTurns.current.get(sessionId) || 0) > 0) {
      setAppError("Pare a execução desta conversa antes de fechá-la.");
      return;
    }
    try {
      const result = await beagleApi.setSessionArchived(sessionId, archived);
      if (!result?.success)
        throw new Error(
          result?.error || "Não foi possível fechar a conversa.",
        );
      setProviders((prev) =>
        prev.map((p) => ({
          ...p,
          sessions: p.sessions.map((s) =>
            s.id === sessionId ? { ...s, archived } : s,
          ),
        })),
      );
      if (archived) {
        setMessages((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
        if (activeSessionId === sessionId)
          setActiveSessionId(
            allSessions.find((s) => s.id !== sessionId && !s.archived)?.id ||
              "",
          );
      }
    } catch (error) {
      setAppError((error as Error).message);
    }
  };

  // Reabre pelo histórico uma conversa do BeagleDock: volta à barra lateral com as mensagens salvas.
  const reopenSession = async (sessionId: string) => {
    const session = allSessions.find((s) => s.id === sessionId);
    if (!session) throw new Error("Conversa inexistente ou removida.");
    if (session.archived) {
      const result = await beagleApi.setSessionArchived(sessionId, false);
      if (!result?.success)
        throw new Error(result?.error || "Não foi possível reabrir a conversa.");
    }
    if (!messages[sessionId]) {
      const saved = await beagleApi.getChatMessages(sessionId);
      setMessages((prev) =>
        prev[sessionId] ? prev : { ...prev, [sessionId]: saved || [] },
      );
    }
    setProviders((prev) =>
      prev.map((p) => ({
        ...p,
        sessions: p.sessions.map((s) =>
          s.id === sessionId ? { ...s, archived: false } : s,
        ),
      })),
    );
    setActiveSessionId(sessionId);
  };

  // Depois de apagar pelo histórico: some da tela sem outra ida ao backend.
  const forgetSession = (sessionId: string) => {
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
        allSessions.find((s) => s.id !== sessionId && !s.archived)?.id || "",
      );
  };

  // Claude Code: a compactação é a mensagem /compact (testado com a CLI real); Codex tem comando
  // próprio; o AGY também usa /compact (verificado com a CLI real 1.4.12).
  const compactContext = async (session: ChatSession) => {
    // O AGY compacta pelo comando /compact (verificado com a CLI real 1.4.12), como o Claude Code.
    if (session.providerId === "claude" || session.providerId === "antigravity") {
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

  // "Responder agora" para uma mensagem já entregue que a IA ainda não leu (Claude Code e Codex).
  const answerNowPrompt = async (reply: ChatMessage, mode: "background" | "interrupt") => {
    if (!reply.deliveredFor || (reply.sender !== "claude" && reply.sender !== "codex")) return;
    try {
      const result = await beagleApi.answerNowPrompt({
        sessionId: reply.sessionId,
        responseMessageId: reply.id,
        userMessageId: reply.deliveredFor,
        providerId: reply.sender,
        mode,
      });
      if (!result?.ok) throw new Error(result?.error || "Não foi possível responder agora.");
      setMessages((prev) =>
        !prev[reply.sessionId]
          ? prev
          : {
              ...prev,
              [reply.sessionId]: prev[reply.sessionId].map((m) =>
                m.id === reply.id
                  ? {
                      ...m,
                      deliveredFor: undefined,
                      activity:
                        result.mode === "background"
                          ? "Comando no segundo plano; respondendo à sua mensagem…"
                          : "Etapa interrompida; respondendo à sua mensagem…",
                    }
                  : m,
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

  // Compactação preventiva: conversa parada, contexto grande e cache quase vencendo. Uma vez por
  // última chamada; sessão ocupada ou com a compactação desligada fica de fora.
  const precompacted = useRef<Record<string, number>>({});
  const precompactRef = useRef<() => void>(() => {});
  precompactRef.current = () => {
    if (resolveAutoCompact(autoCompactRef.current) === 0) return;
    const now = Date.now();
    for (const session of providersRef.current.flatMap((p) => p.sessions)) {
      if (session.providerId !== "claude" || session.archived) continue;
      if ((pendingTurns.current.get(session.id) || 0) > 0) continue;
      const due = precompactDue(contextRef.current[session.id], now);
      if (due === null || precompacted.current[session.id] === due) continue;
      precompacted.current[session.id] = due;
      void compactContext({ ...session, status: "idle" });
    }
  };
  useEffect(() => {
    const timer = setInterval(() => precompactRef.current(), 60_000);
    return () => clearInterval(timer);
  }, []);

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
      text: wasPending ? QUEUED_TEXT : "Executando na CLI local…",
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
    const finishReply = (
      text: string,
      events?: ChatEvent[],
      ok = false,
      targetId = responseId,
    ) =>
      setMessages((prev) =>
        !prev[id]
          ? prev
          : {
              ...prev,
              [id]: prev[id].map((m) =>
                m.id === targetId
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
    let autoCompact = false;
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
        userMessageId: userMsg.id,
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
        // O balão da fila vira a resposta a esta mensagem, abaixo dela; a resposta anterior segue
        // com o que já escreveu.
        setMessages((prev) =>
          !prev[id]
            ? prev
            : {
                ...prev,
                [id]: prev[id].map((m) =>
                  m.id === responseId
                    ? (() => {
                        // A IA ainda não escreveu nada para esta mensagem: ela foi entregue, mas a CLI
                        // só a lê quando a etapa atual (ex.: um comando demorado) terminar.
                        const unread =
                          (!m.text || m.text === QUEUED_TEXT) && !m.events?.length;
                        return {
                          ...m,
                          queuedFor: undefined,
                          isStreaming: true,
                          ...(unread
                            ? {
                                text: "",
                                deliveredFor: userMsg.id,
                                activity: DELIVERED_ACTIVITY,
                              }
                            : { activity: m.activity || "Respondendo…" }),
                          startedAt: m.startedAt ?? Date.now(),
                        };
                      })()
                    : m.id === res.rotatedFrom
                      ? { ...m, activity: undefined, detail: undefined }
                      : m,
                ),
              },
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
      const followUps = res?.followUps || [];
      finishReply(
        stripAnsi(
          res?.stopped
            ? res.output || "Execução interrompida pelo usuário."
            : followUps.length
              ? res?.output || ""
              : res?.ok
                ? res.output || "Execução concluída."
                : `Erro: ${res?.error || "Falha na execução."}${res?.output ? "\n\n" + res.output : ""}`,
        ),
        res?.events,
        !!res?.ok,
      );
      // Respostas às mensagens entregues no meio da execução: fecham com o texto de cada uma, e as
      // sem texto saem da tela.
      if (followUps.length) {
        const empty = new Set(
          followUps.filter((f) => !f.text.trim()).map((f) => f.responseMessageId),
        );
        setMessages((prev) =>
          !prev[id]
            ? prev
            : {
                ...prev,
                [id]: prev[id]
                  .filter((m) => !empty.has(m.id))
                  .map((m) => {
                    const done = followUps.find((f) => f.responseMessageId === m.id);
                    return done
                      ? {
                          ...m,
                          text: stripAnsi(done.text),
                          isStreaming: false,
                          queuedFor: undefined,
                          activity: undefined,
                          detail: undefined,
                        }
                      : m;
                  }),
              },
        );
      }
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
      // O AGY não tem limite próprio configurável: ao fim da resposta (cache ainda quente), se o
      // contexto passou do limite e não há mais nada na fila, o app envia o /compact.
      const limit = resolveAutoCompact(
        autoCompactRef.current,
        contextRef.current[id]?.window,
      );
      autoCompact =
        !!res?.ok &&
        sendingSession.providerId === "antigravity" &&
        promptText !== "/compact" &&
        limit > 0 &&
        (contextRef.current[id]?.used ?? 0) >= limit &&
        (pendingTurns.current.get(id) || 0) <= 1;
    } catch (error) {
      setAppError((error as Error).message);
      finishReply(`Erro: ${(error as Error).message}`);
    } finally {
      const count = (pendingTurns.current.get(id) || 1) - 1;
      if (count) pendingTurns.current.set(id, count);
      else pendingTurns.current.delete(id);
      setExecutingSessions(Object.fromEntries(pendingTurns.current));
    }
    if (autoCompact) await sendPrompt({ ...sendingSession, status: "idle" }, "/compact");
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
    handleApprovePlan,
    permissionNotice,
    handleReasoningChange,
    handleTriggerHandoff,
    handleContinueInCli,
    handleCreateSession,
    createSession,
    renameSession,
    setSessionArchived,
    reopenSession,
    forgetSession,
    contextBySession,
    compactContext,
    unreadSessionIds,
    handleStopSession,
    cancelQueuedPrompt,
    forceQueuedPrompt,
    answerNowPrompt,
    sendPrompt,
  };
}
