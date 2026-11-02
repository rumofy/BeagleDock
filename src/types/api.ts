import type {
  AIMemoryApiResult,
  AIMemoryPageContent,
  AIMemoryPageItem,
  AIMemoryProject,
  AIMemoryScope,
  AIProviderId,
  AppNotification,
  AppSettings,
  ChatAttachment,
  ChatEvent,
  ChatMessage,
  PermissionLevel,
  ContextInfo,
  ChatSession,
  HistorySessionItem,
  SkillItem,
  UserProfile,
  WorkspaceItem,
  WorkspaceStatus,
  AIProviderStatus,
} from "./index";

/** Uma escolha oferecida pela própria CLI para um pedido de permissão. */
export interface ApprovalOption {
  id: string;
  label: string;
  kind: "allow" | "deny";
  description?: string;
  /** A escolha grava uma regra que vale além desta ação (projeto, sessão…). */
  persistent?: boolean;
  danger?: boolean;
  /** Aceita uma instrução para a IA junto da negação. */
  allowsMessage?: boolean;
}

export interface LivePermissionResult {
  ok: boolean;
  applied?: "now" | "next";
  approved?: number;
  error?: string;
}

export interface CliApproval {
  id: string;
  sessionId: string;
  providerId: AIProviderId;
  tool: string;
  input: string;
  options: ApprovalOption[];
}

export interface GlobalPolicyField {
  key: string;
  label?: string;
  [key: string]: any;
}
export interface GlobalPolicy {
  providerId: AIProviderId;
  [key: string]: any;
}

export interface UpdateInfo {
  notifications?: AppNotification[];
  releases?: Record<string, { version?: string; error?: string | null }>;
  checkedAt?: string | null;
}

export interface ToolInfo {
  installed?: boolean;
  path?: string;
  version?: string;
  modelOptions?: AIProviderStatus["modelOptions"];
  models?: string[];
  activeModel?: string;
  modelsSource?: string;
  modelsUpdatedAt?: string;
  modelsError?: string;
  mcps?: AIProviderStatus["mcps"];
}

export interface ToolsUpdate {
  tools?: Record<string, ToolInfo | undefined>;
  quotas?: Record<string, AIProviderStatus["quota"] | undefined>;
  updates?: UpdateInfo;
}

export interface SavedState {
  sessions?: ChatSession[];
  messagesBySession?: Record<string, ChatMessage[]>;
  workspaces?: WorkspaceItem[];
  settings?: Partial<AppSettings>;
  error?: string;
}

export interface QueuedPromptRequest {
  sessionId: string;
  responseMessageId: string;
  userMessageId: string;
}

export interface OkResult {
  success?: boolean;
  ok?: boolean;
  error?: string;
}

export interface SaveSettingsResult extends OkResult {
  settings: AppSettings;
}

export interface FullConversation {
  error?: string;
  messages?: ChatMessage[];
  model?: string;
  nativeSessionId?: string;
  cwd: string;
}

export interface ExecutePromptPayload {
  sessionId: string;
  providerId: AIProviderId;
  responseMessageId: string;
  /** Mensagem do usuário que originou este envio; reposiciona o histórico se ela for entregue no meio de uma resposta. */
  userMessageId?: string;
  prompt: string;
  cwd: string;
  model: string;
  effort: string;
  permission: string;
  cancelled: boolean;
  /** Imagens e arquivos anexados, como data URL; o backend os grava e normaliza para cada CLI. */
  attachments?: ChatAttachment[];
}
export interface NativeCommand {
  name: string;
  /** `app`: controle do próprio BeagleDock, mostrado quando a CLI não lista os comandos dela. */
  kind: "command" | "skill" | "app";
  description?: string;
  aliases?: string[];
  /** Só existe no terminal interativo da CLI. */
  terminalOnly?: boolean;
}
export interface NativeCommandList {
  ok: boolean;
  providerId: string;
  commands: NativeCommand[];
  /** Estado informado pela própria CLI (modelo e modo de permissão atuais). */
  state?: { model?: string; permissionMode?: string };
  /** O que a CLI não expõe, para a interface avisar em vez de simular. */
  limitation?: string;
  error?: string;
}
export interface OpenInEditorRequest {
  /** Pasta do projeto da conversa. */
  cwd: string;
  /** Arquivo ou pasta, relativo ao projeto; sem alvo abre o projeto inteiro. */
  target?: string;
  line?: number;
  column?: number;
}

