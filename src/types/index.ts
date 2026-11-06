export type AIProviderId = "claude" | "codex" | "antigravity" | "openrouter";

export type PermissionLevel = "inherit" | "plan" | "ask" | "edits" | "full";
export type ReasoningEffortLevel = string;

export interface MCPServerInfo {
  name: string;
  type: "stdio" | "sse" | "remote";
  commandOrUrl: string;
  status: "connected" | "idle" | "error";
  toolsCount?: number;
}

export interface ChatAttachment {
  id: string;
  name: string;
  type: "image" | "file";
  url: string;
  sizeText: string;
}

export interface AIMemoryDaemonTarget {
  id: string;
  name: string;
  serverUrl: string;
  isLocal: boolean;
  status: "active" | "reachable" | "offline";
  pingMs?: number;
}

export interface WorkspaceItem {
  id: string;
  name: string;
  path: string;
  hasAIMemory: boolean;
}

/** Registered workspace plus the folder's current state on disk, for the maintenance screen. */
export interface WorkspaceStatus extends WorkspaceItem {
  exists: boolean;
  isGitRepo: boolean;
  conversations: number;
}

/** How much of the model's context window is used (and the last compaction). */
export interface ContextInfo {
  source?: string;
  used: number | null;
  /** Prompt cache of the last call: read (cheap) and written (expensive: expired cache or new prefix). */
  cache?: { read?: number; write?: number };
  /** Time (ms) of the last model call: each call reads the cache and renews its validity. */
  lastCallAt?: number;
  /** Cache validity reported by the CLI (Claude Code: 1 h or 5 min). Absent when the CLI doesn't report it. */
  cacheTtlMs?: number;
  /** Model of the last call, as chosen in the app ("" = CLI default). The cache is per model. */
  model?: string;
  /** How much the context grew in the last reply (with no compaction in between). This app run only. */
  turnGrowth?: number;
  window: number | null;
  /** The window came from the CLI (true) or is an estimate from the model name (false). */
  windowKnown?: boolean;
  compacting?: boolean;
  compactions?: number;
  lastCompaction?: { pre?: number; post?: number; trigger?: string; at?: number };
  updatedAt?: number;
}

export interface ChatSession {
  id: string;
  providerId: AIProviderId;
  title: string;
  currentModel: string;
  reasoningEffort: ReasoningEffortLevel;
  permission?: PermissionLevel;
  /** Permission restored after leaving plan mode. */
  permissionBeforePlan?: Exclude<PermissionLevel, "plan">;
  status: "running" | "idle" | "waiting_input" | "error";
  pid?: number;
  createdAt: string;
  lastActive: string;
  cwd: string;
  ptyLog?: string[];
  ptyRaw?: string;
  /** Output of each command or tool, by timeline event id. */
  shellRaw?: Record<string, string>;
  nativeSessionId?: string;
  /** Out of the main list, with its history kept. */
  archived?: boolean;
  /** Last known context, restored on reopening. */
  context?: ContextInfo;
  /** The name was given by the person: the automatic title never replaces it. */
  titleLocked?: boolean;
  /** Last message sent or reply started/finished (ms since epoch): sidebar sort key. */
  lastMessageAt?: number;
}

export interface ModelOption {
  id: string;
  label: string;
  aliases: string[];
  efforts: Array<{
    id: string;
    label: string;
    description?: string;
    nativeModel?: string;
    aliases?: string[];
  }>;
  defaultEffort?: string;
  requiresEffort: boolean;
}
export interface AIProviderStatus {
  id: AIProviderId;
  name: string;
  type: "cli" | "api";
  role: string;
  iconBg: string;
  badgeColor: string;
  installed: boolean;
  cliPath?: string;
  cliVersion?: string;
  quota: {
    window5hPercent: number | null; // 0% to 100% used
    weeklyPercent: number | null; // 0% to 100% of weekly usage
    remainingResetMinutes?: number | null;
    updatedAt?: string | null;
    stale?: boolean;
    weeklyResetAt?: string | null;
    window5hResetAt?: string | null;
    totalTokens?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    cachedTokens?: number | null;
    planType?: string;
    sourceLabel?: string;
    prompts5h?: number;
    prompts7d?: number;
    creditsUsd?: number;
    quotaError?: string | null;
    groupLabel?: string;
    groups?: Array<{
      name: string;
      window5hPercent: number | null;
      weeklyPercent: number | null;
      window5hResetAt?: string;
      weeklyResetAt?: string;
    }>;
  };
  modelsSource?: string;
  modelsUpdatedAt?: string;
  modelsError?: string;
  supportedModels: string[];
  modelOptions?: ModelOption[];
  activeModel?: string;
  mcps: MCPServerInfo[];
  sessions: ChatSession[];
}

