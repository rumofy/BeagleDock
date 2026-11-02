const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("beagleAPI", {
  getGlobalPermissions: () => ipcRenderer.invoke("get-global-permissions"),
  saveGlobalPermissions: (id, changes) =>
    ipcRenderer.invoke("save-global-permissions", id, changes),
  checkCliUpdates: () => ipcRenderer.invoke("check-cli-updates"),
  readNotifications: () => ipcRenderer.invoke("read-notifications"),
  updateCli: (id) => ipcRenderer.invoke("update-cli", id),
  getCliApprovals: () => ipcRenderer.invoke("get-cli-approvals"),
  resolveCliApproval: (id, decision, message) =>
    ipcRenderer.invoke("resolve-cli-approval", id, decision, message),
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
  getAIMemoryMaintenancePrompt: (opts) =>
    ipcRenderer.invoke("ai-memory-maintenance-prompt", opts),
  getAIMemoryMaintenanceCwd: () =>
    ipcRenderer.invoke("ai-memory-maintenance-cwd"),
  runAIMemoryCommand: (subcmdArgs, cwd) =>
    ipcRenderer.invoke("ai-memory-command", subcmdArgs, cwd),
  getInstalledSkills: () => ipcRenderer.invoke("get-skills"),
  getCliHistory: () => ipcRenderer.invoke("get-history"),
  loadFullConversation: (provider, sessionId) =>
    ipcRenderer.invoke("load-full-conversation", provider, sessionId),
  getUserProfile: () => ipcRenderer.invoke("get-user-profile"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getSavedState: () => ipcRenderer.invoke("get-saved-state"),
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
  replaceChatMessages: (id, messages) =>
    ipcRenderer.invoke("replace-chat-messages", id, messages),
  saveChatMessage: (msg) => ipcRenderer.invoke("save-chat-message", msg),
  getChatMessages: (sessionId) =>
    ipcRenderer.invoke("get-chat-messages", sessionId),
  ptySpawn: (payload) => ipcRenderer.invoke("pty-spawn", payload),
  ptyWrite: (payload) => ipcRenderer.invoke("pty-write", payload),
  ptyResize: (payload) => ipcRenderer.invoke("pty-resize", payload),
  interruptCliSession: (id) => ipcRenderer.invoke("interrupt-cli-session", id),
  cancelQueuedPrompt: (request) => ipcRenderer.invoke("cancel-queued-prompt", request),
  forceQueuedPrompt: (request) => ipcRenderer.invoke("force-queued-prompt", request),
  executeCliPrompt: (payload) =>
    ipcRenderer.invoke("execute-cli-prompt", payload),
  on: (channel, callback) => {
    if (
      ![
        "tools-update",
        "pty-data",
        "pty-exit",
        "cli-stream-chunk",
        "cli-activity-event",
        "cli-context",
        "cli-turn-started",
        "cli-turn-finished",
        "cli-notice",
        "open-session",
        "cli-approvals",
      ].includes(channel)
    )
      throw new Error("Evento não permitido.");
    const subscription = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
});