export interface PickDirectoryResult {
  canceled: boolean;
  error?: string;
  path?: string;
  name?: string;
  hasAIMemory?: boolean;
  isGitRepo?: boolean;
}

export interface ExecutePromptResult {
  ok?: boolean;
  cancelled?: boolean;
  stopped?: boolean;
  /** A CLI recebeu a mensagem no meio da execução em andamento (não gerou resposta própria). */
  injected?: boolean;
  /** Resposta que estava sendo escrita quando a mensagem foi entregue. */
  rotatedFrom?: string;
  /** Respostas às mensagens entregues no meio da execução, na ordem (texto vazio = sem resposta). */
  followUps?: { responseMessageId: string; text: string }[];
  output?: string;
  error?: string;
  nativeSessionId?: string;
  events?: ChatEvent[];
}

export interface AIMemoryStatusResult {
  running?: boolean;
  cliPath?: string;
  data?: {
    version?: string;
    server_url?: string;
    serverUrl?: string;
    counts?: { pages_latest?: number; observations?: number };
  };
}

export interface AIMemoryCommandResult {
  ok?: boolean;
  error?: string;
  rawText?: string;
}

export interface MaintenancePromptOptions {
  workspace: string;
  project: string;
  mode: "plan" | "execute";
  maxDeletions: number;
}

export type PtyPayload = Record<string, unknown>;

export interface StreamEvents {
  "tools-update": ToolsUpdate;
  "pty-data": { sessionId: string; data: string; pid?: number; shellId?: string };
  "pty-exit": { sessionId: string; [key: string]: unknown };
  /** Pedido do backend (bandeja, notificação) para abrir uma conversa. */
  "open-session": { sessionId: string };
  /** Aviso do backend sobre o envio (ex.: a CLI não tem campo nativo para o anexo). */
  "cli-notice": { sessionId: string; responseMessageId?: string; message: string };
  "cli-stream-chunk": {
    sessionId: string;
    responseMessageId?: string;
    chunk?: string;
    fullText?: string;
    activity?: string;
    detail?: string;
    emittedAt?: number;
  };
  "cli-context": ContextInfo & { sessionId: string };
  "cli-turn-started": {
    sessionId: string;
    responseMessageId: string;
    providerId: AIProviderId;
    model?: string;
  };
  "cli-turn-finished": {
    sessionId: string;
    responseMessageId: string;
    providerId: AIProviderId;
    ok: boolean;
    text: string;
    error?: string;
    events?: ChatEvent[];
    model?: string;
    discard?: boolean;
    context?: ContextInfo;
  };
  "cli-activity-event": {
    sessionId: string;
    responseMessageId?: string;
    event: ChatEvent;
    emittedAt?: number;
  };
  "cli-approvals": CliApproval[];
}

