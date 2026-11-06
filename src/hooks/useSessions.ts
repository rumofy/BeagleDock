import { handoffPrompt } from "../lib/handoffPrompt";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { backendAvailable, beagleApi } from "../api/beagleApi";
import { conversationTitle } from "../lib/conversationTitle";
import { modelSelection } from "../lib/modelSelection";
import { rememberedChoice, type SessionChoice, type SessionChoices } from "../lib/sessionDefaults";
import {
  livePermissionNotice,
  PERMISSION_LABELS,
  planApprovedPrompt,
  permissionAfterPlan,
  withPermission,
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
import { hasLiveReply } from "../lib/backgroundWork";
import { mergeLive, mergeSessions } from "../lib/liveMessages";
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
import type { LiveTurn, SavedState } from "../types/api";
import type { AppTab } from "./useUi";

import { t } from "../i18n";
interface Params {
  providers: AIProviderStatus[];
  setProviders: React.Dispatch<React.SetStateAction<AIProviderStatus[]>>;
  workspaces: WorkspaceItem[];
  userProfile: UserProfile;
  setAppError: (message: string) => void;
  setActiveTab: (tab: AppTab) => void;
  setShowWorkspaceModal: (show: boolean) => void;
  /** Context (tokens) above which the conversation compacts itself; 0 turns it off. */
  autoCompactTokens?: number | null;
  /** New chats from the + button repeat the CLI's last choice. */
  rememberSessionChoices?: boolean;
  lastSessionChoices?: SessionChoices;
  /** Notified when the person changes model, level or permission in a conversation. */
  onSessionChoice?: (providerId: AIProviderId, choice: SessionChoice) => void;
}

/** Conversations, messages, pending turns and streaming events of the CLIs. */
/** Bubble of a message waiting for the current reply to finish (app queue). */
const queuedText = () => t("session.queuedText");
const runningText = () => t("session.runningText");
/** Message delivered mid-reply, not yet read by the AI (see `deliveredFor`). */
const deliveredActivity = () => t("session.deliveredActivity");

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
  // References for the event listeners, which aren't recreated on every render.
  const providersRef = useRef(providers);
  providersRef.current = providers;
  const activeRef = useRef("");
  activeRef.current = activeSessionId;
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // Conversations with a new reply (from a spontaneous turn) you haven't seen yet.
  const [unreadSessionIds, setUnreadSessionIds] = useState<string[]>([]);
  const [contextBySession, setContextBySession] = useState<
    Record<string, ContextInfo>
  >({});
  // Context at the end of each conversation's last reply: the baseline to measure the next one's growth.
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
  // A turn the CLI started on its own is also an execution: it shows as running and can be stopped.
  const isExecutingPrompt =
    (executingSessions[activeSessionId] || 0) > 0 ||
    hasLiveReply(messages[activeSessionId]);
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

  // Marks a conversation as just updated (message sent, reply started or finished): the sidebar
  // lists the most recently updated conversations first.
  const touchSession = (sessionId: string) => {
    const at = Date.now();
    setProviders((prev) =>
      prev.map((p) =>
        p.sessions.some((s) => s.id === sessionId)
          ? {
              ...p,
              sessions: p.sessions.map((s) =>
                s.id === sessionId ? { ...s, lastMessageAt: at } : s,
              ),
            }
          : p,
      ),
    );
  };

  // Reply started elsewhere (another screen, or the CLI on its own after a background agent): it
  // shows up as a new live message.
  const addLiveTurn = ({ sessionId, responseMessageId, providerId, model }: LiveTurn) => {
    touchSession(sessionId);
    setMessages((prev) => {
      const list = prev[sessionId] || [];
      if (list.some((m) => m.id === responseMessageId)) return prev;
      const provider = providersRef.current.find((p) => p.id === providerId);
      return {
        ...prev,
        [sessionId]: [
          ...list,
          {
            id: responseMessageId,
            sessionId,
            sender: providerId,
            senderName: provider?.name || PROVIDER_NAMES[providerId] || providerId,
            modelBadge: model,
            text: "",
            isStreaming: true,
            activity: t("session.replying"),
            startedAt: Date.now(),
            timestamp: new Date().toLocaleTimeString(),
          },
        ],
      };
    });
  };
  // The replies in progress on the computer, for a screen that opened or reconnected late: the
  // missing ones show up live and the ones that ended meanwhile come back from the database.
  const applyLiveTurns = (turns: LiveTurn[]) => {
    for (const turn of turns) addLiveTurn(turn);
    // What a reply showed while this screen was away (phone in the background, dropped
    // connection): the events it missed never come again.
    const now = Date.now();
    const caughtUp = turns.flatMap((turn): StreamItem[] => {
      const base = { sessionId: turn.sessionId, responseMessageId: turn.responseMessageId };
      return [
        ...(turn.events || []).map((event) => ({ kind: "event" as const, payload: { ...base, event }, receivedAt: now })),
        ...(turn.text !== undefined || turn.activity !== undefined
          ? [
              {
                kind: "chunk" as const,
                payload: { ...base, fullText: turn.text, activity: turn.activity, detail: turn.detail },
                receivedAt: now,
              },
            ]
          : []),
      ];
    });
    if (caughtUp.length) setMessages((prev) => applyStreamItems(prev, caughtUp, now));
    const live = new Set(turns.map((turn) => turn.responseMessageId));
    const ended = (list: ChatMessage[] = []) => list.some((m) => m.isStreaming && !live.has(m.id));
    for (const [sessionId, list] of Object.entries(messagesRef.current)) {
      // This screen's own turns end with their own request.
      if ((pendingTurns.current.get(sessionId) || 0) > 0 || !ended(list)) continue;
      void beagleApi
        .getChatMessages(sessionId)
        .then((saved) =>
          setMessages((prev) => ({
            ...prev,
            [sessionId]: mergeLive(
              saved || [],
              (prev[sessionId] || []).filter((m) => !m.isStreaming || live.has(m.id)),
              true,
            ),
          })),
        )
        .catch((e: Error) => setAppError(e.message));
    }
  };

  // State saved in SQLite (sessions and messages) applied at startup
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
    void beagleApi
      .getLiveTurns()
      .then((turns) => applyLiveTurns(turns || []))
      .catch(() => {});
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

  // Opening the conversation makes the new reply no longer "new".
  useEffect(() => {
    if (activeSessionId)
      setUnreadSessionIds((prev) =>
        prev.includes(activeSessionId)
          ? prev.filter((id) => id !== activeSessionId)
          : prev,
      );
  }, [activeSessionId]);

  // Streaming listener for the PTY and CLI runs
  useEffect(() => {
    if (!backendAvailable()) return;
    // Each event source reaches the screen in at most one render per frame:
    // no timers holding data back, always with the latest state.
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
      // flushSync keeps the commit inside the frame and lets us measure the real render cost.
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
    // Turn the CLI started on its own (the main agent got the result of a background agent and
    // replies): it shows up as a new live message.
    const unsubscribeTurnStarted = beagleApi.on("cli-turn-started", addLiveTurn);
    const unsubscribeLiveTurns = beagleApi.on("live-turns", (turns) => applyLiveTurns(turns || []));
    const unsubscribeNotice = beagleApi.on("cli-notice", ({ message }) =>
      setAppError(message),
    );
    // The CLI left plan mode on its own (plan approved in Claude Code's request): the conversation saves
    // the new level, so the next message doesn't restart the CLI in plan mode.
    const unsubscribePermission = beagleApi.on(
      "cli-permission-changed",
      ({ sessionId, permission, reason }) => {
        const session = providersRef.current
          .flatMap((p) => p.sessions)
          .find((s) => s.id === sessionId);
        if (!session || (session.permission || "inherit") === permission) return;
        void persistSession(withPermission(session, permission));
        setPermissionNotice({
          sessionId,
          text:
            reason === "plan-approved"
              ? t("session.planApprovedNotice", { level: PERMISSION_LABELS[permission] })
              : t("session.cliChangedLevel", { level: PERMISSION_LABELS[permission] }),
        });
      },
    );
    // Tray menu or notification: take the chat to the conversation.
    const unsubscribeOpen = beagleApi.on("open-session", ({ sessionId }) => {
      setActiveSessionId(sessionId);
      setActiveTab("chat");
    });
    // Terminal mode: what was said in the CLI's interface reached the history; reload the
    // conversation and title it from the first message, as in the chat.
    const unsubscribeTerminalHistory = beagleApi.on("cli-terminal-history", ({ sessionId }) => {
      void beagleApi
        .getChatMessages(sessionId)
        .then((saved) => {
          const list: ChatMessage[] = saved || [];
          setMessages((prev) => ({ ...prev, [sessionId]: list }));
          touchSession(sessionId);
          setProviders((prev) =>
            prev.map((p) => ({
              ...p,
              sessions: p.sessions.map((session) => {
                if (session.id !== sessionId || session.titleLocked) return session;
                const title = list
                  .filter((m) => m.sender === "user")
                  .reduce((current, m) => conversationTitle(current, m.text), session.title);
                if (title === session.title) return session;
                void beagleApi
                  .saveSession({ ...session, title })
                  .catch((e: Error) => setAppError(e.message));
                return { ...session, title };
              }),
            })),
          );
        })
        .catch((e: Error) => setAppError(e.message));
    });
    const unsubscribeTurnFinished = beagleApi.on(
      "cli-turn-finished",
      ({ sessionId, responseMessageId, ok, text, error, events, discard, context }) => {
        if (!discard) touchSession(sessionId);
        // Context growth in this reply, compared to the end of the previous one (survives restarting
        // the CLI, because the baseline comes from the saved context). A compaction midway has no fair comparison.
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
                        ? text || t("session.done")
                        : `${t("session.errorPrefix")} ${error || t("session.runFailed")}${text ? "\n\n" + text : ""}`,
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
          // An update of only the window or the "compacting" state doesn't erase the known usage.
          [sessionId]: {
            ...prev[sessionId],
            ...info,
            used: info.used ?? prev[sessionId]?.used ?? null,
            // A new tracker (restarted app-server) starts at zero: the history doesn't go backwards.
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
    // Another screen (desktop or paired phone) changed a conversation: reload it from the database.
    // Bursts (a turn saves several messages) are grouped.
    const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const later = (key: string, run: () => void) => {
      clearTimeout(syncTimers.get(key));
      syncTimers.set(key, setTimeout(run, 200));
    };
    const reloadMessages = (sessionId: string, active: boolean) =>
      beagleApi
        .getChatMessages(sessionId)
        .then((saved) =>
          setMessages((prev) => ({ ...prev, [sessionId]: mergeLive(saved || [], prev[sessionId], active) })),
        )
        .catch((e: Error) => setAppError(e.message));
    const reloadSessions = () =>
      beagleApi
        .getSessions()
        .then((saved) => {
          const known = new Set(providersRef.current.flatMap((p) => p.sessions.map((s) => s.id)));
          setProviders((prev) =>
            prev.map((p) => ({
              ...p,
              sessions: mergeSessions(p.sessions, saved.filter((s) => s.providerId === p.id)),
            })),
          );
          // A conversation created on the other screen comes with its messages.
          for (const session of saved)
            if (!known.has(session.id) && !session.archived) void reloadMessages(session.id, false);
        })
        .catch((e: Error) => setAppError(e.message));
    const unsubscribeSync = beagleApi.on("chat-sync", ({ kind, sessionId, active }) => {
      if (kind === "sessions") later("sessions", () => void reloadSessions());
      else if (sessionId) later(`messages:${sessionId}`, () => void reloadMessages(sessionId, !!active));
    });
    return () => {
      unsubscribeSync();
      for (const timer of syncTimers.values()) clearTimeout(timer);
      unsubscribePty();
      unsubscribeStream();
      unsubscribeEvents();
      unsubscribeContext();
      unsubscribeTurnStarted();
      unsubscribeLiveTurns();
      unsubscribeOpen();
      unsubscribeTerminalHistory();
      unsubscribeNotice();
      unsubscribePermission();
      unsubscribeTurnFinished();
    };
  }, []);

  const persistSession = async (session: ChatSession) => {
    try {
      // Shell output is screen-only: it isn't saved and doesn't need to cross IPC on every save.
      const { shellRaw: _shellRaw, ...persistable } = session;
      const result = await beagleApi.saveSession(persistable);
      if (!result?.success)
        throw new Error(result?.error || t("session.saveConversationFailed"));
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
      setAppError(t("session.newForProject"));
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
  // Discreet notice next to the picker when the change happens while a reply is running.
  const [permissionNotice, setPermissionNotice] = useState<{
    sessionId: string;
    text: string;
  } | null>(null);
  useEffect(() => {
    if (!permissionNotice) return;
    const timer = setTimeout(() => setPermissionNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [permissionNotice]);
  // It can change at any time: the conversation saves the level and the open CLI gets it live when it
  // can (Claude Code; AGY through the approval bridge). Otherwise it applies from the next message.
  const handlePermissionChange = (permission: PermissionLevel) => {
    if (!currentSession || permission === (currentSession.permission || "inherit")) return;
    const session = currentSession;
    const executing = isExecutingPrompt;
    const next = withPermission(session, permission);
    noteChoice(next);
    void persistSession(next).then(async (saved) => {
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

  // Always keep the CLI's choice, so turning the option on later brings back the last one used.
  const noteChoice = (session: ChatSession) =>
    onSessionChoice?.(session.providerId, {
      model: session.currentModel || "",
      effort: session.reasoningEffort || "",
      permission: session.permission || "inherit",
    });

  // Approving restores the conversation's permission from before plan mode, then continues
  // the same native conversation. Read-only planning never changes that saved permission.
  const handleApprovePlan = async () => {
    if (!currentSession || isExecutingPrompt || currentSession.permission !== "plan") return;
    const session = withPermission(currentSession, permissionAfterPlan(currentSession));
    if (!(await persistSession(session))) return;
    if (backendAvailable())
      await beagleApi.setLivePermission(session.id, session.permission || "inherit").catch(() => undefined);
    await sendPrompt(session, planApprovedPrompt());
  };

  // The shortcut asks the conversation's own CLI to run ai-memory's handoff skill
  // (it used to only list pending handoffs and never create one).
  const handleTriggerHandoff = async () => {
    if (!currentSession || isExecutingPrompt) return;
    await sendPrompt(currentSession, handoffPrompt());
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
            // Model that left the catalog: back to the CLI default, but keep the permission.
            ...(remembered.model
              ? { model: remembered.model, effort: remembered.effort }
              : {}),
            permission: remembered.permission,
          }
        : {},
    );
  };

  // Creates (and persists) a chat session; used by the + button and by Assisted Maintenance.
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
      setAppError(t("session.installFirst"));
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
        opts.title || t("session.newTitle", { n: (provider?.sessions.length || 0) + 1 }),
      currentModel: initialSelection.model,
      reasoningEffort: initialSelection.effort,
      status: "idle",
      createdAt: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      lastActive: t("time.now"),
      lastMessageAt: Date.now(),
      cwd: defaultCwd,
      ptyLog: [],
    };
    try {
      const saved = await beagleApi.saveSession(newSession);
      if (!saved?.success)
        throw new Error(saved?.error || t("session.saveFailed"));
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
      senderName: provider?.name || t("session.ai"),
      modelBadge: newSession.currentModel,
      reasoningBadge: newSession.reasoningEffort,
      text: t("session.started", { provider: provider?.name || "", model: newSession.currentModel || t("stale.cliDefault"), cwd: defaultCwd }),
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

  // Continues the task in another CLI: creates a new session with a summary of the local history. The
  // original conversation and its native identifier aren't touched.
  const handleContinueInCli = async (targetProviderId: AIProviderId) => {
    if (!currentSession) return;
    const from = providers.find((p) => p.id === currentSession.providerId);
    const to = providers.find((p) => p.id === targetProviderId);
    if (!to || to.id === currentSession.providerId) return;
    const prompt = buildContinuation({
      fromProviderName: from?.name || t("session.otherCli"),
      toProviderName: to.name,
      title: currentSession.title,
      cwd: currentSession.cwd,
      messages: currentMessages,
    });
    const session = await createSession(targetProviderId, {
      title: t("session.continuationTitle", { title: currentSession.title }),
      cwd: currentSession.cwd,
      permission: currentSession.permission,
    });
    if (session) void sendPrompt(session, prompt);
  };

  // Renaming saves the chosen title: the automatic title only replaces generic titles, so a
  // name the person gave is never overwritten.
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
          result?.error || t("session.renameFailed"),
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

  // Closing removes the conversation from the sidebar and stops the CLI process; it stays in the
  // history (`archived` column in the database) and its messages leave memory until it's reopened.
  const setSessionArchived = async (sessionId: string, archived: boolean) => {
    if (archived && (pendingTurns.current.get(sessionId) || 0) > 0) {
      setAppError(t("session.stopBeforeClose"));
      return;
    }
    try {
      const result = await beagleApi.setSessionArchived(sessionId, archived);
      if (!result?.success)
        throw new Error(
          result?.error || t("session.closeFailed"),
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

  // Reopens a BeagleDock conversation from the history: back to the sidebar with its saved messages.
  const reopenSession = async (sessionId: string) => {
    const session = allSessions.find((s) => s.id === sessionId);
    if (!session) throw new Error(t("session.missing"));
    if (session.archived) {
      const result = await beagleApi.setSessionArchived(sessionId, false);
      if (!result?.success)
        throw new Error(result?.error || t("session.reopenFailed"));
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
          s.id === sessionId ? { ...s, archived: false, lastMessageAt: Date.now() } : s,
        ),
      })),
    );
    setActiveSessionId(sessionId);
  };

  // After deleting from the history: it leaves the screen without another backend round trip.
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

  // Claude Code: compaction is the /compact message (tested with the real CLI); Codex has its own
  // command; AGY also uses /compact (verified with the real CLI 1.4.12).
  const compactContext = async (session: ChatSession) => {
    // AGY compacts with the /compact command (verified with the real CLI 1.4.12), like Claude Code.
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
        setAppError(result?.error || t("session.compactFailed"));
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
        throw new Error(result?.error || t("session.stopFailed"));
    } catch (error) {
      setAppError((error as Error).message);
    } finally {
      setStoppingSessions((prev) => ({ ...prev, [id]: false }));
    }
  };

  // Message still waiting in the queue: remove it before the CLI ever gets it.
  const cancelQueuedPrompt = async (reply: ChatMessage) => {
    if (!reply.queuedFor) return;
    try {
      const result = await beagleApi.cancelQueuedPrompt({
        sessionId: reply.sessionId,
        responseMessageId: reply.id,
        userMessageId: reply.queuedFor,
      });
      if (!result?.ok)
        throw new Error(result?.error || t("session.dequeueFailed"));
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

  // "Answer now" for a message already delivered that the AI hasn't read yet (Claude Code and Codex).
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
      if (!result?.ok) throw new Error(result?.error || t("session.answerNowFailed"));
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
                          ? t("session.answeringBackground")
                          : t("session.answeringInterrupted"),
                    }
                  : m,
              ),
            },
      );
    } catch (error) {
      setAppError((error as Error).message);
    }
  };

  // "Send now": interrupts the current run so this queued message is next.
  const forceQueuedPrompt = async (reply: ChatMessage) => {
    if (!reply.queuedFor) return;
    try {
      const result = await beagleApi.forceQueuedPrompt({
        sessionId: reply.sessionId,
        responseMessageId: reply.id,
        userMessageId: reply.queuedFor,
      });
      if (!result?.ok)
        throw new Error(result?.error || t("session.sendNowFailed"));
    } catch (error) {
      setAppError((error as Error).message);
    }
  };

  // Preventive compaction: idle conversation, large context and cache about to expire. Once per
  // last call; busy sessions or ones with compaction off are skipped.
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

  // Sends a prompt to a session (main chat or Assisted Maintenance).
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
        session.titleLocked || promptText === handoffPrompt()
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
      senderName: provider?.name || t("session.ai"),
      modelBadge: selected.model,
      reasoningBadge: selected.effort,
      text: wasPending ? queuedText() : runningText(),
      isStreaming: true,
      ...(wasPending ? { queuedFor: userMsg.id } : {}),
      activity: wasPending ? t("session.queued") : t("session.waitingCli"),
      startedAt: Date.now(),
      timestamp: new Date().toLocaleTimeString(),
    };
    setMessages((prev) => ({
      ...prev,
      [id]: [...(prev[id] || []), userMsg, reply],
    }));
    touchSession(id);
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
                      // The final list comes from the backend; without it, close what was still running.
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
        throw new Error(t("session.saveConversationFailed"));
      const saved = await beagleApi.saveChatMessage({
        ...userMsg,
        provider: sendingSession.providerId,
      });
      if (!saved?.success)
        throw new Error(saved?.error || t("session.saveMessageFailed"));
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
      // The CLI got the message mid-run (next step): the reply comes out in the same bubble as
      // the run in progress, so this queue bubble goes away.
      if (res?.injected) {
        // The queue bubble becomes the reply to this message, below it; the previous reply keeps
        // what it already wrote.
        setMessages((prev) =>
          !prev[id]
            ? prev
            : {
                ...prev,
                [id]: prev[id].map((m) =>
                  m.id === responseId
                    ? (() => {
                        // The AI hasn't written anything for this message yet: it was delivered, but the CLI
                        // only reads it when the current step (e.g. a long command) finishes.
                        const unread =
                          (!m.text || m.text === queuedText()) && !m.events?.length;
                        return {
                          ...m,
                          queuedFor: undefined,
                          isStreaming: true,
                          ...(unread
                            ? {
                                text: "",
                                deliveredFor: userMsg.id,
                                activity: deliveredActivity(),
                              }
                            : { activity: m.activity || t("session.replying") }),
                          startedAt: m.startedAt ?? Date.now(),
                        };
                      })()
                    : m.id === res.rotatedFrom
                      ? // The previous reply stops here: what it had running (a background command,
                        // for example) still finishes in it, but the rest goes to the new one.
                        {
                          ...m,
                          isStreaming: false,
                          activity: undefined,
                          detail: undefined,
                          deliveredFor: undefined,
                          ...(m.text === runningText() || m.text === queuedText() ? { text: "" } : {}),
                        }
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
            ? res.output || t("session.stoppedByUser")
            : followUps.length
              ? res?.output || ""
              : res?.ok
                ? res.output || t("session.done")
                : `${t("session.errorPrefix")} ${res?.error || t("session.runFailed")}${res?.output ? "\n\n" + res.output : ""}`,
        ),
        res?.events,
        !!res?.ok,
      );
      // Replies to messages delivered mid-run: they close with their own text, and those
      // without text leave the screen.
      if (followUps.length) {
        const empty = new Set(
          followUps
            .filter((f) => !f.text.trim() && !f.events?.length)
            .map((f) => f.responseMessageId),
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
                          ...(done.events?.length ? { events: done.events } : {}),
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
                  lastMessageAt: Date.now(),
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
      // AGY has no configurable limit of its own: at the end of the reply (cache still warm), if the
      // context went over the limit and nothing else is queued, the app sends /compact.
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
      finishReply(`${t("session.errorPrefix")} ${(error as Error).message}`);
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
