import { ChatActivity } from "./components/ChatActivity";
import { createPortal } from "react-dom";
import { LiveShell } from "./components/LiveShell";
import { conversationTitle } from "./conversationTitle";
import { modelSelection } from "./modelSelection";
import { quotaForGeminiModels } from "./agyQuota";
import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { BeagleLogo } from "./components/BeagleLogo";
import { CompanyIcon } from "./components/CompanyIcon";
import {
  Terminal,
  BrainCircuit,
  Settings as SettingsIcon,
  Send,
  Square,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Layers,
  Blocks,
  CheckCircle2,
  Paperclip,
  X,
  Maximize2,
  ArrowRightLeft,
  Bot,
  Zap,
  Gauge,
  Compass,
  Bell,
  Sparkle,
  FolderGit2,
  FolderOpen,
  Server,
  Move,
  History,
  Wand2,
  Search,
  Copy,
  Clock,
  FileText,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  AIProviderStatus,
  AIMemoryStatus,
  ChatSession,
  ChatMessage,
  AppSettings,
  AIProviderId,
  ChatAttachment,
  ReasoningEffortLevel,
  PermissionLevel,
  AppNotification,
  WorkspaceItem,
  SkillItem,
  HistorySessionItem,
  UserProfile,
  AIMemoryWikiPage,
  AIMemoryProjectSummary,
} from "./types";

// Helper para remover códigos ANSI de cores do terminal para leitura limpa
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