/** Superfície exposta pelo preload (`window.beagleAPI`). */
export interface BeagleAPI {
  getGlobalPermissions(): Promise<GlobalPolicy[]>;
  saveGlobalPermissions(id: string, changes: Record<string, string>): Promise<GlobalPolicy>;
  checkCliUpdates(): Promise<ToolsUpdate>;
  readNotifications(): Promise<UpdateInfo>;
  updateCli(id: string): Promise<{ ok: boolean; version?: string | null; error?: string }>;
  getCliApprovals(): Promise<CliApproval[]>;
  /** `decision`: "allow" | "deny" ou o id de uma opção oferecida; `message` acompanha uma negação. */
  resolveCliApproval(id: string, decision: string, message?: string): Promise<unknown>;
  /**
   * Troca o nível de permissão da conversa com a CLI aberta. `applied`: "now" (a CLI em execução já
   * usa o novo nível) ou "next" (vale a partir da próxima mensagem); `approved` = aprovações
   * pendentes liberadas ao passar para "Acesso total".
   */
  setLivePermission(sessionId: string, permission: PermissionLevel): Promise<LivePermissionResult>;
  detectTools(): Promise<ToolsUpdate>;
  getAIMemoryStatus(): Promise<AIMemoryStatusResult>;
  searchAIMemory(query: string, isGlobal?: boolean, workspace?: string | null, project?: string | null): Promise<AIMemoryApiResult<any>>;
  listAIMemoryPages(workspace?: string | null, project?: string | null, limit?: number): Promise<AIMemoryApiResult<any>>;
  readAIMemoryPage(pagePath: string, workspace: string, project: string): Promise<AIMemoryApiResult<AIMemoryPageContent>>;
  getAIMemoryScope(cwd: string): Promise<AIMemoryScope>;
  listAIMemoryProjects(): Promise<AIMemoryApiResult<AIMemoryProject[]>>;
  listAIMemoryProjectPages(workspace: string, project: string): Promise<AIMemoryApiResult<AIMemoryPageItem[]>>;
  getAIMemoryProjectOverview(workspace: string, project: string): Promise<AIMemoryApiResult<any>>;
  listAIMemoryProjectSessions(workspace: string, project: string): Promise<AIMemoryApiResult<any>>;
  deleteAIMemoryPage(workspace: string, project: string, pagePath: string, confirmProtected?: string): Promise<AIMemoryApiResult<any>>;
  purgeAIMemoryProject(workspace: string, project: string, confirmName: string): Promise<AIMemoryApiResult<any>>;
  getAIMemoryMaintenancePrompt(opts: MaintenancePromptOptions): Promise<string>;
  getAIMemoryMaintenanceCwd(): Promise<string>;
  runAIMemoryCommand(subcmdArgs: string[], cwd?: string): Promise<AIMemoryCommandResult>;
  getInstalledSkills(): Promise<SkillItem[]>;
  getCliHistory(query?: string): Promise<HistorySessionItem[]>;
  deleteConversation(request: {
    provider: AIProviderId;
    beagleSessionId?: string;
    nativeId?: string;
  }): Promise<OkResult & { success?: boolean; removedFiles?: number }>;
  loadFullConversation(provider: AIProviderId, sessionId?: string): Promise<FullConversation>;
  getUserProfile(): Promise<UserProfile>;
  getAppVersion(): Promise<string>;
  getSavedState(): Promise<SavedState>;
  saveSession(session: ChatSession): Promise<OkResult>;
  deleteSession(sessionId: string): Promise<OkResult>;
  saveWorkspace(workspace: WorkspaceItem): Promise<WorkspaceItem & OkResult>;
  compactSession(id: string, providerId: string): Promise<OkResult>;
  setSessionArchived(id: string, archived: boolean): Promise<OkResult & { success?: boolean }>;
  pickDirectory(options?: { defaultPath?: string; title?: string }): Promise<PickDirectoryResult>;
  openInEditor(request: OpenInEditorRequest): Promise<OkResult>;
  searchProjectFiles(request: { cwd: string; query: string }): Promise<{ success: boolean; error?: string; files: string[] }>;
  listWorkspaceStatus(): Promise<{ success: boolean; error?: string; workspaces: WorkspaceStatus[] }>;
  updateWorkspace(request: { id: string; name: string; path: string }): Promise<{ success: boolean; error?: string; workspace?: WorkspaceItem }>;
  deleteWorkspace(id: string): Promise<{ success: boolean; error?: string; removed?: boolean }>;
  /** Abre um endereço http(s) no navegador padrão do sistema. */
  openExternalUrl(url: string): Promise<OkResult>;
  /** Comandos e skills lidos da própria CLI (`refresh` ignora o cache curto). */
  listNativeCommands(request: { providerId: string; cwd: string; refresh?: boolean }): Promise<NativeCommandList>;
  getZoom(): Promise<number>;
  setZoom(factor: number): Promise<number>;
  saveAppSettings(settings: AppSettings): Promise<SaveSettingsResult>;
  replaceChatMessages(id: string, messages: Array<ChatMessage & { provider?: string }>): Promise<OkResult>;
  saveChatMessage(message: ChatMessage & { provider?: string }): Promise<OkResult>;
  getChatMessages(sessionId: string): Promise<ChatMessage[]>;
  ptySpawn(payload: PtyPayload): Promise<unknown>;
  ptyWrite(payload: PtyPayload): Promise<unknown>;
  ptyResize(payload: PtyPayload): Promise<unknown>;
  interruptCliSession(id: string): Promise<OkResult>;
  /** Tira da fila uma mensagem que a CLI ainda não recebeu (apaga também a mensagem salva). */
  cancelQueuedPrompt(request: QueuedPromptRequest): Promise<OkResult>;
  /** Interrompe a execução atual para a mensagem da fila ser enviada em seguida. */
  forceQueuedPrompt(request: QueuedPromptRequest): Promise<OkResult>;
  executeCliPrompt(payload: ExecutePromptPayload): Promise<ExecutePromptResult>;
  on<K extends keyof StreamEvents>(channel: K, callback: (payload: StreamEvents[K]) => void): () => void;
}

declare global {
  interface Window {
    beagleAPI?: BeagleAPI;
  }
}
