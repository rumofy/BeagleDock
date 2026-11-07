import type { BeagleAPI } from "../types/api";

import { t } from "../i18n";
/** Whether the backend (Electron preload or development bridge) is available. */
export const backendAvailable = (): boolean => !!window.beagleAPI;

/** Native CLI terminals are available on the desktop and on paired phones. */
export const terminalAvailable = (): boolean =>
  typeof window.beagleAPI?.cliTerminalOpen === "function";

/** Live shell output (pty) only reaches the computer's own window. */
export const shellAvailable = (): boolean => typeof window.beagleAPI?.ptySpawn === "function";

/** Registering and editing project folders needs the computer's folder picker. */
export const workspaceEditingAvailable = (): boolean =>
  typeof window.beagleAPI?.saveWorkspace === "function";

/** Opening files in the editor only makes sense on the computer (not on a paired phone). */
export const editorAvailable = (): boolean =>
  typeof window.beagleAPI?.openInEditor === "function";

/** Phone access only exists in the desktop app (the development browser bridge doesn't expose it). */
/** The voice model is downloaded on the computer only (not from a paired phone). */
export const dictationDownloadAvailable = (): boolean =>
  typeof window.beagleAPI?.downloadDictationModel === "function";
export const remoteAccessAvailable = (): boolean =>
  typeof window.beagleAPI?.getRemoteAccessStatus === "function";

function backend(): BeagleAPI {
  const api = window.beagleAPI;
  if (!api) throw new Error(t("errors.backendUnavailable"));
  return api;
}

