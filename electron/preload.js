const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("capyAPI", {
  getGlobalPermissions: () => ipcRenderer.invoke("get-global-permissions"),
  saveGlobalPermissions: (id, changes) =>
    ipcRenderer.invoke("save-global-permissions", id, changes),
  checkCliUpdates: () => ipcRenderer.invoke("check-cli-updates"),
  readNotifications: () => ipcRenderer.invoke("read-notifications"),
  updateCli: (id) => ipcRenderer.invoke("update-cli", id),
  getCliApprovals: () => ipcRenderer.invoke("get-cli-approvals"),
  resolveCliApproval: (id, decision) =>
    ipcRenderer.invoke("resolve-cli-approval", id, decision),
  detectTools: () => ipcRenderer.invoke("detect-tools"),
  getAIMemoryStatus: () => ipcRenderer.invoke("ai-memory-status"),
  searchAIMemory: (query, isGlobal = true, workspace = null, project = null) =>
    ipcRenderer.invoke("ai-memory-search", query, isGlobal, workspace, project),
  listAIMemoryPages: (workspace = null, project = null, limit = 50) =>
    ipcRenderer.invoke("ai-memory-list-pages", workspace, project, limit),
  readAIMemoryPage: (pagePath, workspace, project) =>
    ipcRenderer.invoke("ai-memory-read-page", pagePath, workspace, project),
  runAIMemoryCommand: (subcmdArgs, cwd) =>
    ipcRenderer.invoke("ai-memory-command", subcmdArgs, cwd),
  getInstalledSkills: () => ipcRenderer.invoke("get-skills"),
  getCliHistory: () => ipcRenderer.invoke("get-history"),
  loadFullConversation: (provider, sessionId) =>
    ipcRenderer.invoke("load-full-conversation", provider, sessionId),
  getUserProfile: () => ipcRenderer.invoke("get-user-profile"),
  getSavedState: () => ipcRenderer.invoke("get-saved-state"),
  saveSession: (session) => ipcRenderer.invoke("save-session", session),
  deleteSession: (sessionId) => ipcRenderer.invoke("delete-session", sessionId),
  saveWorkspace: (ws) => ipcRenderer.invoke("save-workspace", ws),
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
  executeCliPrompt: (payload) =>
    ipcRenderer.invoke("execute-cli-prompt", payload),
  on: (channel, callback) => {
    if (
      ![
        "tools-update",
        "pty-data",
        "pty-exit",
        "cli-stream-chunk",
        "cli-approvals",
      ].includes(channel)
    )
      throw new Error("Evento não permitido.");
    const subscription = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
});
