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

/** Cadastro mais o estado atual da pasta no disco, para a tela de manutenção. */
export interface WorkspaceStatus extends WorkspaceItem {
  exists: boolean;
  isGitRepo: boolean;
  conversations: number;
}

/** Quanto da janela de contexto do modelo está ocupado (e a última compactação). */
export interface ContextInfo {
  source?: string;
  used: number | null;
  /** Cache de prompt da última chamada: lido (barato) e escrito (caro, cache expirado ou prefixo novo). */
  cache?: { read?: number; write?: number };
  /** Horário (ms) da última chamada ao modelo: cada chamada lê o cache e renova sua validade. */
  lastCallAt?: number;
  /** Validade do cache informada pela CLI (Claude Code: 1 h ou 5 min). Ausente quando a CLI não informa. */
  cacheTtlMs?: number;
  /** Modelo da última chamada, como escolhido no app ("" = padrão da CLI). O cache é por modelo. */
  model?: string;
  /** Quanto o contexto cresceu na última resposta (sem compactação no meio). Só desta execução do app. */
  turnGrowth?: number;
  window: number | null;
  /** A janela veio da CLI (true) ou é uma estimativa pelo nome do modelo (false). */
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
  status: "running" | "idle" | "waiting_input" | "error";
  pid?: number;
  createdAt: string;
  lastActive: string;
  cwd: string;
  ptyLog?: string[];
  ptyRaw?: string;
  /** Saída de cada comando ou ferramenta, por id do evento da linha do tempo. */
  shellRaw?: Record<string, string>;
  nativeSessionId?: string;
  /** Fora da lista principal, com o histórico preservado. */
  archived?: boolean;
  /** Último contexto conhecido, restaurado ao reabrir. */
  context?: ContextInfo;
  /** O nome foi dado pela pessoa: o título automático nunca o substitui. */
  titleLocked?: boolean;
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
    window5hPercent: number | null; // 0% a 100% de uso
    weeklyPercent: number | null; // 0% a 100% de uso semanal
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

/** Uma etapa da resposta (raciocínio, comando, ferramenta…), no mesmo formato para as três CLIs. */
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
  /** Etapa feita por um agente: o id da etapa do agente que a lançou. */
  parentId?: string;
  /** Dados do agente: tipo, tokens, ferramentas usadas, última ferramenta. */
  meta?: {
    taskId?: string;
    subagentType?: string;
    tokens?: number;
    toolUses?: number;
    lastTool?: string;
    durationMs?: number;
    model?: string;
    threads?: number;
    /** Aviso sobre a etapa (ex.: o comando só mostra a saída ao terminar). */
    note?: string;
    /** Agente lançado em segundo plano: segue trabalhando depois do fim do turno. */
    background?: boolean;
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
  /** Resposta que ainda espera na fila: id da mensagem da pessoa que a originou. */
  queuedFor?: string;
  activity?: string;
  /** Complemento da atividade atual (comando, trecho do raciocínio…). */
  detail?: string;
  startedAt?: number;
  /** Quando a atividade atual começou. */
  activitySince?: number;
  /** Último evento recebido da CLI, de qualquer tipo (inclusive sinal de vida). */
  lastEventAt?: number;
  /** Último evento que trouxe progresso real (texto, etapa ou atividade nova). */
  lastProgressAt?: number;
  events?: ChatEvent[];
}

export interface VoiceDictationSettings {
  /** "local": Parakeet na própria máquina (padrão); "api": API compatível com OpenAI. */
  engine?: "api" | "local";
  baseUrl?: string;
  model?: string;
  /** Código ISO do idioma falado ("pt", "en"…) ou "auto". */
  language?: string;
  /** Termos com grafia própria e trocas "errado => certo", separados por vírgula ou linha. */
  vocabulary?: string;
}

export interface AppSettings {
  configuredSecrets?: Record<string, boolean>;
  securityWarning?: string;
  openRouterApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  /** Chave da API de transcrição do ditado por voz (OpenAI ou compatível). */
  transcriptionApiKey?: string;
  customEndpoint?: string;
  voiceDictation?: VoiceDictationSettings;
  defaultProvider: AIProviderId;
  theme: "cream" | "dark" | "system";
  /** Fator de zoom da interface (0,7 a 1,6). */
  zoomFactor?: number;
  /** Manter o app na bandeja ao fechar a janela (padrão: ligado). */
  runInBackground?: boolean;
  /** Iniciar junto com o sistema, já na bandeja (Linux). */
  launchAtLogin?: boolean;
  /** Fecha sozinha a aba de um comando concluído com sucesso (padrão: ligado). */
  shellAutoClose?: boolean;
  /** Segundos desde a última vez que a aba esteve na tela (padrão: 120). */
  shellAutoCloseSeconds?: number;
  /** Contexto (em tokens) a partir do qual a conversa é compactada sozinha; 0 desliga (padrão: 200 mil). */
  autoCompactTokens?: number | null;
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
  /** `beagledock`: conversa salva no BeagleDock; `native`: só existe nos arquivos da CLI. */
  source: "beagledock" | "native";
  provider: AIProviderId;
  providerName: string;
  title: string;
  prompt: string;
  project: string;
  date: string;
  timestampMs: number;
  /** ID nativo da CLI, quando conhecido. */
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