export interface AIMemoryStatus {
  installed: boolean;
  cliPath?: string;
  serverRunning: boolean;
  version?: string;
  project?: string;
  workspace?: string;
  totalPages?: number;
  recentObservationsCount?: number;
  sessionsCount?: number;
  embeddingsCount?: number;
  dbSizeBytes?: number;
  serverUrl?: string;
  activeDaemonId: string;
  availableDaemons: AIMemoryDaemonTarget[];
}

export type ChatEventKind =
  | "reasoning"
  | "command"
  | "tool"
  | "mcp"
  | "file"
  | "web"
  | "plan"
  | "agent"
  | "compaction"
  | "status"
  | "step";

/** A step of the reply (reasoning, command, tool…), in the same shape for the three CLIs. */
export interface ChatEvent {
  id: string;
  kind: ChatEventKind;
  title: string;
  detail?: string;
  text?: string;
  status: "running" | "done" | "error";
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  exitCode?: number;
  /** Step done by an agent: the id of the step of the agent that started it. */
  parentId?: string;
  /** Agent data: type, tokens, tools used, last tool. */
  meta?: {
    taskId?: string;
    subagentType?: string;
    tokens?: number;
    toolUses?: number;
    lastTool?: string;
    durationMs?: number;
    model?: string;
    threads?: number;
    /** Note about the step (e.g. the command only shows output when it finishes). */
    note?: string;
    /** Agent started in the background: keeps working after the turn ends. */
    background?: boolean;
    /** A plan the AI proposes for approval (Claude Code ExitPlanMode, Codex plan mode): shown in full. */
    proposal?: boolean;
  };
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  sender: "user" | AIProviderId;
  senderName: string;
  text: string;
  timestamp: string;
  commandSnippet?: string;
  modelBadge?: string;
  reasoningBadge?: ReasoningEffortLevel;
  executionSeconds?: number;
  attachments?: ChatAttachment[];
  embeddedPtyLog?: string[];
  isStreaming?: boolean;
  /** Reply still waiting in the queue: id of the person's message that originated it. */
  queuedFor?: string;
  /**
   * Message already delivered to the CLI mid-reply that the AI hasn't read yet (Claude Code and Codex
   * read it at the next step, after the running command): id of the person's message.
   */
  deliveredFor?: string;
  activity?: string;
  /** Detail of the current activity (command, reasoning excerpt…). */
  detail?: string;
  startedAt?: number;
  /** When the current activity started. */
  activitySince?: number;
  /** Last event received from the CLI, of any kind (including keep-alives). */
  lastEventAt?: number;
  /** Last event that brought real progress (text, step or new activity). */
  lastProgressAt?: number;
  events?: ChatEvent[];
}

export interface VoiceDictationSettings {
  /** "local": Parakeet on this machine (default); "api": an OpenAI-compatible API. */
  engine?: "api" | "local";
  baseUrl?: string;
  model?: string;
  /** ISO code of the spoken language ("pt", "en"…) or "auto". */
  language?: string;
  /** Terms with their own spelling and "wrong => right" replacements, separated by commas or lines. */
  vocabulary?: string;
}

