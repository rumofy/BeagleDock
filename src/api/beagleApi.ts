import type { BeagleAPI } from "../types/api";

/** Indica se o backend (preload do Electron ou bridge de desenvolvimento) está disponível. */
export const backendAvailable = (): boolean => !!window.beagleAPI;

function backend(): BeagleAPI {
  const api = window.beagleAPI;
  if (!api) throw new Error("Backend indisponível.");
  return api;
}

/** Cliente tipado: uma função por método IPC exposto em `window.beagleAPI`. */
export const beagleApi: BeagleAPI = {
  getGlobalPermissions: () => backend().getGlobalPermissions(),
  saveGlobalPermissions: (id, changes) => backend().saveGlobalPermissions(id, changes),
  checkCliUpdates: () => backend().checkCliUpdates(),
  readNotifications: () => backend().readNotifications(),
  updateCli: (id) => backend().updateCli(id),
  getCliApprovals: () => backend().getCliApprovals(),
  getAppVersion: () => backend().getAppVersion(),
  resolveCliApproval: (id, decision, message) =>
    backend().resolveCliApproval(id, decision, message),
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
  getAIMemoryMaintenancePrompt: (opts) => backend().getAIMemoryMaintenancePrompt(opts),
  getAIMemoryMaintenanceCwd: () => backend().getAIMemoryMaintenanceCwd(),
  runAIMemoryCommand: (subcmdArgs, cwd) => backend().runAIMemoryCommand(subcmdArgs, cwd),
  getInstalledSkills: () => backend().getInstalledSkills(),
  getCliHistory: () => backend().getCliHistory(),
  loadFullConversation: (provider, sessionId) => backend().loadFullConversation(provider, sessionId),
  getUserProfile: () => backend().getUserProfile(),
  getSavedState: () => backend().getSavedState(),
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
  replaceChatMessages: (id, messages) => backend().replaceChatMessages(id, messages),
  saveChatMessage: (message) => backend().saveChatMessage(message),
  getChatMessages: (sessionId) => backend().getChatMessages(sessionId),
  ptySpawn: (payload) => backend().ptySpawn(payload),
  ptyWrite: (payload) => backend().ptyWrite(payload),
  ptyResize: (payload) => backend().ptyResize(payload),
  interruptCliSession: (id) => backend().interruptCliSession(id),
  cancelQueuedPrompt: (request) => backend().cancelQueuedPrompt(request),
  forceQueuedPrompt: (request) => backend().forceQueuedPrompt(request),
  executeCliPrompt: (payload) => backend().executeCliPrompt(payload),
  on: (channel, callback) => backend().on(channel, callback),
};
