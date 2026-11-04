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

export interface TranscribeAudioRequest {
  /** Mono WAV in base64. */
  audio: string;
  /** Terms from the current session (project, files) that help the model spell things right. */
  context?: string[];
}

export interface TranscribeAudioResult {
  success: boolean;
  error?: string;
  /** "SPEECH_MODEL_MISSING" when the local model hasn't been downloaded yet. */
  code?: string;
  text?: string;
  engine?: "api" | "local";
  model?: string;
}

export interface DictationModelStatus {
  id: string;
  label: string;
  /** Download size in bytes. */
  size: number;
  installed: boolean;
  downloading: boolean;
  received: number;
}

export interface DictationStatus {
  engine: "api" | "local";
  model: DictationModelStatus;
  /** The local engine (parakeet-cli) was built and is in the package. */
  engineAvailable: boolean;
}

export interface DictationModelProgress {
  id: string;
  received: number;
  total: number;
  done: boolean;
  error?: string;
}

/** A choice offered by the CLI itself for a permission request. */
export interface ApprovalOption {
  id: string;
  label: string;
  kind: "allow" | "deny";
  description?: string;
  /** The choice saves a rule that applies beyond this action (project, session…). */
  persistent?: boolean;
  danger?: boolean;
  /** Accepts an instruction for the AI along with the denial. */
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
  /** Absent = a tool permission. A plan or question is a decision, never auto-approved. */
  kind?: "plan" | "question";
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
  /** User message that originated this send; moves the history if it is delivered in the middle of a reply. */
  userMessageId?: string;
  prompt: string;
  cwd: string;
  model: string;
  effort: string;
  permission: string;
  cancelled: boolean;
  /** Attached images and files, as data URLs; the backend stores and normalizes them for each CLI. */
  attachments?: ChatAttachment[];
}
export interface NativeCommand {
  name: string;
  /** `app`: a BeagleDock control, shown when the CLI doesn't list its commands. */
  kind: "command" | "skill" | "app";
  description?: string;
  aliases?: string[];
  /** Only exists in the CLI's interactive terminal. */
  terminalOnly?: boolean;
}
export interface NativeCommandList {
  ok: boolean;
  providerId: string;
  commands: NativeCommand[];
  /** State reported by the CLI itself (current model and permission mode). */
  state?: { model?: string; permissionMode?: string };
  /** What the CLI doesn't expose, so the interface warns instead of faking it. */
  limitation?: string;
  error?: string;
}
export interface OpenInEditorRequest {
  /** Project folder of the conversation. */
  cwd: string;
  /** File or folder relative to the project; without a target the whole project opens. */
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
  /** The CLI received the message during the running execution (no reply of its own). */
  injected?: boolean;
  /** Reply that was being written when the message was delivered. */
  rotatedFrom?: string;
  /** Replies to the messages delivered during the execution, in order (empty text = no reply). */
  followUps?: { responseMessageId: string; text: string; events?: ChatEvent[] }[];
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

export interface CliTerminalInfo {
  sessionId: string;
  providerId: AIProviderId;
  cwd: string;
  pid: number;
  /** Opened by resuming the native conversation (not a new CLI conversation). */
  resumed: boolean;
  exited: boolean;
  exitCode: number | null;
  /** Total characters already emitted by the terminal. */
  end: number;
}
export type CliTerminalOpenResult =
  | ({ ok: true; replay: string } & CliTerminalInfo)
  | { ok: false; error: string };

export interface StreamEvents {
  "tools-update": ToolsUpdate;
  "pty-data": { sessionId: string; data: string; pid?: number; shellId?: string };
  "pty-exit": { sessionId: string; [key: string]: unknown };
  /** CLI screen open in terminal mode (raw pty output). */
  "cli-terminal-data": { sessionId: string; data: string; end: number };
  "cli-terminal-exit": { sessionId: string; exitCode: number | null };
  "cli-terminal-history": { sessionId: string; added: number };
  /** Backend request (tray, notification) to open a conversation. */
  "open-session": { sessionId: string };
  /** Backend notice about the send (e.g. the CLI has no native field for the attachment). */
  "cli-notice": { sessionId: string; responseMessageId?: string; message: string };
  /** The CLI itself changed the conversation's level (e.g. the plan was approved and it left plan mode). */
  "cli-permission-changed": { sessionId: string; permission: PermissionLevel; reason?: string };
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
  "dictation-model-progress": DictationModelProgress;
}

/** Surface exposed by the preload (`window.beagleAPI`). */
export interface BeagleAPI {
  getGlobalPermissions(): Promise<GlobalPolicy[]>;
  saveGlobalPermissions(id: string, changes: Record<string, string>): Promise<GlobalPolicy>;
  checkCliUpdates(): Promise<ToolsUpdate>;
  readNotifications(): Promise<UpdateInfo>;
  updateCli(id: string): Promise<{ ok: boolean; version?: string | null; error?: string }>;
  getCliApprovals(): Promise<CliApproval[]>;
  /** `decision`: "allow" | "deny" or the id of an offered option; `message` goes with a denial. */
  resolveCliApproval(id: string, decision: string, message?: string): Promise<unknown>;
  /**
   * Changes the conversation's permission level with the CLI open. `applied`: "now" (the running CLI
   * already uses the new level) or "next" (applies from the next message); `approved` = pending
   * approvals released when switching to "Full access" (plans and questions are never released).
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
  previewAIMemoryTempCleanup(): Promise<AIMemoryTempCleanupPreview>;
  runAIMemoryTempCleanup(opts?: { all?: boolean }): Promise<AIMemoryTempCleanupResult>;
  setAIMemoryTempCleanupDays(days: number): Promise<{ ok: boolean; days?: number; error?: string }>;
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
  /** Opens an http(s) address in the system's default browser. */
  openExternalUrl(url: string): Promise<OkResult>;
  /** Commands and skills read from the CLI itself (`refresh` skips the short cache). */
  listNativeCommands(request: { providerId: string; cwd: string; refresh?: boolean }): Promise<NativeCommandList>;
  getZoom(): Promise<number>;
  setZoom(factor: number): Promise<number>;
  saveAppSettings(settings: AppSettings): Promise<SaveSettingsResult>;
  /** Transcribes a microphone recording (base64 WAV) with the configured engine. */
  transcribeAudio(request: TranscribeAudioRequest): Promise<TranscribeAudioResult>;
  getDictationStatus(): Promise<DictationStatus>;
  /** Downloads the local voice model (progress in `dictation-model-progress`). */
  downloadDictationModel(): Promise<{ success: boolean; error?: string; model?: DictationModelStatus }>;
  cancelDictationModelDownload(): Promise<OkResult>;
  removeDictationModel(): Promise<{ success: boolean; error?: string; model?: DictationModelStatus }>;
  replaceChatMessages(id: string, messages: Array<ChatMessage & { provider?: string }>): Promise<OkResult>;
  saveChatMessage(message: ChatMessage & { provider?: string }): Promise<OkResult>;
  getChatMessages(sessionId: string): Promise<ChatMessage[]>;
  ptySpawn(payload: PtyPayload): Promise<unknown>;
  ptyWrite(payload: PtyPayload): Promise<unknown>;
  ptyResize(payload: PtyPayload): Promise<unknown>;
  /** Opens (or reconnects) this conversation's own CLI interface in a terminal. */
  cliTerminalOpen(request: {
    sessionId: string;
    providerId: AIProviderId;
    cwd: string;
    cols?: number;
    rows?: number;
  }): Promise<CliTerminalOpenResult>;
  cliTerminalWrite(request: { sessionId: string; data: string }): Promise<{ ok: boolean }>;
  cliTerminalResize(request: { sessionId: string; cols: number; rows: number }): Promise<{ ok: boolean }>;
  cliTerminalClose(sessionId: string): Promise<{ ok: boolean }>;
  cliTerminalList(): Promise<CliTerminalInfo[]>;
  /** Clipboard content for the terminal's Ctrl+V. */
  cliTerminalClipboard(): Promise<{ image: boolean; text: string }>;
  /** Disk path of a dragged file (Electron only). */
  pathForFile?(file: File): string;
  interruptCliSession(id: string): Promise<OkResult>;
  /** Removes from the queue a message the CLI hasn't received yet (also deletes the saved message). */
  cancelQueuedPrompt(request: QueuedPromptRequest): Promise<OkResult>;
  /** Interrupts the current execution so the queued message is sent next. */
  forceQueuedPrompt(request: QueuedPromptRequest): Promise<OkResult>;
  /**
   * A delivered message the CLI hasn't read yet: `background` sends the running command to the
   * background (Claude Code); `interrupt` stops the current step. Codex: interrupts and resends.
   */
  answerNowPrompt(
    request: QueuedPromptRequest & { providerId: AIProviderId; mode: "background" | "interrupt" },
  ): Promise<OkResult & { mode?: "background" | "interrupt" }>;
  executeCliPrompt(payload: ExecutePromptPayload): Promise<ExecutePromptResult>;
  on<K extends keyof StreamEvents>(channel: K, callback: (payload: StreamEvents[K]) => void): () => void;
}

declare global {
  interface Window {
    beagleAPI?: BeagleAPI;
  }
}

/** ai-memory project whose sessions all came from a temporary folder. */
export interface AIMemoryTempProject {
  workspace: string;
  project: string;
  sessionCount: number;
  pageCount: number;
  lastSeen: string | null;
  /** Idle for more days than the configured limit: it will be deleted in the next cleanup. */
  stale: boolean;
  folders: string[];
}
export interface AIMemoryTempCleanupPreview {
  ok: boolean;
  error?: string;
  /** Limit in days; 0 turns off the automatic cleanup. */
  days?: number;
  lastRun?: { at: string; removed: number; failed: number } | null;
  projects?: AIMemoryTempProject[];
}
export interface AIMemoryTempCleanupResult {
  ok: boolean;
  error?: string;
  days?: number;
  removed?: string[];
  failed?: { name: string; error: string }[];
  skipped?: string;
}