export interface AppSettings {
  configuredSecrets?: Record<string, boolean>;
  securityWarning?: string;
  openRouterApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  /** API key for voice dictation transcription (OpenAI or compatible). */
  transcriptionApiKey?: string;
  customEndpoint?: string;
  voiceDictation?: VoiceDictationSettings;
  defaultProvider: AIProviderId;
  theme: "cream" | "dark" | "system";
  /** Interface language (default: English). */
  language?: "en" | "es" | "pt-BR";
  /** Interface zoom factor (0.7 to 1.6). */
  zoomFactor?: number;
  /** Keep the app in the tray when the window closes (default: on). */
  runInBackground?: boolean;
  /** System pop-ups for pending permissions and new replies with the window out of view (default: on). */
  desktopNotifications?: boolean;
  /** Start with the system, straight to the tray (Linux). */
  launchAtLogin?: boolean;
  /** Closes the tab of a successfully finished command on its own (default: on). */
  shellAutoClose?: boolean;
  /** Seconds since the tab was last on screen (default: 120). */
  shellAutoCloseSeconds?: number;
  /** Context size (tokens) from which the conversation compacts on its own; 0 turns it off (default: 200k). */
  autoCompactTokens?: number | null;
  /** Deletes temporary ai-memory projects idle for more than these days; 0 turns it off (default: 7). */
  aiMemoryTempCleanupDays?: number;
  /** New chats start with the model, level and permission last chosen in the same CLI. */
  rememberSessionChoices?: boolean;
  /** How conversations open: in the BeagleDock chat (default) or in the CLI's own interface. */
  conversationMode?: "chat" | "terminal";
  /** Last choice of model, level and permission for each CLI. */
  lastSessionChoices?: Partial<Record<AIProviderId, { model: string; effort: string; permission: PermissionLevel }>>;
  workspaces: WorkspaceItem[];
}

export interface AppNotification {
  id: string;
  category: "cli_update" | "new_model" | "ai_memory" | "mcp_auth";
  title: string;
  description: string;
  date: string;
  isNew: boolean;
  actionCommand?: string;
  models?: Array<{ id: string; label: string }>;
}

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  path: string;
  category?: string;
  commandSnippet: string;
}

export interface HistorySessionItem {
  id: string;
  /** `beagledock`: conversation saved in BeagleDock; `native`: only exists in the CLI's files. */
  source: "beagledock" | "native";
  provider: AIProviderId;
  providerName: string;
  title: string;
  prompt: string;
  project: string;
  date: string;
  timestampMs: number;
  /** The CLI's native ID, when known. */
  sessionId?: string;
  beagleSessionId?: string;
  closed?: boolean;
  messageCount?: number;
}

export interface UserProfile {
  fullName: string;
  firstName: string;
  email: string;
  initials: string;
}

export interface AIMemoryWikiPage {
  workspace: string;
  project: string;
  path: string;
  title: string;
  snippet?: string;
  body?: string;
  updated_at?: string;
  rank?: number;
}

export interface AIMemoryProjectSummary {
  workspace: string;
  project: string;
  projectId: string;
  pages: number;
  lastUpdated: string;
}

export interface AIMemoryApiResult<T> {
  ok: boolean;
  data?: T;
  status?: number;
  error?: string;
  notFound?: boolean;
  rawText?: string;
}

export interface AIMemoryProject {
  workspace: string;
  project: string;
  projectId: string;
  pageCount: number;
  sessionCount: number;
  observationCount: number;
  openSessionCount: number;
  lastUpdated: string;
  lastActivity: string;
}

export interface AIMemoryPageItem {
  path: string;
  title: string;
  kind: string;
  tier: string;
  updatedAt: string;
}

export interface AIMemoryPageContent extends AIMemoryPageItem {
  workspace?: string;
  project?: string;
  body: string;
  body_markdown?: string;
  pinned?: boolean;
  createdAt?: string;
  frontmatter?: Record<string, unknown>;
  links?: unknown[];
  backlinks?: unknown[];
}

export interface AIMemoryOverview {
  counts: Record<string, number>;
  activity7d: unknown;
  activity30d: unknown;
  lastObservationAt: string;
  pendingHandoffCount: number;
  health: {
    stale: number;
    duplicates: number;
    contradictions: number;
    orphans: number;
    stalePages: Array<{ path: string; title?: string }>;
    duplicatePages: Array<{ path: string; title?: string }>;
    orphanPages: Array<{ path: string; title?: string; kind?: string }>;
  };
}

export interface AIMemoryScope {
  workspace: string;
  project: string;
  source: "marker" | "git" | "folder";
  markerPath: string | null;
  serverOnline: boolean;
  projectExists: boolean;
  pages: number | null;
}
