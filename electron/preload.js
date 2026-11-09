const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("beagleAPI", {
  getGlobalPermissions: () => ipcRenderer.invoke("get-global-permissions"),
  saveGlobalPermissions: (id, changes) =>
    ipcRenderer.invoke("save-global-permissions", id, changes),
  checkCliUpdates: () => ipcRenderer.invoke("check-cli-updates"),
  readNotifications: () => ipcRenderer.invoke("read-notifications"),
  updateCli: (id) => ipcRenderer.invoke("update-cli", id),
  getCliApprovals: () => ipcRenderer.invoke("get-cli-approvals"),
  resolveCliApproval: (id, decision, message, answers) =>
    ipcRenderer.invoke("resolve-cli-approval", id, decision, message, answers),
  setLivePermission: (sessionId, permission) =>
    ipcRenderer.invoke("set-live-permission", sessionId, permission),
  detectTools: () => ipcRenderer.invoke("detect-tools"),
  getAIMemoryStatus: () => ipcRenderer.invoke("ai-memory-status"),
  searchAIMemory: (query, isGlobal = true, workspace = null, project = null) =>
    ipcRenderer.invoke("ai-memory-search", query, isGlobal, workspace, project),
  listAIMemoryPages: (workspace = null, project = null, limit = 50) =>
    ipcRenderer.invoke("ai-memory-list-pages", workspace, project, limit),
  readAIMemoryPage: (pagePath, workspace, project) =>
    ipcRenderer.invoke("ai-memory-read-page", pagePath, workspace, project),
  getAIMemoryScope: (cwd) => ipcRenderer.invoke("ai-memory-scope", cwd),
  listAIMemoryProjects: () => ipcRenderer.invoke("ai-memory-projects"),
  listAIMemoryProjectPages: (ws, p) =>
    ipcRenderer.invoke("ai-memory-project-pages", ws, p),
  getAIMemoryProjectOverview: (ws, p) =>
    ipcRenderer.invoke("ai-memory-project-overview", ws, p),
  listAIMemoryProjectSessions: (ws, p) =>
    ipcRenderer.invoke("ai-memory-project-sessions", ws, p),
  deleteAIMemoryPage: (ws, p, pagePath, confirmProtected) =>
    ipcRenderer.invoke("ai-memory-delete-page", ws, p, pagePath, confirmProtected),
  purgeAIMemoryProject: (ws, p, confirmName) =>
    ipcRenderer.invoke("ai-memory-purge-project", ws, p, confirmName),
  previewAIMemoryTempCleanup: () =>
    ipcRenderer.invoke("ai-memory-temp-cleanup-preview"),
  runAIMemoryTempCleanup: (opts) =>
    ipcRenderer.invoke("ai-memory-temp-cleanup-run", opts),
  setAIMemoryTempCleanupDays: (days) =>
    ipcRenderer.invoke("ai-memory-temp-cleanup-set-days", days),
  getAIMemoryMaintenancePrompt: (opts) =>
    ipcRenderer.invoke("ai-memory-maintenance-prompt", opts),
  getAIMemoryMaintenanceCwd: () =>
    ipcRenderer.invoke("ai-memory-maintenance-cwd"),
  runAIMemoryCommand: (subcmdArgs, cwd) =>
    ipcRenderer.invoke("ai-memory-command", subcmdArgs, cwd),
  getInstalledSkills: () => ipcRenderer.invoke("get-skills"),
  getCliHistory: (query) => ipcRenderer.invoke("get-history", query),
  deleteConversation: (request) =>
    ipcRenderer.invoke("delete-conversation", request),
  loadFullConversation: (provider, sessionId) =>
    ipcRenderer.invoke("load-full-conversation", provider, sessionId),
  getUserProfile: () => ipcRenderer.invoke("get-user-profile"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getSavedState: () => ipcRenderer.invoke("get-saved-state"),
  getSessions: () => ipcRenderer.invoke("get-sessions"),
  saveSession: (session) => ipcRenderer.invoke("save-session", session),
  deleteSession: (sessionId) => ipcRenderer.invoke("delete-session", sessionId),
  compactSession: (id, providerId) =>
    ipcRenderer.invoke("compact-session", id, providerId),
  setSessionArchived: (id, archived) =>
    ipcRenderer.invoke("set-session-archived", id, archived),
  saveWorkspace: (ws) => ipcRenderer.invoke("save-workspace", ws),
  pickDirectory: (options) => ipcRenderer.invoke("pick-directory", options),
  openInEditor: (request) => ipcRenderer.invoke("open-in-editor", request),
  searchProjectFiles: (request) => ipcRenderer.invoke("search-project-files", request),
  listWorkspaceStatus: () => ipcRenderer.invoke("list-workspace-status"),
  updateWorkspace: (request) => ipcRenderer.invoke("update-workspace", request),
  deleteWorkspace: (id) => ipcRenderer.invoke("delete-workspace", id),
  listNativeCommands: (request) => ipcRenderer.invoke("list-native-commands", request),
  openExternalUrl: (url) => ipcRenderer.invoke("open-external-url", url),
  getZoom: () => ipcRenderer.invoke("get-zoom"),
  setZoom: (factor) => ipcRenderer.invoke("set-zoom", factor),
  saveAppSettings: (settingsObj) =>
    ipcRenderer.invoke("save-app-settings", settingsObj),
  transcribeAudio: (request) => ipcRenderer.invoke("transcribe-audio", request),
  getDictationStatus: () => ipcRenderer.invoke("dictation-status"),
  downloadDictationModel: () => ipcRenderer.invoke("download-dictation-model"),
  cancelDictationModelDownload: () =>
    ipcRenderer.invoke("cancel-dictation-model-download"),
  removeDictationModel: () => ipcRenderer.invoke("remove-dictation-model"),
  replaceChatMessages: (id, messages) =>
    ipcRenderer.invoke("replace-chat-messages", id, messages),
  saveChatMessage: (msg) => ipcRenderer.invoke("save-chat-message", msg),
  getLiveTurns: () => ipcRenderer.invoke("get-live-turns"),
  getChatMessages: (sessionId) =>
    ipcRenderer.invoke("get-chat-messages", sessionId),
  ptySpawn: (payload) => ipcRenderer.invoke("pty-spawn", payload),
  ptyWrite: (payload) => ipcRenderer.invoke("pty-write", payload),
  ptyResize: (payload) => ipcRenderer.invoke("pty-resize", payload),
  cliTerminalOpen: (request) => ipcRenderer.invoke("cli-terminal-open", request),
  cliTerminalWrite: (request) => ipcRenderer.invoke("cli-terminal-write", request),
  cliTerminalResize: (request) => ipcRenderer.invoke("cli-terminal-resize", request),
  cliTerminalClose: (sessionId) => ipcRenderer.invoke("cli-terminal-close", sessionId),
  cliTerminalList: () => ipcRenderer.invoke("cli-terminal-list"),
  // Real path of a file dragged into the terminal (the renderer can't see paths).
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || "";
    } catch {
      return "";
    }
  },
  // Ctrl+V in the terminal: with an image, the CLI itself reads the clipboard; with text, it pastes.
  cliTerminalClipboard: () => ipcRenderer.invoke("cli-terminal-clipboard"),
  interruptCliSession: (id) => ipcRenderer.invoke("interrupt-cli-session", id),
  cancelQueuedPrompt: (request) => ipcRenderer.invoke("cancel-queued-prompt", request),
  forceQueuedPrompt: (request) => ipcRenderer.invoke("force-queued-prompt", request),
  answerNowPrompt: (request) => ipcRenderer.invoke("answer-now-prompt", request),
  executeCliPrompt: (payload) =>
    ipcRenderer.invoke("execute-cli-prompt", payload),
  // Phone access over the local network.
  getRemoteAccessStatus: () => ipcRenderer.invoke("remote-access-status"),
  setRemoteAccessPort: (port) => ipcRenderer.invoke("remote-access-set-port", port),
  setRemoteAccessEnabled: (enabled) =>
    ipcRenderer.invoke("remote-access-set-enabled", enabled),
  startRemotePairing: () => ipcRenderer.invoke("remote-access-start-pairing"),
  cancelRemotePairing: () => ipcRenderer.invoke("remote-access-cancel-pairing"),
  revokeRemoteDevice: (id) => ipcRenderer.invoke("remote-access-revoke", id),

  on: (channel, callback) => {
    if (
      ![
        "tools-update",
        "pty-data",
        "pty-exit",
        "cli-terminal-opened",
        "cli-terminal-data",
        "cli-terminal-exit",
        "cli-terminal-closed",
        "cli-terminal-history",
        "cli-terminal-state",
        "cli-stream-chunk",
        "cli-activity-event",
        "cli-context",
        "cli-turn-started",
        "cli-turn-finished",
        "cli-notice",
        "cli-permission-changed",
        "open-session",
        "cli-approvals",
        "dictation-model-progress",
        "remote-access-status",
        "chat-sync",
        "live-turns",
      ].includes(channel)
    )
      throw new Error("Event not allowed.");
    const subscription = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
});