/** Typed client: one function per IPC method exposed on `window.beagleAPI`. */
export const beagleApi: BeagleAPI = {
  getGlobalPermissions: () => backend().getGlobalPermissions(),
  saveGlobalPermissions: (id, changes) => backend().saveGlobalPermissions(id, changes),
  checkCliUpdates: () => backend().checkCliUpdates(),
  readNotifications: () => backend().readNotifications(),
  updateCli: (id) => backend().updateCli(id),
  getCliApprovals: () => backend().getCliApprovals(),
  getAppVersion: () => backend().getAppVersion(),
  resolveCliApproval: (id, decision, message, answers) =>
    backend().resolveCliApproval(id, decision, message, answers),
  setLivePermission: (sessionId, permission) =>
    backend().setLivePermission(sessionId, permission),
  detectTools: () => backend().detectTools(),
  getAIMemoryStatus: () => backend().getAIMemoryStatus(),
  searchAIMemory: (query, isGlobal, workspace, project) =>
    backend().searchAIMemory(query, isGlobal, workspace, project),
  listAIMemoryPages: (workspace, project, limit) =>
    backend().listAIMemoryPages(workspace, project, limit),
  readAIMemoryPage: (pagePath, workspace, project) =>
    backend().readAIMemoryPage(pagePath, workspace, project),
  getAIMemoryScope: (cwd) => backend().getAIMemoryScope(cwd),
  listAIMemoryProjects: () => backend().listAIMemoryProjects(),
  listAIMemoryProjectPages: (workspace, project) =>
    backend().listAIMemoryProjectPages(workspace, project),
  getAIMemoryProjectOverview: (workspace, project) =>
    backend().getAIMemoryProjectOverview(workspace, project),
  listAIMemoryProjectSessions: (workspace, project) =>
    backend().listAIMemoryProjectSessions(workspace, project),
  deleteAIMemoryPage: (workspace, project, pagePath, confirmProtected) =>
    backend().deleteAIMemoryPage(workspace, project, pagePath, confirmProtected),
  purgeAIMemoryProject: (workspace, project, confirmName) =>
    backend().purgeAIMemoryProject(workspace, project, confirmName),
  previewAIMemoryTempCleanup: () => backend().previewAIMemoryTempCleanup(),
  runAIMemoryTempCleanup: (opts) => backend().runAIMemoryTempCleanup(opts),
  setAIMemoryTempCleanupDays: (days) => backend().setAIMemoryTempCleanupDays(days),
  getAIMemoryMaintenancePrompt: (opts) => backend().getAIMemoryMaintenancePrompt(opts),
  getAIMemoryMaintenanceCwd: () => backend().getAIMemoryMaintenanceCwd(),
  runAIMemoryCommand: (subcmdArgs, cwd) => backend().runAIMemoryCommand(subcmdArgs, cwd),
  getInstalledSkills: () => backend().getInstalledSkills(),
  getCliHistory: (query) => backend().getCliHistory(query),
  deleteConversation: (request) => backend().deleteConversation(request),
  loadFullConversation: (provider, sessionId) => backend().loadFullConversation(provider, sessionId),
  getUserProfile: () => backend().getUserProfile(),
  getSavedState: () => backend().getSavedState(),
  getSessions: () => backend().getSessions(),
  saveSession: (session) => backend().saveSession(session),
  deleteSession: (sessionId) => backend().deleteSession(sessionId),
  saveWorkspace: (workspace) => backend().saveWorkspace(workspace),
  compactSession: (id, providerId) => backend().compactSession(id, providerId),
  setSessionArchived: (id, archived) => backend().setSessionArchived(id, archived),
  pickDirectory: (options) => backend().pickDirectory(options),
  openInEditor: (request) => backend().openInEditor(request),
  searchProjectFiles: (request) => backend().searchProjectFiles(request),
  listWorkspaceStatus: () => backend().listWorkspaceStatus(),
  updateWorkspace: (request) => backend().updateWorkspace(request),
  deleteWorkspace: (id) => backend().deleteWorkspace(id),
  openExternalUrl: (url) => backend().openExternalUrl(url),
  listNativeCommands: (request) => backend().listNativeCommands(request),
  getZoom: () => backend().getZoom(),
  setZoom: (factor) => backend().setZoom(factor),
  saveAppSettings: (settings) => backend().saveAppSettings(settings),
  transcribeAudio: (request) => backend().transcribeAudio(request),
  getDictationStatus: () => backend().getDictationStatus(),
  downloadDictationModel: () => backend().downloadDictationModel(),
  cancelDictationModelDownload: () => backend().cancelDictationModelDownload(),
  removeDictationModel: () => backend().removeDictationModel(),
  replaceChatMessages: (id, messages) => backend().replaceChatMessages(id, messages),
  saveChatMessage: (message) => backend().saveChatMessage(message),
  getChatMessages: (sessionId) => backend().getChatMessages(sessionId),
  getLiveTurns: () => backend().getLiveTurns(),
  ptySpawn: (payload) => backend().ptySpawn(payload),
  ptyWrite: (payload) => backend().ptyWrite(payload),
  ptyResize: (payload) => backend().ptyResize(payload),
  cliTerminalOpen: (request) => backend().cliTerminalOpen(request),
  cliTerminalWrite: (request) => backend().cliTerminalWrite(request),
  cliTerminalResize: (request) => backend().cliTerminalResize(request),
  cliTerminalClose: (sessionId) => backend().cliTerminalClose(sessionId),
  cliTerminalList: () => backend().cliTerminalList(),
  cliTerminalClipboard: () => backend().cliTerminalClipboard(),
  pathForFile: (file) => backend().pathForFile?.(file) ?? "",
  interruptCliSession: (id) => backend().interruptCliSession(id),
  cancelQueuedPrompt: (request) => backend().cancelQueuedPrompt(request),
  forceQueuedPrompt: (request) => backend().forceQueuedPrompt(request),
  answerNowPrompt: (request) => backend().answerNowPrompt(request),
  executeCliPrompt: (payload) => backend().executeCliPrompt(payload),
  getRemoteAccessStatus: () => backend().getRemoteAccessStatus(),
  setRemoteAccessPort: (port) => backend().setRemoteAccessPort(port),
  setRemoteAccessEnabled: (enabled) => backend().setRemoteAccessEnabled(enabled),
  startRemotePairing: () => backend().startRemotePairing(),
  cancelRemotePairing: () => backend().cancelRemotePairing(),
  revokeRemoteDevice: (id) => backend().revokeRemoteDevice(id),

  on: (channel, callback) => backend().on(channel, callback),
};
