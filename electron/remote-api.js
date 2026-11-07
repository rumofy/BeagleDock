// What a paired phone can call: the desktop chat's own backend methods (same handlers as the IPC),
// restricted to conversations, their native CLI terminals, quotas and notifications. No shell, settings, folders or memory
// maintenance. Folders come only from registered projects or from the conversation itself.
const path = require("path");

// Phone method -> IPC channel of the same handler the desktop uses.
const METHODS = {
  cliTerminalOpen: "cli-terminal-open",
  cliTerminalWrite: "cli-terminal-write",
  cliTerminalResize: "cli-terminal-resize",
  cliTerminalClose: "cli-terminal-close",
  cliTerminalList: "cli-terminal-list",
  detectTools: "detect-tools",
  getAppVersion: "get-app-version",
  getUserProfile: "get-user-profile",
  getSavedState: "get-saved-state",
  getSessions: "get-sessions",
  getGlobalPermissions: "get-global-permissions",
  getCliApprovals: "get-cli-approvals",
  resolveCliApproval: "resolve-cli-approval",
  setLivePermission: "set-live-permission",
  checkCliUpdates: "check-cli-updates",
  readNotifications: "read-notifications",
  getAIMemoryStatus: "ai-memory-status",
  getAIMemoryScope: "ai-memory-scope",
  getInstalledSkills: "get-skills",
  getCliHistory: "get-history",
  loadFullConversation: "load-full-conversation",
  deleteConversation: "delete-conversation",
  saveSession: "save-session",
  deleteSession: "delete-session",
  compactSession: "compact-session",
  setSessionArchived: "set-session-archived",
  searchProjectFiles: "search-project-files",
  listWorkspaceStatus: "list-workspace-status",
  listNativeCommands: "list-native-commands",
  saveAppSettings: "save-app-settings",
  transcribeAudio: "transcribe-audio",
  getDictationStatus: "dictation-status",
  replaceChatMessages: "replace-chat-messages",
  saveChatMessage: "save-chat-message",
  getChatMessages: "get-chat-messages",
  getLiveTurns: "get-live-turns",
  awaitTurnResult: "await-turn-result",
  interruptCliSession: "interrupt-cli-session",
  cancelQueuedPrompt: "cancel-queued-prompt",
  forceQueuedPrompt: "force-queued-prompt",
  answerNowPrompt: "answer-now-prompt",
  executeCliPrompt: "execute-cli-prompt",
};
// Settings the chat itself saves (the model, level and permission last chosen in each CLI).
const PHONE_SETTINGS = new Set(["lastSessionChoices"]);

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}
const normalize = (dir) => (typeof dir === "string" && dir ? path.resolve(dir) : null);

function createRemoteApi({ invoke, getWorkspaces, getSessions, messages = (key) => key }) {
  // Folders of conversations the phone opened from the CLI history (reopening keeps their folder).
  const historyFolders = new Map();
  const denied = () => forbidden(messages("remote.folderNotAllowed"));

  async function knownFolders(deviceId) {
    const [workspaces, sessions] = await Promise.all([getWorkspaces(), getSessions()]);
    return new Set(
      [
        ...(workspaces || []).map((w) => w.path),
        ...(sessions || []).map((s) => s.cwd),
        ...(historyFolders.get(deviceId) || []),
      ]
        .map(normalize)
        .filter(Boolean),
    );
  }
  async function requireFolder(deviceId, dir) {
    const wanted = normalize(dir);
    if (!wanted || !(await knownFolders(deviceId)).has(wanted)) throw denied();
  }

  async function requireSession(id) {
    const session = (await getSessions()).find((s) => s.id === id);
    if (!session) throw denied();
    return session;
  }

  // Extra checks on top of the handler's own validation.
  const guards = {
    async cliTerminalOpen(_deviceId, [request]) {
      const session = await requireSession(request?.sessionId);
      if (session.providerId !== request?.providerId || normalize(session.cwd) !== normalize(request?.cwd)) throw denied();
    },
    cliTerminalWrite: (_deviceId, [request]) => requireSession(request?.sessionId),
    cliTerminalResize: (_deviceId, [request]) => requireSession(request?.sessionId),
    cliTerminalClose: (_deviceId, [id]) => requireSession(id),
    async saveSession(deviceId, [session]) {
      const existing = (await getSessions()).find((s) => s.id === session?.id);
      // A conversation stays in its folder; a new one starts in a known folder.
      if (existing ? normalize(existing.cwd) !== normalize(session?.cwd) : true)
        await requireFolder(deviceId, session?.cwd);
    },
    async executeCliPrompt(_deviceId, [payload]) {
      const session = (await getSessions()).find((s) => s.id === payload?.sessionId);
      if (!session || normalize(session.cwd) !== normalize(payload?.cwd)) throw denied();
    },
    searchProjectFiles: (deviceId, [request]) => requireFolder(deviceId, request?.cwd),
    listNativeCommands: (deviceId, [request]) => requireFolder(deviceId, request?.cwd),
    getAIMemoryScope: (deviceId, [cwd]) => requireFolder(deviceId, cwd),
    saveAppSettings(_deviceId, [settings]) {
      if (
        !settings ||
        typeof settings !== "object" ||
        Object.keys(settings).some((key) => !PHONE_SETTINGS.has(key))
      )
        throw forbidden(messages("remote.settingsOnDesktop"));
    },
  };

  return {
    methods: Object.keys(METHODS),
    async call(method, args, device) {
      if (!Object.hasOwn(METHODS, method)) throw forbidden("Unknown method.");
      if (!Array.isArray(args) || args.length > 10) throw forbidden("Invalid arguments.");
      await guards[method]?.(device.id, args);
      const result = await invoke(METHODS[method], args, device.id);
      if (method === "loadFullConversation" && result?.cwd) {
        const set = historyFolders.get(device.id) || new Set();
        set.add(result.cwd);
        historyFolders.set(device.id, set);
      }
      return result;
    },
  };
}

module.exports = { createRemoteApi, METHODS };