export function App() {
  const [activeTab, setActiveTab] = useState<
    "chat" | "memory" | "terminal" | "settings"
  >("chat");
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [expandedProviders, setExpandedProviders] = useState<
    Record<string, boolean>
  >({
    claude: true,
    codex: true,
    antigravity: true,
  });

  const [showInlineTerminal, setShowInlineTerminal] = useState<boolean>(true);

  // Painel flutuante de alta performance via Hardware Acceleration
  const [floatPos, setFloatPos] = useState<{ x: number; y: number }>({
    x: 40,
    y: 24,
  });
  const [floatSize, setFloatSize] = useState<{ width: number; height: number }>(
    { width: 640, height: 340 },
  );
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const floatBoxRef = useRef<HTMLDivElement>(null);
  const ptyScrollRef = useRef<HTMLDivElement>(null);
  const fullPtyScrollRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    initialX: number;
    initialY: number;
  }>({ mouseX: 0, mouseY: 0, initialX: 0, initialY: 0 });
  const resizeStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    initialW: number;
    initialH: number;
  }>({ mouseX: 0, mouseY: 0, initialW: 0, initialH: 0 });

  const [showNotifications, setShowNotifications] = useState<boolean>(false);
  const notificationsButtonRef = useRef<HTMLButtonElement>(null);
  const [notificationsPosition, setNotificationsPosition] = useState({
    left: 12,
    top: 80,
    maxHeight: 480,
  });
  useLayoutEffect(() => {
    if (!showNotifications) return;
    const place = () => {
      const anchor = notificationsButtonRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(320, window.innerWidth - 24);
      const top = Math.max(
        12,
        Math.min(anchor.bottom + 8, window.innerHeight - 160),
      );
      setNotificationsPosition({
        left: Math.max(
          12,
          Math.min(anchor.right - width, window.innerWidth - width - 12),
        ),
        top,
        maxHeight: window.innerHeight - top - 12,
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [showNotifications]);
  const [showWorkspaceModal, setShowWorkspaceModal] = useState<boolean>(false);
  const [showSkillsModal, setShowSkillsModal] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [skillsSearch, setSkillsSearch] = useState<string>("");
  const [historySearch, setHistorySearch] = useState<string>("");
  const [executingSessions, setExecutingSessions] = useState<
    Record<string, number>
  >({});
  const isExecutingPrompt = (executingSessions[activeSessionId] || 0) > 0;
  const hasRunningPrompts = Object.values(executingSessions).some(
    (count) => count > 0,
  );

  // Estados reais do ai-memory Explorer
  const [memorySearchQuery, setMemorySearchQuery] = useState<string>("");
  const [memoryWikiPages, setMemoryWikiPages] = useState<AIMemoryWikiPage[]>(
    [],
  );
  const [memoryProjects, setMemoryProjects] = useState<
    AIMemoryProjectSummary[]
  >([]);
  const [memoryHandoffsText, setMemoryHandoffsText] = useState<string>("");
  const [selectedWikiPage, setSelectedWikiPage] = useState<{
    title: string;
    path: string;
    body: string;
    workspace?: string;
    project?: string;
  } | null>(null);
  const [isLoadingMemory, setIsLoadingMemory] = useState<boolean>(false);
  const [settingsSavedBanner, setSettingsSavedBanner] =
    useState<boolean>(false);

  const [installedSkills, setInstalledSkills] = useState<SkillItem[]>([]);
  const [cliHistory, setCliHistory] = useState<HistorySessionItem[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>({
    fullName: "Usuário",
    firstName: "Você",
    email: "",
    initials: "U",
  });
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspacePath, setNewWorkspacePath] = useState("");
  const [inputMessage, setInputMessage] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingTurns = useRef(new Map<string, number>());
  const runGenerations = useRef(new Map<string, number>());
  const [stoppingSessions, setStoppingSessions] = useState<
    Record<string, boolean>
  >({});
  const [cliApprovals, setCliApprovals] = useState<any[]>([]);
  const [appError, setAppError] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [globalPolicies, setGlobalPolicies] = useState<any[]>([]);
  const [policyDrafts, setPolicyDrafts] = useState<
    Record<string, Record<string, string>>
  >({});
  const [cliFeedback, setCliFeedback] = useState<Record<string, string>>({});
  const [cliUpdating, setCliUpdating] = useState<string>("");
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<any>({});
  const [providers, setProviders] = useState<AIProviderStatus[]>([
    {
      id: "claude",
      name: "Claude Code",
      type: "cli",
      role: "Desenvolvimento",
      iconBg: "#7c3aed",
      badgeColor: "bg-purple-600",
      installed: false,
      quota: { window5hPercent: null, weeklyPercent: null },
      supportedModels: [],
      mcps: [],
      sessions: [],
    },
    {
      id: "codex",
      name: "Codex CLI",
      type: "cli",
      role: "Desenvolvimento",
      iconBg: "#059669",
      badgeColor: "bg-emerald-600",
      installed: false,
      quota: { window5hPercent: null, weeklyPercent: null },
      supportedModels: [],
      mcps: [],
      sessions: [],
    },
    {
      id: "antigravity",
      name: "Antigravity",
      type: "cli",
      role: "Desenvolvimento",
      iconBg: "#db2777",
      badgeColor: "bg-pink-600",
      installed: false,
      quota: { window5hPercent: null, weeklyPercent: null },
      supportedModels: [],
      mcps: [],
      sessions: [],
    },
  ]);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [memoryStatus, setAIMemoryStatus] = useState<AIMemoryStatus>({
    installed: false,
    serverRunning: false,
    activeDaemonId: "",
    availableDaemons: [],
  });

  const [settings, setSettings] = useState<AppSettings>({
    defaultProvider: "claude",
    theme: "cream",
    workspaces: [],
  });

  const allSessions = providers.flatMap((p) => p.sessions);
  const currentSession =
    allSessions.find((s) => s.id === activeSessionId) || allSessions[0];
  const currentProvider = providers.find(
    (p) => p.id === currentSession?.providerId,
  );
  const providerQuota = (provider: AIProviderStatus) =>
    provider.id === "antigravity"
      ? quotaForGeminiModels(provider.quota)
      : provider.quota;
  const currentQuota = currentProvider
    ? providerQuota(currentProvider)
    : undefined;
  const currentMessages = messages[currentSession?.id || ""] || [];
  const currentModelSelection = modelSelection(
    currentProvider?.modelOptions || [],
    currentSession?.currentModel || "",
    currentSession?.reasoningEffort || "",
  );
  useLayoutEffect(() => {
    if (activeTab !== "chat") return;
    const scroller = chatScrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [currentMessages, activeSessionId, activeTab]);

  // Função para sincronizar status e páginas reais do ai-memory
  const refreshAIMemoryExplorer = async () => {
    const api = (window as any).capyAPI;
    if (!api?.getAIMemoryStatus) return;
    setIsLoadingMemory(true);
    try {
      const res = await api.getAIMemoryStatus();
      if (res && res.running && res.data) {
        setAIMemoryStatus((prev) => ({
          ...prev,
          installed: true,
          serverRunning: true,
          cliPath: res.cliPath,
          version: res.data.version,
          serverUrl: res.data.server_url || res.data.serverUrl || undefined,
          totalPages: res.data.counts?.pages_latest ?? prev.totalPages,
          recentObservationsCount:
            res.data.counts?.observations ?? prev.recentObservationsCount,
        }));
        if (Array.isArray(res.recentPages)) {
          setMemoryWikiPages(res.recentPages);
        }
        if (Array.isArray(res.projects)) {
          setMemoryProjects(res.projects);
        }
        if (res.handoffsRaw !== undefined) {
          setMemoryHandoffsText(res.handoffsRaw);
        }
      } else {
        setAIMemoryStatus((prev) => ({ ...prev, serverRunning: false }));
        setMemoryWikiPages([]);
      }
    } catch {
      setAIMemoryStatus((prev) => ({ ...prev, serverRunning: false }));
    }
    setIsLoadingMemory(false);
  };

  // Inicialização Completa via Electron IPC (SQLite + OS Identity + Tools + Quotas + PTY Listener)
  useEffect(() => {
    const api = (window as any).capyAPI;
    if (!api) {
      setAppError(
        "Backend indisponível. Abra o aplicativo desktop ou ative o modo de navegador local conforme o README.",
      );
      return;
    }

    // 1. Perfil do Sistema Operacional
    if (api.getUserProfile) {
      api
        .getUserProfile()
        .then((profile: UserProfile) => {
          if (profile && profile.fullName) {
            setUserProfile(profile);
          }
        })
        .catch(() => {});
    }

    // 2. Estado salvo no SQLite (Sessões, Mensagens, Workspaces, Settings)
    if (api.getSavedState) {
      api
        .getSavedState()
        .then((saved: any) => {
          if (saved.workspaces && saved.workspaces.length > 0) {
            setWorkspaces(saved.workspaces);
          }
          if (saved.settings) {
            setSettings((prev) => ({ ...prev, ...saved.settings }));
          }
          if (saved.error) setAppError(saved.error);
          if (saved.settings?.securityWarning)
            setAppError(saved.settings.securityWarning);
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
                void api
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
        })
        .catch((error: Error) => setAppError(error.message));
    }

    // 3. Ferramentas instaladas, Modelos, MCPs e Cotas Reais (inicial + push em tempo real)
    const applyToolsUpdate = (res: any) => {
      if (!res) return;
      const { tools, quotas } = res;
      if (res.updates) {
        setNotifications(res.updates.notifications || []);
        setUpdateInfo(res.updates);
      }
      setProviders((prev) =>
        prev.map((p) => {
          const toolInfo = tools?.[p.id];
          const quotaInfo = quotas?.[p.id];
          return {
            ...p,
            installed: !!toolInfo?.installed,
            cliPath: toolInfo?.path || undefined,
            cliVersion: toolInfo?.version || undefined,
            modelOptions: Array.isArray(toolInfo?.modelOptions)
              ? toolInfo.modelOptions
              : [],
            supportedModels: Array.isArray(toolInfo?.models)
              ? toolInfo.models
              : [],
            activeModel: toolInfo?.activeModel || "",
            modelsSource: toolInfo?.modelsSource,
            modelsUpdatedAt: toolInfo?.modelsUpdatedAt,
            modelsError: toolInfo?.modelsError,
            mcps: Array.isArray(toolInfo?.mcps) ? toolInfo.mcps : [],
            quota: quotaInfo || p.quota,
          };
        }),
      );
    };
    let unsubscribeTools: (() => void) | undefined;
    if (api.detectTools) {
      api
        .detectTools()
        .then(applyToolsUpdate)
        .catch((error: Error) => setAppError(error.message));
    }
    if (api.on) {
      unsubscribeTools = api.on("tools-update", applyToolsUpdate);
    }

    api
      .getGlobalPermissions?.()
      .then(setGlobalPolicies)
      .catch((e: Error) => setAppError(e.message));
    // 4. Skills e Histórico de Sessões
    if (api.getInstalledSkills) {
      api
        .getInstalledSkills()
        .then((skills: SkillItem[]) => {
          setInstalledSkills(skills || []);
        })
        .catch(() => {});
    }
    if (api.getCliHistory) {
      api
        .getCliHistory()
        .then((history: HistorySessionItem[]) => {
          setCliHistory(history || []);
        })
        .catch(() => {});
    }

    // 5. Status real do ai-memory
    refreshAIMemoryExplorer();

    // 6. Listener de streaming do PTY e execução de CLIs
    let unsubscribePty: (() => void) | undefined;
    let unsubscribeStream: (() => void) | undefined;
    let unsubscribeApprovals: (() => void) | undefined;
    api
      .getCliApprovals?.()
      .then(setCliApprovals)
      .catch(() => {});

    if (api.on) {
      unsubscribeApprovals = api.on("cli-approvals", setCliApprovals);
      unsubscribePty = api.on(
        "pty-data",
        (payload: { sessionId: string; data: string; pid?: number }) => {
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
        },
      );

      unsubscribeStream = api.on(
        "cli-stream-chunk",
        (payload: {
          sessionId: string;
          responseMessageId?: string;
          chunk: string;
          fullText?: string;
          activity?: string;
        }) => {
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
        },
      );
    }

    const historyTimer = window.setInterval(() => {
      api
        .getCliHistory?.()
        .then((items: HistorySessionItem[]) => setCliHistory(items || []))
        .catch(() => {});
      api
        .getInstalledSkills?.()
        .then((items: SkillItem[]) => setInstalledSkills(items || []))
        .catch(() => {});
    }, 30000);
    return () => {
      clearInterval(historyTimer);
      if (unsubscribePty) unsubscribePty();
      if (unsubscribeTools) unsubscribeTools();
      if (unsubscribeStream) unsubscribeStream();
      unsubscribeApprovals?.();
    };
  }, []);

  // Auto-scroll nos terminais quando novos logs entram
  useEffect(() => {
    if (ptyScrollRef.current) {
      ptyScrollRef.current.scrollTop = ptyScrollRef.current.scrollHeight;
    }
    if (fullPtyScrollRef.current) {
      fullPtyScrollRef.current.scrollTop =
        fullPtyScrollRef.current.scrollHeight;
    }
  }, [currentSession?.ptyLog?.length]);

  // Atalho global de teclado: Ctrl+K para Skills, Ctrl+H para Histórico
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowSkillsModal((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setShowHistoryModal((prev) => !prev);
      } else if (e.key === "Escape") {
        setShowSkillsModal(false);
        setShowHistoryModal(false);
        setShowWorkspaceModal(false);
        setSelectedWikiPage(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Busca semântica real no ai-memory
  const handleSearchAIMemory = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const api = (window as any).capyAPI;
    if (!api) return;

    setIsLoadingMemory(true);
    try {
      if (!memorySearchQuery.trim()) {
        await refreshAIMemoryExplorer();
      } else if (api.searchAIMemory) {
        const res = await api.searchAIMemory(memorySearchQuery.trim(), true);
        if (res && res.ok && Array.isArray(res.data)) {
          setMemoryWikiPages(res.data);
        }
      }
    } catch (err) {}
    setIsLoadingMemory(false);
  };

  // Ler página completa da wiki do ai-memory
  const handleReadWikiPage = async (page: AIMemoryWikiPage) => {
    const api = (window as any).capyAPI;
    if (!api?.readAIMemoryPage) return;

    setIsLoadingMemory(true);
    try {
      const res = await api.readAIMemoryPage(
        page.path,
        page.workspace,
        page.project,
      );
      if (res && res.ok && res.data) {
        setSelectedWikiPage({
          title: res.data.title || page.title,
          path: page.path,
          body: res.data.body || page.snippet || "Sem conteúdo.",
          workspace: page.workspace,
          project: page.project,
        });
      } else if (res && res.rawText) {
        setSelectedWikiPage({
          title: page.title,
          path: page.path,
          body: res.rawText,
          workspace: page.workspace,
          project: page.project,
        });
      }
    } catch (e) {}
    setIsLoadingMemory(false);
  };

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
    const api = (window as any).capyAPI;

    if (api?.loadFullConversation) {
      try {
        const conversation = await api.loadFullConversation(
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

          const saved = await api.saveSession(newSessionObj);
          if (!saved?.success)
            throw new Error(saved?.error || "Falha ao salvar sessão.");
          const imported = fullMsgs.map((msg) => ({
            ...msg,
            sessionId: newSessionId,
          }));
          const importedResult = await api.replaceChatMessages(
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

  // Arrastar (Drag) de 60/120 FPS via requestAnimationFrame e DOM direto com hardware transform
  const handleStartDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialX: floatPos.x,
      initialY: floatPos.y,
    };

    let latestX = floatPos.x;
    let latestY = floatPos.y;
    let ticking = false;

    const containerRect = chatAreaRef.current?.getBoundingClientRect();
    const maxW = containerRect
      ? containerRect.width - floatSize.width - 20
      : window.innerWidth - floatSize.width - 40;
    const maxH = containerRect
      ? containerRect.height - floatSize.height - 20
      : window.innerHeight - floatSize.height - 40;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - dragStartRef.current.mouseX;
      const deltaY = moveEvent.clientY - dragStartRef.current.mouseY;

      latestX = Math.max(
        10,
        Math.min(Math.max(10, maxW), dragStartRef.current.initialX + deltaX),
      );
      latestY = Math.max(
        10,
        Math.min(Math.max(10, maxH), dragStartRef.current.initialY + deltaY),
      );

      if (!ticking) {
        window.requestAnimationFrame(() => {
          if (floatBoxRef.current) {
            floatBoxRef.current.style.transform = `translate3d(${latestX}px, ${latestY}px, 0)`;
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    const onMouseUp = () => {
      setFloatPos({ x: latestX, y: latestY });
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp, { once: true });
  };

  // Redimensionar (Resize) de alta performance
  const handleStartResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    resizeStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialW: floatSize.width,
      initialH: floatSize.height,
    };

    let latestW = floatSize.width;
    let latestH = floatSize.height;
    let ticking = false;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaW = moveEvent.clientX - resizeStartRef.current.mouseX;
      const deltaH = moveEvent.clientY - resizeStartRef.current.mouseY;

      latestW = Math.max(
        380,
        Math.min(1800, resizeStartRef.current.initialW + deltaW),
      );
      latestH = Math.max(
        180,
        Math.min(1000, resizeStartRef.current.initialH + deltaH),
      );

      if (!ticking) {
        window.requestAnimationFrame(() => {
          if (floatBoxRef.current) {
            floatBoxRef.current.style.width = `${latestW}px`;
            floatBoxRef.current.style.height = `${latestH}px`;
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    const onMouseUp = () => {
      setFloatSize({ width: latestW, height: latestH });
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp, { once: true });
  };

  const toggleExpand = (providerId: string) => {
    setExpandedProviders((prev) => ({
      ...prev,
      [providerId]: !prev[providerId],
    }));
  };

  const persistSession = async (session: ChatSession) => {
    try {
      const api = (window as any).capyAPI;
      if (!api?.saveSession) throw new Error("Backend indisponível.");
      const result = await api.saveSession(session);
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

  const handleAddWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspacePath.trim()) return;

    const name =
      newWorkspaceName.trim() ||
      newWorkspacePath.split(/[\\/]/).filter(Boolean).pop() ||
      "Workspace";
    let newWs: WorkspaceItem = {
      id: `ws-${Date.now()}`,
      name,
      path: newWorkspacePath.trim(),
      hasAIMemory: false,
      aiMemoryDaemonActive: false,
    };

    const api = (window as any).capyAPI;
    if (api?.saveWorkspace) {
      try {
        const saved = await api.saveWorkspace(newWs);
        if (saved?.success === false) throw new Error(saved.error);
        newWs = saved;
      } catch (err) {
        setAppError((err as Error).message);
        return;
      }
    }

    setWorkspaces((prev) => [
      ...prev.filter((w) => w.path !== newWs.path),
      newWs,
    ]);
    if (currentSession) {
      handleWorkspaceChange(newWs.path);
    }
    setNewWorkspaceName("");
    setNewWorkspacePath("");
    setShowWorkspaceModal(false);
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

  const permissionStyle = (level: PermissionLevel) => {
    switch (level) {
      case "inherit":
        return "bg-[#ede9de] border-[#dfdacd] text-[#2c2822]";
      case "plan":
        return "bg-sky-100/70 border-sky-200 text-sky-800";
      case "ask":
        return "bg-[#ede9de] border-[#dfdacd] text-[#2c2822]";
      case "edits":
        return "bg-amber-100/70 border-amber-200 text-amber-800";
      case "full":
        return "bg-rose-100/80 border-rose-300 text-rose-700";
    }
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
    const api = (window as any).capyAPI;

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
    if (api?.runAIMemoryCommand) {
      try {
        const res = await api.runAIMemoryCommand(
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

    if (api?.saveChatMessage) {
      api
        .saveChatMessage({ ...handoffMsg, provider: currentSession.providerId })
        .catch(() => {});
      api
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
    const provider = providers.find((p) => p.id === providerId);
    if (!provider?.installed) {
      setAppError("Instale e autentique a CLI antes de criar uma conversa.");
      return;
    }
    const newId = `session-${providerId}-${crypto.randomUUID()}`;
    const defaultCwd =
      workspaces.find((ws) => ws.path === currentSession?.cwd)?.path ||
      workspaces[0]?.path;
    if (!defaultCwd) {
      setShowWorkspaceModal(true);
      return;
    }

    const initialSelection = modelSelection(
      provider.modelOptions || [],
      provider.activeModel || "",
      "",
    );
    const newSession: ChatSession = {
      id: newId,
      providerId,
      permission: "inherit",
      title: `Nova sessão #${(provider?.sessions.length || 0) + 1}`,
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

    const api = (window as any).capyAPI;
    try {
      const saved = await api.saveSession(newSession);
      if (!saved?.success)
        throw new Error(saved?.error || "Não foi possível salvar a sessão.");
    } catch (error) {
      setAppError((error as Error).message);
      return;
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

    if (api?.saveChatMessage)
      api.saveChatMessage({ ...initMsg, provider: providerId }).catch(() => {});

    setActiveSessionId(newId);
    setActiveTab("chat");
  };

  const handleDeleteSession = async (
    sessionId: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    try {
      const api = (window as any).capyAPI;
      if (!api?.deleteSession) throw new Error("Backend indisponível.");
      const result = await api.deleteSession(sessionId);
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

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (loadEvent) => {
            const dataUrl = loadEvent.target?.result as string;
            setAttachments((prev) => [
              ...prev,
              {
                id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                name:
                  file.name ||
                  `print-${new Date().toISOString().slice(11, 19)}.png`,
                type: "image",
                url: dataUrl,
                sizeText: `${Math.round(file.size / 1024)} KB`,
              },
            ]);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isImg = file.type.startsWith("image/");
      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        setAttachments((prev) => [
          ...prev,
          {
            id: `att-${Date.now()}-${i}`,
            name: file.name,
            type: isImg ? "image" : "file",
            url: loadEvent.target?.result as string,
            sizeText: `${Math.round(file.size / 1024)} KB`,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (attId: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== attId));
  };

  const handleStopSession = async (id: string) => {
    if (stoppingSessions[id]) return;
    runGenerations.current.set(id, (runGenerations.current.get(id) || 0) + 1);
    setStoppingSessions((prev) => ({ ...prev, [id]: true }));
    try {
      const result = await (window as any).capyAPI.interruptCliSession(id);
      if (!result?.ok)
        throw new Error(result?.error || "Não foi possível parar a execução.");
    } catch (error) {
      setAppError((error as Error).message);
    } finally {
      setStoppingSessions((prev) => ({ ...prev, [id]: false }));
    }
  };

  // Envia mensagem no Chat, persiste no SQLite e dispara o processo real da CLI!
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || !currentSession) return;
    if (attachments.length) {
      setAppError(
        "Envio de anexos ainda não é suportado neste chat. Informe o caminho do arquivo no projeto.",
      );
      return;
    }
    const promptText = inputMessage.trim();
    if (
      (pendingTurns.current.get(currentSession.id) || 0) > 0 &&
      /^(?:\/?(?:para|pare|parar|cancela|cancelar|cancele|cancel|stop|interromper))(?:\s+por favor)?[.!?]*$/i.test(
        promptText,
      )
    ) {
      setInputMessage("");
      await handleStopSession(currentSession.id);
      return;
    }
    if (promptText === "/handoff") {
      setInputMessage("");
      await handleTriggerHandoff();
      return;
    }
    const selected = modelSelection(
      currentProvider?.modelOptions || [],
      currentSession.currentModel,
      currentSession.reasoningEffort,
    );
    const sendingSession = {
      ...currentSession,
      currentModel: selected.model,
      reasoningEffort: selected.effort,
      title: conversationTitle(currentSession.title, promptText),
      status: "running" as const,
    };
    const id = sendingSession.id;
    const generation = runGenerations.current.get(id) || 0;
    const wasPending = (pendingTurns.current.get(id) || 0) > 0;
    pendingTurns.current.set(id, (pendingTurns.current.get(id) || 0) + 1);
    setExecutingSessions(Object.fromEntries(pendingTurns.current));
    setInputMessage("");
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
      senderName: currentProvider?.name || "IA",
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
      const api = (window as any).capyAPI;
      if (!api?.executeCliPrompt) throw new Error("Backend indisponível.");
      const saved = await api.saveChatMessage({
        ...userMsg,
        provider: sendingSession.providerId,
      });
      if (!saved?.success)
        throw new Error(saved?.error || "Não foi possível salvar a mensagem.");
      const res = await api.executeCliPrompt({
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

  const handleSaveSettings = async () => {
    try {
      const api = (window as any).capyAPI;
      if (!api?.saveAppSettings) throw new Error("Backend indisponível.");
      const result = await api.saveAppSettings(settings);
      if (!result?.success)
        throw new Error(result?.error || "Falha ao salvar configurações.");
      setSettings(result.settings);
      setAppError("");
      setSettingsSavedBanner(true);
      setTimeout(() => setSettingsSavedBanner(false), 3000);
    } catch (error) {
      setAppError((error as Error).message);
    }
  };
  const formatQuota = (value: number | null) =>
    value === null ? "N/D" : `${Math.round(value)}%`;

  const getQuotaColor = (percent: number | null) => {
    if (percent === null) return "text-zinc-500 bg-zinc-50 border-zinc-200";
    if (percent >= 80) return "text-rose-600 bg-rose-50 border-rose-200";
    if (percent >= 50) return "text-amber-600 bg-amber-50 border-amber-200";
    return "text-emerald-700 bg-emerald-50 border-emerald-200";
  };

  const getReasoningBadgeClass = (effort: ReasoningEffortLevel) => {
    switch (effort) {
      case "low":
        return "text-sky-700 bg-sky-100/70 border-sky-200";
      case "medium":
        return "text-amber-700 bg-amber-100/70 border-amber-200";
      case "high":
        return "text-purple-700 bg-purple-100/70 border-purple-200";
      case "plan":
        return "text-emerald-700 bg-emerald-100/70 border-emerald-200";
    }
  };

  return (
    <div className="flex h-screen w-screen bg-[#f7f5ef] text-[#1c1b18] overflow-hidden">
      {/* SIDEBAR ESQUERDA */}
      <aside className="w-80 min-w-[320px] max-w-[320px] shrink-0 bg-[#ede9de]/85 border-r border-[#dfdacd] flex flex-col justify-between select-none relative z-30">
        <div className="flex flex-col h-full overflow-hidden">
          {/* Header com Logo */}
          <div className="p-4 border-b border-[#dfdacd]/70 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BeagleLogo size={36} className="shadow-xs rounded-xl" />
              <div>
                <div className="font-extrabold text-lg tracking-tight flex items-center gap-1.5 leading-none">
                  BeagleDock
                  <span className="text-[9px] bg-[#d7d0bc] text-[#4d4738] font-black px-1.5 py-0.5 rounded uppercase">
                    Cockpit
                  </span>
                </div>
                <div className="text-[11px] text-[#7d7565] mt-1">
                  Multi-CLI for Developers
                </div>
              </div>
            </div>

            {/* SINO DE NOVIDADES */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowNotifications((prev) => !prev);
                  if (!showNotifications)
                    void (window as any).capyAPI
                      ?.readNotifications?.()
                      .then((r: any) => setNotifications(r.notifications || []))
                      .catch((e: Error) => setAppError(e.message));
                }}
                className={`p-2 rounded-xl transition relative ${
                  showNotifications
                    ? "bg-[#dfdacd] text-[#1c1b18]"
                    : "text-[#6d6657] hover:bg-[#e4dec9] hover:text-[#1c1b18]"
                }`}
                ref={notificationsButtonRef}
                aria-expanded={showNotifications}
                aria-controls="ecosystem-notifications"
                title="Novidades de CLIs, novos modelos e ai-memory"
              >
                <Bell size={17} />
                {notifications.some((n) => n.isNew) && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-[#ede9de] animate-pulse" />
                )}
              </button>

              {showNotifications &&
                createPortal(
                  <div
                    id="ecosystem-notifications"
                    role="dialog"
                    aria-label="Novidades do ecossistema"
                    style={notificationsPosition}
                    className="fixed w-80 max-w-[calc(100vw-24px)] bg-[#ffffff] border border-[#d8d2c3] rounded-2xl shadow-2xl z-50 p-3 flex flex-col gap-2.5 overflow-hidden [overflow-wrap:anywhere]"
                  >
                    <div className="flex items-center justify-between pb-2 border-b border-[#eeeae0] px-1">
                      <div className="font-bold text-xs text-[#1c1b18] flex items-center gap-1.5">
                        <Sparkle size={13} className="text-amber-600" />
                        <span>Status do Ecossistema</span>
                      </div>
                      <span className="text-[10px] font-mono bg-[#f4f1e8] text-[#7d7565] px-1.5 py-0.5 rounded">
                        {notifications.filter((n) => n.isNew).length} ativos
                      </span>
                    </div>

                    <div className="space-y-2 max-h-80 min-h-0 overflow-y-auto pr-1">
                      <button
                        className="text-xs underline disabled:opacity-50"
                        disabled={checkingUpdates}
                        onClick={async () => {
                          setCheckingUpdates(true);
                          try {
                            const r = await (
                              window as any
                            ).capyAPI.checkCliUpdates();
                            setNotifications(r.updates?.notifications || []);
                            setUpdateInfo(r.updates || {});
                          } catch (e) {
                            setAppError((e as Error).message);
                          } finally {
                            setCheckingUpdates(false);
                          }
                        }}
                      >
                        {checkingUpdates
                          ? "Verificando…"
                          : "Verificar novas versões"}
                      </button>
                      {!notifications.length && (
                        <p className="text-xs text-[#7d7565]">
                          Nenhuma novidade detectada. Novos modelos são
                          identificados ao sincronizar os catálogos das CLIs.
                        </p>
                      )}
                      {updateInfo.checkedAt && (
                        <p className="text-[10px] text-[#7d7565]">
                          Última consulta:{" "}
                          {new Date(updateInfo.checkedAt).toLocaleString()}
                        </p>
                      )}
                      {Object.entries(updateInfo.releases || {})
                        .filter(([, r]: any) => r.error)
                        .map(([id]) => (
                          <p key={id} className="text-[10px] text-amber-800">
                            {id}: consulta de versões indisponível.
                          </p>
                        ))}
                      {notifications.map((notif) => (
                        <div
                          key={notif.id}
                          className="p-2.5 rounded-xl bg-[#faf8f4] hover:bg-[#f3efe4] border border-[#ede7d8] transition text-left"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span
                              className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                notif.category === "ai_memory"
                                  ? "bg-purple-100 text-purple-800"
                                  : notif.category === "new_model"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-blue-100 text-blue-800"
                              }`}
                            >
                              {notif.category === "ai_memory"
                                ? "ai-memory"
                                : notif.category === "new_model"
                                  ? "Novo modelo"
                                  : "CLI Status"}
                            </span>
                            <span className="text-[10px] text-[#938b7a]">
                              {notif.date}
                            </span>
                          </div>

                          <div className="font-bold text-xs text-[#221f1a]">
                            {notif.title}
                          </div>
                          {notif.models?.length ? (
                            <ul className="text-[11px] text-[#6d6657] mt-1 space-y-1">
                              {notif.models.map((model) => (
                                <li key={model.id}>
                                  <span className="font-semibold">
                                    {model.label}
                                  </span>
                                  <span className="block text-[10px] font-mono break-all">
                                    {model.id}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-[11px] text-[#6d6657] mt-0.5 leading-snug">
                              {notif.description}
                            </p>
                          )}

                          {notif.actionCommand && (
                            <div className="mt-2 pt-1.5 border-t border-[#e8e2d2] flex items-center justify-between">
                              <span className="font-mono text-[9px] text-[#7d7565] truncate max-w-[180px]">
                                $ {notif.actionCommand}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(
                                    notif.actionCommand!,
                                  );
                                }}
                                className="text-[10px] font-bold text-indigo-700 hover:text-indigo-900"
                              >
                                Copiar
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="pt-1 text-center border-t border-[#eeeae0]">
                      <button
                        onClick={() => setShowNotifications(false)}
                        className="text-[11px] font-semibold text-[#8c8270] hover:text-[#1c1b18]"
                      >
                        Fechar
                      </button>
                    </div>
                  </div>,
                  document.body,
                )}
            </div>
          </div>

          {/* Atalhos Topo */}
          <div className="px-3 pt-3 pb-2 space-y-1">
            <button
              onClick={() => {
                setActiveTab("memory");
                refreshAIMemoryExplorer();
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition ${
                activeTab === "memory"
                  ? "bg-[#dfdacd] text-[#181715] shadow-xs"
                  : "text-[#5d5648] hover:bg-[#e4dec9]"
              }`}
            >
              <div className="flex items-center gap-2">
                <BrainCircuit size={16} className="text-[#847b6a]" />
                <span>ai-memory v{memoryStatus.version}</span>
              </div>
              <span className="flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full font-bold">
                {memoryStatus.totalPages} docs
              </span>
            </button>

            <button
              onClick={() => setActiveTab("terminal")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition ${
                activeTab === "terminal"
                  ? "bg-[#dfdacd] text-[#181715] shadow-xs"
                  : "text-[#5d5648] hover:bg-[#e4dec9]"
              }`}
            >
              <div className="flex items-center gap-2">
                <Terminal size={16} className="text-[#847b6a]" />
                <span>Shells PTY Ativos</span>
              </div>
              <span className="font-mono text-[10px] bg-[#dfdacd] px-1.5 py-0.5 rounded text-[#5d5648]">
                {providers.reduce(
                  (acc, p) =>
                    acc +
                    p.sessions.filter((s) => s.status === "running").length,
                  0,
                )}{" "}
                running
              </span>
            </button>

            {/* ATALHO: SKILLS SALVAS (Ctrl+K) */}
            <button
              onClick={() => setShowSkillsModal(true)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-[#5d5648] hover:bg-[#e4dec9] transition"
              title="Atalho: Ctrl+K"
            >
              <div className="flex items-center gap-2">
                <Wand2 size={16} className="text-[#847b6a]" />
                <span>Skills & Revisor ({installedSkills.length})</span>
              </div>
              <span className="font-mono text-[10px] bg-[#dfdacd]/70 text-[#686050] px-1.5 py-0.5 rounded flex items-center gap-1">
                <kbd className="font-sans text-[9px]">Ctrl+K</kbd>
              </span>
            </button>

            {/* ATALHO: HISTÓRICO DE CONVERSAS (Ctrl+H) */}
            <button
              onClick={() => setShowHistoryModal(true)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-[#5d5648] hover:bg-[#e4dec9] transition"
              title="Atalho: Ctrl+H"
            >
              <div className="flex items-center gap-2">
                <History size={16} className="text-[#847b6a]" />
                <span>Histórico de Conversas</span>
              </div>
              <span className="font-mono text-[10px] bg-[#dfdacd]/70 text-[#686050] px-1.5 py-0.5 rounded flex items-center gap-1">
                <kbd className="font-sans text-[9px]">Ctrl+H</kbd>
              </span>
            </button>
          </div>

          {/* SEÇÃO MODELOS E COTAS REAIS */}
          <div className="px-4 py-2 flex items-center justify-between text-[11px] font-bold text-[#8c8270] uppercase tracking-wider">
            <span>CLIs & Cotas Reais</span>
            <span className="text-[10px] text-[#9c9381] font-normal">
              Uso: 5h | Sem
            </span>
          </div>

          {/* ÁRVORE DINÂMICA DE MODELOS */}
          <div className="flex-1 overflow-y-auto px-3 space-y-2.5 pb-4">
            {providers.map((provider) => {
              const quota = providerQuota(provider);
              const isExpanded = expandedProviders[provider.id] ?? true;

              return (
                <div
                  key={provider.id}
                  className="rounded-xl border border-[#dfdacd]/70 bg-[#f7f5ef]/60 overflow-hidden shadow-2xs"
                >
                  <div
                    onClick={() => toggleExpand(provider.id)}
                    className="p-2.5 flex items-center justify-between cursor-pointer hover:bg-[#eae4d5] transition"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[#8c8270]">
                        {isExpanded ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                      </span>

                      <CompanyIcon
                        id={provider.id}
                        size={20}
                        className="shrink-0"
                      />

                      <div className="truncate">
                        <div className="font-bold text-xs text-[#221f1a] truncate">
                          {provider.name}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="flex items-center gap-1">
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border font-bold ${getQuotaColor(quota.window5hPercent)}`}
                          title={`${quota.sourceLabel || "Sem leitura"} · ${quota.updatedAt || "Sem data"}${quota.stale ? " · Desatualizado" : ""}`}
                        >
                          5h: {formatQuota(quota.window5hPercent)}
                        </span>

                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border font-bold ${getQuotaColor(quota.weeklyPercent)}`}
                          title={quota.sourceLabel || "Cota indisponível"}
                        >
                          S: {formatQuota(quota.weeklyPercent)}
                        </span>
                      </div>

                      <button
                        onClick={(e) => handleCreateSession(provider.id, e)}
                        className="p-1 hover:bg-[#d6cfbe] rounded text-[#443e33] transition"
                        disabled={!provider.installed}
                        title={
                          provider.installed
                            ? "Abrir nova conversa"
                            : "CLI não encontrada nesta máquina"
                        }
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>

                  <div
                    className="px-3 pb-2 text-[10px] text-[#7d7565]"
                    title={[quota.groupLabel, quota.sourceLabel]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    {quota.groupLabel && (
                      <span className="block">{quota.groupLabel}</span>
                    )}
                    {!provider.installed
                      ? "CLI não encontrada"
                      : quota.updatedAt
                        ? `${quota.stale ? "Leitura desatualizada" : "Última leitura"}: ${new Date(quota.updatedAt).toLocaleTimeString()}`
                        : "Cota indisponível"}
                  </div>
                  <div
                    className="px-3 pb-2 text-[10px] text-[#7d7565]"
                    title={[quota.groupLabel, quota.sourceLabel]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    {quota.totalTokens == null
                      ? "Tokens indisponíveis"
                      : `Tokens (7d): ${quota.totalTokens.toLocaleString()}`}
                    {provider.id === "antigravity" &&
                    quota.prompts5h !== undefined
                      ? ` · ${quota.prompts5h} prompts (5h)`
                      : ""}
                  </div>
                  {quota.groups && quota.groups.length > 0 && (
                    <div
                      className="px-3 pb-2 space-y-1"
                      aria-label="Cotas por grupo do AGY"
                    >
                      {quota.groups.map((group) => (
                        <div
                          key={group.name}
                          className="text-[10px] flex justify-between gap-1"
                          title={`Reinício 5h: ${group.window5hResetAt || "Não informado"} · Semanal: ${group.weeklyResetAt || "Não informado"}`}
                        >
                          <span className="text-[#7d7565] truncate">
                            {group.name}
                          </span>
                          <span className="font-mono whitespace-nowrap">
                            5h: {formatQuota(group.window5hPercent)} · S:{" "}
                            {formatQuota(group.weeklyPercent)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {quota.quotaError && (
                    <div className="px-3 pb-2 text-[10px] text-amber-800">
                      {quota.quotaError}
                    </div>
                  )}
                  {isExpanded && (
                    <div className="py-1 px-1.5 space-y-0.5 border-t border-[#dfdacd]/40">
                      {provider.sessions.length === 0 ? (
                        <div className="px-3 py-2 text-[11px] text-[#938b7a] italic">
                          Nenhum chat ativo. Clique em + para iniciar.
                        </div>
                      ) : (
                        provider.sessions.map((session) => {
                          const isSelected =
                            activeSessionId === session.id &&
                            activeTab === "chat";
                          return (
                            <div
                              key={session.id}
                              data-session-id={session.id}
                              onClick={() => {
                                setActiveSessionId(session.id);
                                setActiveTab("chat");
                              }}
                              className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer text-xs transition ${
                                isSelected
                                  ? "bg-[#ffffff] font-semibold text-[#181715] shadow-xs"
                                  : "text-[#4e483d] hover:bg-[#eae4d5]"
                              }`}
                            >
                              <div className="flex items-center justify-between w-full">
                                <div className="flex items-center gap-2 truncate min-w-0">
                                  {session.status === "running" ? (
                                    <span
                                      className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0"
                                      title="Processo ativo"
                                    />
                                  ) : session.status === "waiting_input" ? (
                                    <span
                                      className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
                                      title="Aguardando confirmação"
                                    />
                                  ) : (
                                    <span
                                      className="w-1.5 h-1.5 rounded-full bg-[#a39b8b] shrink-0"
                                      title="Histórico / Idle"
                                    />
                                  )}

                                  <span className="truncate text-xs">
                                    {session.title}
                                  </span>
                                </div>

                                <div className="flex items-center gap-1 shrink-0 ml-2">
                                  <span className="text-[10px] font-mono text-[#8c8270] opacity-80">
                                    {session.currentModel
                                      .replace("Claude ", "")
                                      .replace("Gemini ", "")}
                                  </span>
                                  {session.reasoningEffort === "plan" && (
                                    <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1 py-0.2 rounded">
                                      PLAN
                                    </span>
                                  )}
                                  <button
                                    onClick={(e) =>
                                      handleDeleteSession(session.id, e)
                                    }
                                    className="p-0.5 hover:text-rose-600 rounded opacity-0 group-hover:opacity-100 transition ml-1"
                                    title="Encerrar e remover sessão"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Rodapé com Perfil do Usuário Reconhecido Automaticamente pelo OS */}
        <div className="p-3 border-t border-[#dfdacd] flex items-center justify-between bg-[#ede9de]">
          <div className="flex items-center gap-2.5 truncate">
            <div
              className="w-7 h-7 rounded-xl bg-[#262420] text-amber-200 flex items-center justify-center font-bold text-xs ring-1 ring-[#d4cdbd] shrink-0"
              title={`Usuário do Sistema Operacional: ${userProfile.fullName} (${userProfile.email})`}
            >
              {userProfile.initials || "U"}
            </div>
            <div className="truncate">
              <div className="text-xs font-bold text-[#1f1d19] leading-tight truncate">
                {userProfile.fullName}
              </div>
              <div className="text-[10px] text-[#7d7565] font-mono truncate">
                {userProfile.email}
              </div>
            </div>
          </div>

          <button
            onClick={() => setActiveTab("settings")}
            className={`p-2 rounded-xl transition shrink-0 ${
              activeTab === "settings"
                ? "bg-[#dfdacd] text-[#181715]"
                : "text-[#6d6657] hover:bg-[#e4dec9]"
            }`}
            title="Configurações, Banco SQLite & MCPs"
          >
            <SettingsIcon size={16} />
          </button>
        </div>
      </aside>

      {/* PAINEL CENTRAL */}
      <main className="flex-1 flex flex-col bg-[#fcfbfa] overflow-hidden">
        {/* Header Dinâmico por Aba */}
        <header className="h-14 border-b border-[#ece7db] px-6 flex items-center justify-between bg-[#fcfbfa]">
          {activeTab === "chat" && (
            <>
              <div className="flex items-center gap-3">
                {currentProvider && (
                  <CompanyIcon
                    id={currentProvider.id}
                    size={26}
                    className="shrink-0"
                  />
                )}
                <div>
                  <div className="text-sm font-bold text-[#1c1b18] flex items-center gap-2">
                    <span>
                      {currentSession?.title || "Selecione uma sessão"}
                    </span>

                    {currentProvider && currentSession && (
                      <div className="flex items-center gap-1 bg-[#ede9de] rounded-lg px-2 py-0.5 border border-[#dfdacd]">
                        <Bot size={13} className="text-[#7d7565]" />
                        <select
                          value={currentModelSelection.model}
                          aria-label="Modelo"
                          onChange={(e) => handleModelChange(e.target.value)}
                          className="text-xs font-semibold bg-transparent text-[#2c2822] outline-none cursor-pointer"
                          disabled={isExecutingPrompt}
                          title={
                            currentProvider.modelsError ||
                            currentProvider.modelsSource ||
                            "Usa o modelo padrão da CLI"
                          }
                        >
                          <option value="">Padrão da CLI</option>
                          {currentModelSelection.model &&
                            !currentModelSelection.option && (
                              <option
                                value={currentModelSelection.model}
                                disabled
                              >
                                {currentModelSelection.model} (aguardando
                                catálogo)
                              </option>
                            )}
                          {(currentProvider.modelOptions || []).map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {currentSession && (
                      <div className="flex items-center gap-1 bg-[#ede9de] rounded-lg px-2 py-0.5 border border-[#dfdacd]">
                        <Gauge size={13} className="text-[#7d7565]" />
                        <select
                          value={currentModelSelection.effort}
                          aria-label="Nível de raciocínio"
                          onChange={(e) =>
                            handleReasoningChange(
                              e.target.value as ReasoningEffortLevel,
                            )
                          }
                          className="text-xs font-semibold bg-transparent text-[#2c2822] outline-none cursor-pointer"
                          disabled={
                            isExecutingPrompt ||
                            !currentModelSelection.option?.efforts.length
                          }
                          title="Níveis informados pela CLI para o modelo selecionado"
                        >
                          {!currentModelSelection.option?.requiresEffort && (
                            <option value="">Padrão da CLI</option>
                          )}
                          {currentModelSelection.option?.efforts.map(
                            (level) => (
                              <option
                                key={level.id}
                                value={level.id}
                                title={level.description}
                              >
                                {level.label}
                              </option>
                            ),
                          )}
                        </select>
                      </div>
                    )}

                    {currentSession && (
                      <div
                        className={`flex items-center gap-1 rounded-lg px-2 py-0.5 border ${permissionStyle(currentSession.permission || "inherit")}`}
                      >
                        <ShieldCheck size={13} />
                        <select
                          value={currentSession.permission || "inherit"}
                          onChange={(e) =>
                            handlePermissionChange(
                              e.target.value as PermissionLevel,
                            )
                          }
                          className="text-xs font-semibold bg-transparent outline-none cursor-pointer"
                          disabled={isExecutingPrompt}
                          title="Permissões da conversa; solicitações elegíveis aparecem no painel de aprovação"
                        >
                          <option value="inherit">Global da CLI</option>
                          <option value="plan">
                            🔍 Somente leitura (plano)
                          </option>
                          <option value="ask">
                            🔒 Restrito (nega aprovações)
                          </option>
                          <option value="edits">✏️ Aceitar edições</option>
                          <option value="full">
                            ⚠️ Acesso total (sem confirmação)
                          </option>
                        </select>
                      </div>
                    )}

                    {isExecutingPrompt ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                        <RefreshCw size={10} className="animate-spin" />
                        EXECUTANDO CLI
                      </span>
                    ) : (
                      currentSession?.status === "running" && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          READY
                        </span>
                      )
                    )}
                  </div>
                  <div className="text-[11px] text-[#7e7565] flex items-center gap-2 mt-0.5">
                    <span>
                      {currentProvider?.name} (v{currentProvider?.cliVersion})
                    </span>
                    <span>•</span>

                    <div className="flex items-center gap-1.5 bg-[#f4f1e8] hover:bg-[#ede9de] px-2 py-0.5 rounded-md border border-[#dfdacd] transition">
                      <FolderGit2 size={12} className="text-[#8c8270]" />
                      <select
                        value={currentSession?.cwd || ""}
                        onChange={(e) => {
                          if (e.target.value === "__add_new__") {
                            setShowWorkspaceModal(true);
                          } else {
                            handleWorkspaceChange(e.target.value);
                          }
                        }}
                        className="text-[11px] font-mono font-medium bg-transparent text-[#2c2822] outline-none cursor-pointer"
                        disabled={
                          !!currentSession?.nativeSessionId || isExecutingPrompt
                        }
                        title="Após iniciar uma conversa, crie outra sessão para trocar de projeto"
                      >
                        {workspaces.map((ws) => (
                          <option key={ws.id} value={ws.path}>
                            {ws.name} ({ws.path})
                          </option>
                        ))}
                        <option value="__add_new__">
                          + Cadastrar Novo Workspace...
                        </option>
                      </select>

                      {workspaces.find((w) => w.path === currentSession?.cwd)
                        ?.aiMemoryDaemonActive ? (
                        <span
                          className="flex items-center gap-1 text-[9px] font-bold text-emerald-800 bg-emerald-100/90 px-1.5 py-0.2 rounded"
                          title="ai-memory ativo neste diretório"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                          ai-memory ON
                        </span>
                      ) : (
                        <span className="text-[9px] font-medium text-[#8c8270] bg-[#e8e2d4] px-1 py-0.2 rounded">
                          ai-memory OFF
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  onClick={handleTriggerHandoff}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#ede9de] hover:bg-[#e2dcce] border border-[#d6cfbe] text-[#332f28] transition shadow-2xs hover:shadow-xs group"
                  title="Sincronizar /handoff real com o ai-memory"
                >
                  <ArrowRightLeft
                    size={14}
                    className="text-indigo-600 group-hover:rotate-180 transition-transform duration-300"
                  />
                  <span>Handoff</span>
                </button>

                {currentProvider && (
                  <div className="flex items-center gap-2 text-xs font-mono bg-[#f4f1e8] px-2.5 py-1 rounded-xl border border-[#e6e0d2]">
                    <span className="text-[#8c8270]">5h:</span>
                    <b
                      className={
                        getQuotaColor(currentQuota!.window5hPercent).split(
                          " ",
                        )[0]
                      }
                    >
                      {formatQuota(currentQuota!.window5hPercent)}
                    </b>
                    <span className="text-[#8c8270]">| Sem:</span>
                    <b
                      className={
                        getQuotaColor(currentQuota!.weeklyPercent).split(" ")[0]
                      }
                    >
                      {formatQuota(currentQuota!.weeklyPercent)}
                    </b>
                  </div>
                )}

                <button
                  onClick={() => setShowInlineTerminal((prev) => !prev)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                    showInlineTerminal
                      ? "bg-[#18181b] text-white shadow-xs"
                      : "bg-[#ede9de] hover:bg-[#e2dcce] text-[#36322b]"
                  }`}
                  title="Exibir ou ocultar o terminal PTY flutuante"
                >
                  <Terminal size={14} />
                  <span>Shell {showInlineTerminal ? "Visível" : "Oculto"}</span>
                </button>

                <button
                  onClick={() => setActiveTab("terminal")}
                  className="p-1.5 rounded-xl text-xs font-bold bg-[#ede9de] hover:bg-[#e2dcce] transition text-[#36322b]"
                  title="Tela cheia do Terminal PTY"
                >
                  <Maximize2 size={14} />
                </button>
              </div>
            </>
          )}

          {activeTab === "memory" && (
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-[#ede9de] text-[#332f28]">
                  <BrainCircuit size={20} />
                </div>
                <div>
                  <div className="text-sm font-bold text-[#1c1b18]">
                    ai-memory Explorer (Conectado ao Servidor Real)
                  </div>
                  <div className="text-[11px] text-[#7e7565]">
                    Daemon v{memoryStatus.version} • {memoryStatus.serverUrl} •{" "}
                    {memoryStatus.totalPages} páginas
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={refreshAIMemoryExplorer}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#f4f1e8] hover:bg-[#eae4d5] border border-[#dfdacd] text-[#332f28] flex items-center gap-1.5 transition"
                >
                  <RefreshCw
                    size={13}
                    className={isLoadingMemory ? "animate-spin" : ""}
                  />
                  <span>Sincronizar</span>
                </button>
                <button
                  onClick={() => setActiveTab("chat")}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#ede9de] hover:bg-[#e2dcce] text-[#36322b] transition"
                >
                  Voltar ao Chat
                </button>
              </div>
            </div>
          )}

          {activeTab === "terminal" && (
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-[#18181b] text-white">
                  <Terminal size={20} />
                </div>
                <div>
                  <div className="text-sm font-bold text-[#1c1b18]">
                    Shell PTY Interativo ({currentSession?.cwd})
                  </div>
                  <div className="text-[11px] text-[#7e7565]">
                    Terminal do sistema operacional
                  </div>
                </div>
              </div>

              <button
                onClick={() => setActiveTab("chat")}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#ede9de] hover:bg-[#e2dcce] text-[#36322b] transition"
              >
                Voltar ao Chat
              </button>
            </div>
          )}

          {activeTab === "settings" && (
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-[#ede9de] text-[#332f28]">
                  <SettingsIcon size={20} />
                </div>
                <div>
                  <div className="text-sm font-bold text-[#1c1b18]">
                    Configurações, Banco SQLite & MCPs
                  </div>
                  <div className="text-[11px] text-[#7e7565]">
                    Persistência em ~/.capyai/capyai.db e variáveis nativas do
                    OS
                  </div>
                </div>
              </div>

              <button
                onClick={() => setActiveTab("chat")}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#ede9de] hover:bg-[#e2dcce] text-[#36322b] transition"
              >
                Voltar ao Chat
              </button>
            </div>
          )}
        </header>

        {/* ÁREA CENTRAL */}
        {appError && (
          <div
            role="alert"
            className="px-6 py-3 bg-rose-50 text-rose-800 text-sm flex justify-between"
          >
            <span>{appError}</span>
            <button onClick={() => setAppError("")} aria-label="Fechar aviso">
              ×
            </button>
          </div>
        )}
        <div
          ref={chatAreaRef}
          className="flex-1 overflow-hidden relative flex flex-col bg-[#fcfbfa]"
        >
          {/* TAB 1: CHAT */}
          {activeTab === "chat" && (
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
                    currentMessages.map((msg) => (
                      <div key={msg.id} className="flex gap-3">
                        {msg.sender === "user" ? (
                          <div
                            className="w-8 h-8 rounded-xl bg-[#262420] text-amber-200 flex items-center justify-center font-bold text-xs shrink-0 shadow-xs ring-1 ring-[#e4dec9]"
                            title={userProfile.fullName}
                          >
                            {userProfile.initials || "U"}
                          </div>
                        ) : (
                          <CompanyIcon
                            id={msg.sender}
                            size={30}
                            className="shrink-0"
                          />
                        )}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className="font-bold text-sm text-[#1f1d19]">
                              {msg.senderName}
                            </span>
                            {msg.modelBadge && (
                              <span className="text-[11px] font-medium text-[#7d7565] bg-[#ece7db] px-2 py-0.5 rounded-md">
                                {msg.modelBadge}
                              </span>
                            )}
                            {msg.reasoningBadge && (
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${getReasoningBadgeClass(msg.reasoningBadge)}`}
                              >
                                {msg.reasoningBadge}
                              </span>
                            )}
                            <span className="text-xs text-[#9d9483]">
                              {msg.timestamp}
                            </span>
                          </div>

                          <div className="text-sm text-[#2e2a24] leading-relaxed bg-[#f4f1e8]/60 border border-[#eae4d7] rounded-2xl p-3.5 shadow-2xs space-y-3 overflow-x-auto">
                            {msg.text && (
                              <div className="whitespace-pre-wrap break-words font-sans">
                                {msg.text}
                              </div>
                            )}

                            {msg.isStreaming && (
                              <ChatActivity
                                text={msg.activity}
                                startedAt={msg.startedAt}
                              />
                            )}
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="flex flex-wrap gap-2.5 pt-1">
                                {msg.attachments.map((att) => (
                                  <div
                                    key={att.id}
                                    className="overflow-hidden rounded-xl border border-[#dcd6c7] bg-[#ffffff] shadow-2xs max-w-sm"
                                  >
                                    {att.type === "image" ? (
                                      <div>
                                        <img
                                          src={att.url}
                                          alt={att.name}
                                          className="max-h-64 w-auto object-cover rounded-t-xl hover:opacity-95 cursor-pointer"
                                          onClick={() =>
                                            window.open(att.url, "_blank")
                                          }
                                        />
                                        <div className="px-2.5 py-1.5 flex items-center justify-between text-[11px] text-[#7d7565] bg-[#faf8f4]">
                                          <span className="truncate max-w-[180px] font-medium">
                                            {att.name}
                                          </span>
                                          <span className="font-mono text-[10px]">
                                            {att.sizeText}
                                          </span>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="p-3 flex items-center gap-2.5">
                                        <Paperclip
                                          size={16}
                                          className="text-[#8c8270]"
                                        />
                                        <div>
                                          <div className="text-xs font-bold text-[#2e2a24]">
                                            {att.name}
                                          </div>
                                          <div className="text-[10px] font-mono text-[#8c8270]">
                                            {att.sizeText}
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {msg.commandSnippet && (
                              <div className="mt-2.5 pt-2 border-t border-[#dfdacd] flex items-center justify-between font-mono text-xs text-[#b45309]">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                                  <span className="truncate max-w-lg">
                                    {msg.commandSnippet}
                                  </span>
                                </div>
                                <span className="text-[10px] text-[#7e7565]">
                                  CLI / SQLite
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* INPUT DE MENSAGEM */}
                <div className="sticky bottom-0 pt-4 bg-gradient-to-t from-[#fcfbfa] via-[#fcfbfa] to-transparent">
                  {attachments.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2 p-2 bg-[#ffffff] border border-[#ded8cb] rounded-xl shadow-xs">
                      {attachments.map((att) => (
                        <div
                          key={att.id}
                          className="relative group flex items-center gap-2 pl-2 pr-1 py-1 rounded-lg bg-[#f4f1e8] border border-[#e4dec9] text-xs"
                        >
                          {att.type === "image" ? (
                            <img
                              src={att.url}
                              alt={att.name}
                              className="w-7 h-7 object-cover rounded-md"
                            />
                          ) : (
                            <Paperclip size={14} className="text-[#8c8270]" />
                          )}
                          <span className="font-medium text-[#332f28] max-w-[140px] truncate">
                            {att.name}
                          </span>
                          <span className="text-[10px] text-[#8c8270] font-mono">
                            ({att.sizeText})
                          </span>
                          <button
                            type="button"
                            onClick={() => removeAttachment(att.id)}
                            className="p-1 hover:text-rose-600 rounded"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <form
                    onSubmit={handleSendMessage}
                    className="flex items-center gap-2 bg-[#ffffff] border border-[#dcd6c7] focus-within:border-[#968d7a] rounded-2xl p-2 shadow-sm transition"
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      multiple
                      className="hidden"
                      accept="image/*,.pdf,.txt,.ts,.tsx,.json,.md"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="p-2 rounded-xl text-[#7d7565] hover:text-[#221f1a] hover:bg-[#ede9de] transition"
                      title="Anexar arquivos ou prints"
                    >
                      <Paperclip size={17} />
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowSkillsModal(true)}
                      className="p-2 rounded-xl text-[#7d7565] hover:text-[#1c1b18] hover:bg-[#ede9de] transition"
                      title="Chamar Skills / Revisor (Ctrl+K)"
                    >
                      <Wand2 size={16} />
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowHistoryModal(true)}
                      className="p-2 rounded-xl text-[#7d7565] hover:text-[#1c1b18] hover:bg-[#ede9de] transition"
                      title="Histórico de conversas passadas (Ctrl+H)"
                    >
                      <Clock size={16} />
                    </button>

                    <input
                      type="text"
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onPaste={handlePaste}
                      placeholder={`Mensagem para ${currentSession?.currentModel || currentProvider?.name}... (Ctrl+K skills, Ctrl+H histórico)`}
                      className="flex-1 px-2 py-2 text-sm bg-transparent outline-none text-[#1c1b18] placeholder-[#9c9381]"
                    />

                    {currentSession?.permission !== "plan" ? (
                      <button
                        type="button"
                        onClick={() => handlePermissionChange("plan")}
                        className="px-2 py-1 rounded-lg text-[11px] font-semibold text-[#665e4f] bg-[#f4f1e8] hover:bg-[#eae4d5] transition flex items-center gap-1"
                        title="Ativar modo planejamento"
                      >
                        <Compass size={13} className="text-emerald-600" />
                        <span>/plan</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handlePermissionChange("edits")}
                        className="px-2 py-1 rounded-lg text-[11px] font-semibold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 transition flex items-center gap-1"
                        title="Voltar para modo de execução normal"
                      >
                        <Zap size={13} className="text-emerald-700" />
                        <span>Plan Ativo</span>
                      </button>
                    )}

                    {!inputMessage && (
                      <button
                        type="button"
                        onClick={handleTriggerHandoff}
                        className="px-2 py-1 rounded-lg text-[11px] font-semibold text-[#665e4f] bg-[#f4f1e8] hover:bg-[#eae4d5] transition flex items-center gap-1"
                        title="Salvar handoff agora"
                      >
                        <ArrowRightLeft size={13} className="text-indigo-600" />
                        <span>/handoff</span>
                      </button>
                    )}

                    {currentSession && isExecutingPrompt && (
                      <button
                        type="button"
                        aria-label="Parar execução e cancelar fila"
                        disabled={!!stoppingSessions[currentSession.id]}
                        onClick={() =>
                          void handleStopSession(currentSession.id)
                        }
                        className="px-3 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white text-xs font-bold flex gap-1.5 items-center"
                      >
                        <Square size={12} />
                        {stoppingSessions[currentSession.id]
                          ? "Parando…"
                          : "Parar"}
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={!currentSession || !inputMessage.trim()}
                      className="p-2.5 rounded-xl bg-[#1c1b18] hover:bg-[#32302b] disabled:opacity-30 text-white transition"
                    >
                      <Send size={15} />
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}

          {/* CONSOLE FLUTUANTE INTERATIVO (DRAGGABLE, RESIZABLE & REAL BASH PTY) */}
          {activeTab === "chat" && showInlineTerminal && currentSession && (
            <div
              ref={floatBoxRef}
              style={{
                left: 0,
                top: 0,
                transform: `translate3d(${floatPos.x}px, ${floatPos.y}px, 0)`,
                width: `${floatSize.width}px`,
                height: `${floatSize.height}px`,
                willChange: "transform, width, height",
              }}
              className="absolute z-40 bg-[#141416]/95 backdrop-blur-md rounded-2xl border border-[#3f3f46] shadow-2xl flex flex-col overflow-hidden select-none"
            >
              {/* BARRA SUPERIOR PARA ARRASTAR */}
              <div
                onMouseDown={handleStartDrag}
                className="h-9 bg-[#1e1e21] px-3.5 flex items-center justify-between border-b border-[#2e2e33] cursor-grab active:cursor-grabbing select-none"
                title="Clique e arraste para mover o console"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
                  <span className="ml-2 font-mono text-[11px] text-[#a1a1aa] font-medium flex items-center gap-1.5">
                    <Move size={11} className="text-[#71717a]" />
                    pty://{currentProvider?.name} ({currentSession.cwd})
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-[#a1a1aa] bg-[#27272a] px-1.5 py-0.5 rounded">
                    PID: {currentSession.pid || "ready"}
                  </span>
                  <button
                    onClick={() => setShowInlineTerminal(false)}
                    className="p-1 hover:bg-[#2e2e33] rounded text-[#a1a1aa]"
                    title="Ocultar console"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>

              <LiveShell
                sessionId={currentSession.id}
                text={
                  currentSession.ptyRaw ||
                  (currentSession.ptyLog || []).join("\r\n")
                }
              />

              {/* BARRA INFERIOR PARA RESIZE */}
              <div
                onMouseDown={handleStartResize}
                className="h-4 bg-[#1e1e21]/90 border-t border-[#2e2e33] flex items-center justify-between px-2.5 cursor-nwse-resize select-none"
                title="Arraste para redimensionar largura e altura"
              >
                <span className="text-[9px] font-mono text-[#71717a]">
                  {floatSize.width}x{floatSize.height} • GPU Accelerated
                </span>
                <span className="text-[10px] text-[#a1a1aa] font-mono">
                  ⤡ resize
                </span>
              </div>
            </div>
          )}

          {/* TAB 2: AI-MEMORY HUB REAL */}
          {activeTab === "memory" && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-5xl w-full mx-auto space-y-6">
                <div className="bg-[#ffffff] border border-[#ded8cb] rounded-2xl p-6 shadow-xs">
                  <div className="flex items-center justify-between pb-4 border-b border-[#eeeae0]">
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-xl bg-[#f4f1e8] text-[#332f28]">
                        <BrainCircuit size={26} />
                      </div>
                      <div>
                        <h2 className="font-bold text-lg text-[#1c1b18]">
                          ai-memory Central (v{memoryStatus.version})
                        </h2>
                        <p className="text-xs text-[#7d7565]">
                          Configuração e status do binário `
                          {memoryStatus.cliPath}`
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 bg-[#f4f1e8] border border-[#dfdacd] p-1.5 rounded-xl shadow-2xs">
                      <Server size={14} className="text-[#7d7565] ml-1" />
                      <span className="text-xs">
                        {memoryStatus.serverRunning
                          ? "Conectado"
                          : "Indisponível"}
                      </span>

                      <span className="flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Online
                      </span>
                    </div>
                  </div>

                  {/* Métricas Reais do Servidor */}
                  <div className="grid grid-cols-3 gap-4 mt-5">
                    <div className="p-4 rounded-xl bg-[#f8f7f2] border border-[#e6e1d5]">
                      <div className="text-xs text-[#8c8270] font-medium">
                        Projetos Indexados
                      </div>
                      <div className="text-xl font-extrabold text-[#1f1d19] mt-0.5">
                        {memoryProjects.length || 9} projetos
                      </div>
                      <div className="text-[11px] font-mono text-[#8c8270] mt-1">
                        Projetos registrados nesta máquina
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-[#f8f7f2] border border-[#e6e1d5]">
                      <div className="text-xs text-[#8c8270] font-medium">
                        Páginas Compiladas na Wiki
                      </div>
                      <div className="text-xl font-extrabold text-[#1f1d19] mt-0.5">
                        {memoryStatus.totalPages} páginas
                      </div>
                      <div className="text-[11px] text-emerald-700 font-medium mt-1">
                        FTS5 + Vetores 384d MiniLM
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-[#f8f7f2] border border-[#e6e1d5]">
                      <div className="text-xs text-[#8c8270] font-medium">
                        Ledger Bruto de Observações
                      </div>
                      <div className="text-xl font-extrabold text-[#1f1d19] mt-0.5">
                        {memoryStatus.recentObservationsCount?.toLocaleString(
                          "pt-BR",
                        )}{" "}
                        eventos
                      </div>
                      <div className="text-[11px] text-[#8c8270] mt-1">
                        Histórico cross-session preservado
                      </div>
                    </div>
                  </div>

                  {/* Barra de Busca Real FTS5 no ai-memory */}
                  <form
                    onSubmit={handleSearchAIMemory}
                    className="mt-6 flex items-center gap-2"
                  >
                    <div className="relative flex-1">
                      <Search
                        size={16}
                        className="absolute left-3.5 top-3 text-[#8c8270]"
                      />
                      <input
                        type="text"
                        value={memorySearchQuery}
                        onChange={(e) => setMemorySearchQuery(e.target.value)}
                        placeholder="Pesquisar na wiki do ai-memory..."
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#d6cfbe] bg-[#fcfbfa] text-xs outline-none focus:border-[#968d7a]"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isLoadingMemory}
                      className="px-4 py-2.5 rounded-xl bg-[#1c1b18] hover:bg-[#32302b] text-white text-xs font-bold transition"
                    >
                      {isLoadingMemory ? "Buscando..." : "Buscar na Wiki"}
                    </button>
                  </form>

                  {/* Lista de Páginas Reais da Wiki + Visualizador */}
                  <div className="mt-6 grid grid-cols-12 gap-4">
                    <div className="col-span-5 space-y-2 max-h-96 overflow-y-auto pr-1">
                      <div className="text-[11px] font-bold text-[#8c8270] uppercase tracking-wider mb-2">
                        {memorySearchQuery
                          ? `Resultados para "${memorySearchQuery}"`
                          : "Páginas Atualizadas Recentemente"}
                      </div>
                      {memoryWikiPages.length === 0 ? (
                        <div className="p-4 rounded-xl bg-[#f8f7f2] text-xs text-[#8c8270]">
                          Nenhuma página encontrada para este filtro.
                        </div>
                      ) : (
                        memoryWikiPages.map((page, idx) => (
                          <div
                            key={`${page.workspace}-${page.project}-${page.path}-${idx}`}
                            onClick={() => handleReadWikiPage(page)}
                            className={`p-3 rounded-xl border cursor-pointer transition ${
                              selectedWikiPage?.path === page.path
                                ? "bg-[#ede9de] border-[#968d7a]"
                                : "bg-[#faf8f4] hover:bg-[#f3efe4] border-[#e6e1d5]"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#dfdacd] text-[#332f28]">
                                {page.workspace}/{page.project}
                              </span>
                              <span className="text-[10px] font-mono text-[#8c8270] truncate">
                                {page.path}
                              </span>
                            </div>
                            <div className="font-bold text-xs text-[#1c1b18]">
                              {page.title}
                            </div>
                            {page.snippet && (
                              <p className="text-[11px] text-[#6d6657] line-clamp-2 mt-1">
                                {page.snippet.replace(/<\/?mark>/g, "")}
                              </p>
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    <div className="col-span-7 bg-[#faf8f4] border border-[#e6e1d5] rounded-xl p-4 max-h-96 overflow-y-auto">
                      {selectedWikiPage ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between border-b border-[#e6e1d5] pb-2">
                            <div>
                              <div className="text-xs font-bold text-[#1c1b18]">
                                {selectedWikiPage.title}
                              </div>
                              <div className="text-[10px] font-mono text-[#8c8270]">
                                {selectedWikiPage.workspace}/
                                {selectedWikiPage.project} •{" "}
                                {selectedWikiPage.path}
                              </div>
                            </div>
                            <button
                              onClick={() => {
                                setInputMessage(
                                  `Consulte a página ${selectedWikiPage.path} do projeto ${selectedWikiPage.project}: `,
                                );
                                setActiveTab("chat");
                              }}
                              className="px-2.5 py-1 rounded-lg bg-[#1c1b18] text-white text-[10px] font-bold"
                            >
                              Usar no Chat
                            </button>
                          </div>
                          <pre className="text-xs font-mono text-[#2e2a24] whitespace-pre-wrap leading-relaxed">
                            {selectedWikiPage.body}
                          </pre>
                        </div>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center py-16 text-[#8c8270] text-xs space-y-2">
                          <FileText size={28} className="text-[#c5bea9]" />
                          <p>
                            Clique em qualquer página à esquerda para ler o
                            documento Markdown completo direto do servidor
                            ai-memory.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Projetos & Handoffs Ativos */}
                  {memoryHandoffsText && (
                    <div className="mt-6 pt-4 border-t border-[#eeeae0]">
                      <div className="text-xs font-bold text-[#1c1b18] mb-2 flex items-center gap-1.5">
                        <Layers size={14} className="text-indigo-600" />
                        <span>Handoffs Pendentes Detectados</span>
                      </div>
                      <pre className="p-3 rounded-xl bg-[#f4f1e8] border border-[#dfdacd] font-mono text-[11px] text-[#332f28] whitespace-pre-wrap">
                        {memoryHandoffsText}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: TERMINAL PTY TELA CHEIA INTERATIVO */}
          {activeTab === "terminal" && (
            <div className="p-6 flex-1 flex flex-col overflow-hidden">
              <div className="max-w-5xl w-full mx-auto flex-1 flex flex-col bg-[#141416] rounded-2xl overflow-hidden shadow-xl border border-[#27272a]">
                <div className="h-10 bg-[#1e1e21] px-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
                    <span className="ml-2 font-mono text-xs text-[#a1a1aa] font-medium">
                      {currentProvider?.cliPath} — Workspace:{" "}
                      {currentSession?.cwd}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs font-mono text-[#a1a1aa]">
                    <span className="px-2 py-0.5 rounded bg-[#27272a] text-[#e4e4e7]">
                      PID {currentSession?.pid || "ativo"}
                    </span>
                  </div>
                </div>

                <LiveShell
                  sessionId={currentSession?.id || ""}
                  text={
                    currentSession?.ptyRaw ||
                    (currentSession?.ptyLog || []).join("\r\n")
                  }
                />
              </div>
            </div>
          )}

          {/* TAB 4: CONFIGURAÇÕES, BANCO SQLITE E MCPS */}
          {activeTab === "settings" && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-4xl w-full mx-auto space-y-6">
                <div className="bg-[#ffffff] border border-[#ded8cb] rounded-2xl p-6 shadow-xs">
                  <div className="flex items-center justify-between pb-4 border-b border-[#eeeae0] mb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-[#f4f1e8] text-[#332f28]">
                        <Blocks size={22} />
                      </div>
                      <div>
                        <h2 className="font-bold text-lg text-[#1c1b18]">
                          Binários Locais, Banco SQLite & MCPs
                        </h2>
                        <p className="text-xs text-[#7d7565]">
                          Banco SQLite ativo em `~/.capyai/capyai.db` •
                          Identidade OS: `{userProfile.fullName}` (`
                          {userProfile.email}`)
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {providers
                      .filter((p) => p.installed)
                      .map((p) => (
                        <div
                          key={p.id}
                          className="p-4 rounded-xl bg-[#fcfbfa] border border-[#ded8cb]"
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2.5">
                              <CompanyIcon id={p.id} size={22} />
                              <span className="font-bold text-sm text-[#1c1b18]">
                                {p.name}
                              </span>
                              <span className="text-xs font-mono bg-[#eeeae0] text-[#554e42] px-2 py-0.5 rounded-md">
                                CLI v{p.cliVersion}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-[#8c8270] truncate max-w-xs">
                                {p.cliPath}
                              </span>
                              <button
                                aria-label={`Atualizar ${p.name}`}
                                disabled={!!cliUpdating || hasRunningPrompts}
                                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#ded8cb] disabled:opacity-50"
                                onClick={async () => {
                                  setCliUpdating(p.id);
                                  setCliFeedback((prev) => ({
                                    ...prev,
                                    [p.id]: "Atualizando…",
                                  }));
                                  try {
                                    const result = await (
                                      window as any
                                    ).capyAPI.updateCli(p.id);
                                    setCliFeedback((prev) => ({
                                      ...prev,
                                      [p.id]: result.ok
                                        ? `CLI atualizada${result.version ? " para " + result.version : ""}.`
                                        : result.error,
                                    }));
                                  } catch (e) {
                                    setCliFeedback((prev) => ({
                                      ...prev,
                                      [p.id]: (e as Error).message,
                                    }));
                                  } finally {
                                    setCliUpdating("");
                                  }
                                }}
                              >
                                {cliUpdating === p.id
                                  ? "Atualizando…"
                                  : "Atualizar CLI"}
                              </button>
                            </div>
                          </div>

                          {updateInfo.releases?.[p.id]?.version && (
                            <p className="text-xs text-[#7d7565]">
                              Última versão publicada:{" "}
                              {updateInfo.releases[p.id].version}
                            </p>
                          )}
                          {cliFeedback[p.id] && (
                            <p
                              role="status"
                              className="text-xs mt-2 text-[#554e42]"
                            >
                              {cliFeedback[p.id]}
                            </p>
                          )}
                          {globalPolicies
                            .filter((policy) => policy.providerId === p.id)
                            .map((policy) => (
                              <div
                                key={p.id}
                                className="mt-3 pt-3 border-t border-[#f0ebd9] space-y-2"
                              >
                                <p className="font-semibold text-xs">
                                  Permissões globais da CLI
                                </p>
                                <p className="text-[11px] text-[#7d7565]">
                                  Aplicadas nas próximas execuções com “Global
                                  da CLI”. Regras do projeto e políticas
                                  gerenciadas também podem se aplicar. Ações que
                                  exigem confirmação aparecem no painel de
                                  permissões do chat.
                                </p>
                                {policy.error && (
                                  <p
                                    role="alert"
                                    className="text-xs text-rose-700"
                                  >
                                    {policy.error}
                                  </p>
                                )}
                                <div className="flex flex-wrap gap-3 items-end">
                                  {policy.fields.map((field: any) => (
                                    <label
                                      key={field.key}
                                      className="text-xs space-y-1"
                                    >
                                      <span className="block">
                                        {field.label}
                                      </span>
                                      <select
                                        aria-label={`${p.name}: ${field.label} global`}
                                        value={
                                          policyDrafts[p.id]?.[field.key] ??
                                          field.value
                                        }
                                        className="border border-[#ded8cb] rounded-lg p-1.5 bg-white"
                                        onChange={(e) =>
                                          setPolicyDrafts((prev) => ({
                                            ...prev,
                                            [p.id]: {
                                              ...prev[p.id],
                                              [field.key]: e.target.value,
                                            },
                                          }))
                                        }
                                      >
                                        <option value="" disabled>
                                          Padrão da CLI / configuração avançada
                                        </option>
                                        {field.value &&
                                          !field.values.includes(
                                            field.value,
                                          ) && (
                                            <option
                                              value={field.value}
                                              disabled
                                            >
                                              {field.value}
                                            </option>
                                          )}
                                        {field.values.map((value: string) => (
                                          <option key={value} value={value}>
                                            {field.valueLabels?.[value] ||
                                              value}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ))}
                                  {!!Object.keys(policyDrafts[p.id] || {})
                                    .length && (
                                    <button
                                      className="text-xs border border-[#ded8cb] rounded-lg p-2"
                                      onClick={async () => {
                                        try {
                                          const saved = await (
                                            window as any
                                          ).capyAPI.saveGlobalPermissions(
                                            p.id,
                                            policyDrafts[p.id],
                                          );
                                          setGlobalPolicies((prev) =>
                                            prev.map((v) =>
                                              v.providerId === p.id ? saved : v,
                                            ),
                                          );
                                          setPolicyDrafts((prev) => ({
                                            ...prev,
                                            [p.id]: {},
                                          }));
                                          setCliFeedback((prev) => ({
                                            ...prev,
                                            [p.id]: "Permissão global salva.",
                                          }));
                                        } catch (e) {
                                          setCliFeedback((prev) => ({
                                            ...prev,
                                            [p.id]: (e as Error).message,
                                          }));
                                        }
                                      }}
                                    >
                                      Salvar permissão global
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          <div className="mt-3 pt-3 border-t border-[#f0ebd9]">
                            <div className="text-[11px] font-bold text-[#8c8270] uppercase tracking-wider mb-2">
                              <span>
                                Servidores MCP Configurados ({p.mcps.length})
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              {p.mcps.map((mcp) => (
                                <div
                                  key={mcp.name}
                                  className="flex items-center justify-between p-2.5 rounded-lg bg-[#ffffff] border border-[#e6e1d5] text-xs"
                                >
                                  <div className="flex items-center gap-2 truncate">
                                    <CheckCircle2
                                      size={13}
                                      className="text-zinc-400 shrink-0"
                                    />
                                    <span className="font-semibold text-[#2e2a24]">
                                      {mcp.name}
                                    </span>
                                    <span className="text-[10px] text-[#8c8270] font-mono">
                                      ({mcp.type})
                                    </span>
                                  </div>
                                  <span className="text-[10px] font-mono bg-[#f4f1e8] text-[#5d5547] px-1.5 py-0.5 rounded">
                                    {mcp.toolsCount || "N/A"} tools
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>

                <div className="bg-[#ffffff] border border-[#ded8cb] rounded-2xl p-6 shadow-xs">
                  <h2 className="font-bold text-lg text-[#1c1b18] mb-1">
                    Credenciais da aplicação
                  </h2>
                  <p className="text-xs text-[#7d7565] mb-6">
                    Protegidas pelo cofre do sistema no aplicativo desktop. As
                    CLIs usam suas próprias credenciais.
                  </p>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-[#443e33] uppercase tracking-wider mb-1.5">
                        OpenRouter API Key
                      </label>
                      <input
                        type="password"
                        placeholder={
                          settings.configuredSecrets?.openRouterApiKey
                            ? "Chave já cadastrada; digite para substituir"
                            : "Chave de API"
                        }
                        value={settings.openRouterApiKey || ""}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            openRouterApiKey: e.target.value,
                          })
                        }
                        className="w-full px-3.5 py-2.5 rounded-xl border border-[#d6cfbe] bg-[#fcfbfa] text-sm font-mono outline-none focus:border-[#968d7a]"
                      />
                    </div>

                    <div className="pt-4 border-t border-[#eeeae0] flex items-center justify-between">
                      {settingsSavedBanner ? (
                        <span className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
                          <CheckCircle2 size={15} />
                          Configurações salvas com sucesso!
                        </span>
                      ) : (
                        <span />
                      )}
                      <button
                        onClick={handleSaveSettings}
                        className="px-5 py-2.5 rounded-xl bg-[#1c1b18] hover:bg-[#32302b] text-white text-xs font-bold transition"
                      >
                        Salvar configurações
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {cliApprovals.length > 0 && (
        <div
          role="dialog"
          aria-label="Autorizar ação da CLI"
          className="fixed bottom-6 right-6 z-[70] w-96 max-w-[calc(100vw-48px)] bg-white border border-amber-300 rounded-2xl shadow-2xl p-4 space-y-3"
        >
          <div className="font-bold text-sm">
            Permissão · {cliApprovals[0].providerId}
          </div>
          <button
            className="text-xs underline"
            onClick={() => {
              setActiveSessionId(cliApprovals[0].sessionId);
              setActiveTab("chat");
            }}
          >
            {allSessions.find((s) => s.id === cliApprovals[0].sessionId)
              ?.title || "Abrir conversa"}
          </button>
          <p className="text-xs">{cliApprovals[0].tool}</p>
          <pre className="text-[11px] whitespace-pre-wrap break-all max-h-48 overflow-auto bg-[#f7f5ef] p-2 rounded-lg">
            {cliApprovals[0].input}
          </pre>
          <p className="text-[11px] text-[#7d7565]">
            A autorização vale somente para esta ação. Regras explícitas de
            bloqueio continuam valendo.
          </p>
          <div className="flex gap-2">
            {["allow", "deny"].map((decision) => (
              <button
                key={decision}
                className={`px-3 py-2 rounded-lg text-xs font-bold ${decision === "allow" ? "bg-emerald-700 text-white" : "bg-[#ede9de]"}`}
                onClick={async () => {
                  try {
                    await (window as any).capyAPI.resolveCliApproval(
                      cliApprovals[0].id,
                      decision,
                    );
                  } catch (e) {
                    setAppError((e as Error).message);
                  }
                }}
              >
                {decision === "allow" ? "Autorizar uma vez" : "Negar"}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* MODAL PARA CADASTRAR NOVO WORKSPACE */}
      {showWorkspaceModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#ffffff] border border-[#d8d2c3] rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#eeeae0]">
              <div className="flex items-center gap-2">
                <FolderOpen size={20} className="text-[#8c8270]" />
                <h3 className="font-bold text-base text-[#1c1b18]">
                  Cadastrar Novo Workspace
                </h3>
              </div>
              <button
                onClick={() => setShowWorkspaceModal(false)}
                className="p-1 hover:bg-[#ede9de] rounded-lg text-[#6d6657]"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleAddWorkspace} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#443e33] uppercase tracking-wider mb-1">
                  Nome do Projeto
                </label>
                <input
                  type="text"
                  placeholder="Ex: API, App Mobile..."
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#d6cfbe] bg-[#fcfbfa] text-sm outline-none focus:border-[#968d7a]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#443e33] uppercase tracking-wider mb-1">
                  Caminho Absoluto no Disco
                </label>
                <input
                  type="text"
                  placeholder="Caminho absoluto do projeto"
                  value={newWorkspacePath}
                  onChange={(e) => setNewWorkspacePath(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-xl border border-[#d6cfbe] bg-[#fcfbfa] text-sm font-mono outline-none focus:border-[#968d7a]"
                />
              </div>

              <div className="p-3 rounded-xl bg-[#f8f7f2] border border-[#eae4d7] text-xs text-[#6d6657] space-y-1">
                <div className="font-semibold text-[#2c2822]">
                  💡 Persistência no SQLite & Auto-detecção:
                </div>
                <p>
                  O BeagleDock grava o workspace na tabela `workspaces` e
                  verifica se existe `.ai-memory.toml` ou `AGENTS.md`.
                </p>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowWorkspaceModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[#6d6657] hover:bg-[#ede9de] transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!newWorkspacePath.trim()}
                  className="px-4 py-2 rounded-xl bg-[#1c1b18] hover:bg-[#32302b] disabled:opacity-30 text-white text-xs font-bold transition"
                >
                  Salvar Workspace
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL / POPUP: SKILLS SALVAS (Ctrl+K) */}
      {showSkillsModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#ffffff] border border-[#d8d2c3] rounded-2xl shadow-2xl max-w-2xl w-full flex flex-col overflow-hidden max-h-[80vh]">
            <div className="p-4 border-b border-[#eeeae0] bg-[#faf8f4] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 flex-1">
                <Wand2 size={20} className="text-amber-600" />
                <div className="relative flex-1">
                  <Search
                    size={15}
                    className="absolute left-3 top-2.5 text-[#8c8270]"
                  />
                  <input
                    type="text"
                    autoFocus
                    placeholder="Buscar skills salvas (ex: revisor, seguranca, memory, aws)..."
                    value={skillsSearch}
                    onChange={(e) => setSkillsSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-[#d6cfbe] bg-[#ffffff] text-xs outline-none focus:border-[#968d7a]"
                  />
                </div>
              </div>
              <span className="font-mono text-[10px] bg-[#ede9de] px-2 py-1 rounded text-[#6b6251]">
                ESC para fechar
              </span>
              <button
                onClick={() => setShowSkillsModal(false)}
                className="p-1 hover:bg-[#ede9de] rounded-lg text-[#6d6657]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
              <div className="text-[11px] font-bold text-[#8c8270] uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>
                  Skills reais instaladas no seu ambiente (
                  {installedSkills.length})
                </span>
                <span className="text-[10px] text-amber-700 font-semibold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                  Clique para chamar a skill
                </span>
              </div>

              {installedSkills
                .filter(
                  (s) =>
                    s.name.toLowerCase().includes(skillsSearch.toLowerCase()) ||
                    s.description
                      .toLowerCase()
                      .includes(skillsSearch.toLowerCase()) ||
                    (s.category &&
                      s.category
                        .toLowerCase()
                        .includes(skillsSearch.toLowerCase())),
                )
                .map((skill) => (
                  <div
                    key={skill.id}
                    onClick={() => handleSelectSkill(skill)}
                    className="group p-3 rounded-xl border border-[#ded8cb] hover:border-[#968d7a] hover:bg-[#fbf9f5] transition cursor-pointer flex items-start justify-between gap-3"
                  >
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-[#1c1b18] group-hover:text-amber-700 flex items-center gap-1.5">
                          <Sparkle size={13} className="text-amber-600" />
                          {skill.name}
                        </span>
                        {skill.category && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-[#ece7db] text-[#5c5446]">
                            {skill.category}
                          </span>
                        )}
                        {skill.name.includes("revis") && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                            Revisor Favorito
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#6e6656] line-clamp-2 leading-relaxed">
                        {skill.description}
                      </p>
                      <div className="pt-1 flex items-center gap-2 text-[10px] font-mono text-[#8c8270]">
                        <span className="truncate max-w-md">{skill.path}</span>
                      </div>
                    </div>

                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                      <span className="px-2 py-1 rounded-lg bg-[#ede9de] group-hover:bg-amber-100 group-hover:text-amber-900 font-mono text-[10px] font-bold text-[#443e33] transition flex items-center gap-1">
                        <span>Chamar</span>
                        <ChevronRight size={12} />
                      </span>
                    </div>
                  </div>
                ))}
            </div>

            <div className="p-3 bg-[#faf8f4] border-t border-[#eeeae0] text-center text-xs text-[#7d7565]">
              Atalho global: pressione{" "}
              <kbd className="font-bold bg-[#ede9de] px-1.5 py-0.5 rounded text-[#332f28]">
                Ctrl + K
              </kbd>{" "}
              a qualquer momento no cockpit.
            </div>
          </div>
        </div>
      )}

      {/* MODAL / POPUP: HISTÓRICO DE CONVERSAS PASSADAS (Ctrl+H) */}
      {showHistoryModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#ffffff] border border-[#d8d2c3] rounded-2xl shadow-2xl max-w-3xl w-full flex flex-col overflow-hidden max-h-[85vh]">
            <div className="p-4 border-b border-[#eeeae0] bg-[#faf8f4] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 flex-1">
                <History size={20} className="text-indigo-600" />
                <div className="relative flex-1">
                  <Search
                    size={15}
                    className="absolute left-3 top-2.5 text-[#8c8270]"
                  />
                  <input
                    type="text"
                    autoFocus
                    placeholder="Buscar histórico de conversas e sessões passadas..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-[#d6cfbe] bg-[#ffffff] text-xs outline-none focus:border-[#968d7a]"
                  />
                </div>
              </div>
              <span className="font-mono text-[10px] bg-[#ede9de] px-2 py-1 rounded text-[#6b6251]">
                ESC para fechar
              </span>
              <button
                onClick={() => setShowHistoryModal(false)}
                className="p-1 hover:bg-[#ede9de] rounded-lg text-[#6d6657]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
              <div className="text-[11px] font-bold text-[#8c8270] uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>
                  Histórico de sessões locais (Claude Code & Codex CLI)
                </span>
                <span className="text-[10px] text-indigo-700 font-semibold bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
                  Clique para abrir a conversa inteira com todas as mensagens
                </span>
              </div>

              {cliHistory.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#8c8270] space-y-2">
                  <History size={28} className="mx-auto text-[#c5bea9]" />
                  <p>Nenhum histórico local carregado.</p>
                </div>
              ) : (
                cliHistory
                  .filter(
                    (h) =>
                      h.prompt
                        .toLowerCase()
                        .includes(historySearch.toLowerCase()) ||
                      h.title
                        .toLowerCase()
                        .includes(historySearch.toLowerCase()) ||
                      h.providerName
                        .toLowerCase()
                        .includes(historySearch.toLowerCase()),
                  )
                  .map((item) => (
                    <div
                      key={item.id}
                      onClick={() => handleOpenFullConversation(item)}
                      className="group p-3 rounded-xl border border-[#ded8cb] hover:border-[#968d7a] hover:bg-[#fbf9f5] transition cursor-pointer flex items-start justify-between gap-3"
                    >
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <CompanyIcon
                            id={item.provider}
                            size={16}
                            className="shrink-0"
                          />
                          <span className="font-bold text-xs text-[#1c1b18] group-hover:text-indigo-700">
                            {item.providerName}
                          </span>
                          <span className="text-[10px] font-mono text-[#8c8270] bg-[#ede9de] px-1.5 py-0.2 rounded">
                            {item.project}
                          </span>
                          <span className="text-[10px] text-[#9c9381] flex items-center gap-1 ml-auto">
                            <Clock size={11} />
                            {item.date}
                          </span>
                        </div>
                        <p className="text-xs text-[#38332a] font-medium line-clamp-2 leading-relaxed">
                          "{item.prompt}"
                        </p>
                      </div>

                      <div className="shrink-0 flex items-center gap-2 self-center pl-2">
                        <button
                          type="button"
                          onClick={(e) => handleSelectHistoryPrompt(item, e)}
                          className="px-2 py-1 rounded-lg bg-[#ede9de] hover:bg-[#dfdacd] text-[#443e33] font-mono text-[10px] font-bold transition flex items-center gap-1"
                          title="Copiar apenas este prompt para o input"
                        >
                          <span>Prompt</span>
                          <Copy size={11} />
                        </button>

                        <span className="px-2.5 py-1 rounded-lg bg-indigo-50 group-hover:bg-indigo-600 group-hover:text-white font-mono text-[10px] font-bold text-indigo-700 transition flex items-center gap-1 shadow-2xs">
                          <span>Abrir Conversa</span>
                          <ChevronRight size={12} />
                        </span>
                      </div>
                    </div>
                  ))
              )}
            </div>

            <div className="p-3 bg-[#faf8f4] border-t border-[#eeeae0] text-center text-xs text-[#7d7565]">
              Atalho global: pressione{" "}
              <kbd className="font-bold bg-[#ede9de] px-1.5 py-0.5 rounded text-[#332f28]">
                Ctrl + H
              </kbd>{" "}
              para abrir o histórico de qualquer tela.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
