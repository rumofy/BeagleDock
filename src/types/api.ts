import type {
  AIMemoryApiResult,
  AIMemoryPageContent,
  AIMemoryPageItem,
  AIMemoryProject,
  AIMemoryScope,
  AIProviderId,
  AppNotification,
  AppSettings,
  ChatMessage,
  ChatSession,
  HistorySessionItem,
  SkillItem,
  UserProfile,
  WorkspaceItem,
  AIProviderStatus,
} from "./index";

export interface CliApproval {
  id: string;
  sessionId: string;
  providerId: AIProviderId;
  tool: string;
  input: string;
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
  prompt: string;
  cwd: string;
  model: string;
  effort: string;
  permission: string;
  cancelled: boolean;
}
export interface ExecutePromptResult {
  ok?: boolean;
  cancelled?: boolean;
  stopped?: boolean;
  output?: string;
  error?: string;
  nativeSessionId?: string;
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
  "pty-data": { sessionId: string; data: string; pid?: number };
  "pty-exit": { sessionId: string; [key: string]: unknown };
  "cli-stream-chunk": {
    sessionId: string;
    responseMessageId?: string;
    chunk: string;
    fullText?: string;
    activity?: string;
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
  resolveCliApproval(id: string, decision: "allow" | "deny"): Promise<unknown>;
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
  getCliHistory(): Promise<HistorySessionItem[]>;
  loadFullConversation(provider: AIProviderId, sessionId?: string): Promise<FullConversation>;
  getUserProfile(): Promise<UserProfile>;
  getAppVersion(): Promise<string>;
  getSavedState(): Promise<SavedState>;
  saveSession(session: ChatSession): Promise<OkResult>;
  deleteSession(sessionId: string): Promise<OkResult>;
  saveWorkspace(workspace: WorkspaceItem): Promise<WorkspaceItem & OkResult>;
  saveAppSettings(settings: AppSettings): Promise<SaveSettingsResult>;
  replaceChatMessages(id: string, messages: Array<ChatMessage & { provider?: string }>): Promise<OkResult>;
  saveChatMessage(message: ChatMessage & { provider?: string }): Promise<OkResult>;
  getChatMessages(sessionId: string): Promise<ChatMessage[]>;
  ptySpawn(payload: PtyPayload): Promise<unknown>;
  ptyWrite(payload: PtyPayload): Promise<unknown>;
  ptyResize(payload: PtyPayload): Promise<unknown>;
  interruptCliSession(id: string): Promise<OkResult>;
  executeCliPrompt(payload: ExecutePromptPayload): Promise<ExecutePromptResult>;
  on<K extends keyof StreamEvents>(channel: K, callback: (payload: StreamEvents[K]) => void): () => void;
}

declare global {
  interface Window {
    beagleAPI?: BeagleAPI;
  }
}
