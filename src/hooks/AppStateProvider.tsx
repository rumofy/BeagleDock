import { createContext, useContext, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { backendAvailable, beagleApi } from "../api/beagleApi";
import { useMaintenanceChat } from "../features/memory/useMaintenanceChat";
import { useApprovals } from "./useApprovals";
import { useComposer } from "./useComposer";
import { useHistoryActions } from "./useHistoryActions";
import { useMemoryStatus } from "./useMemoryStatus";
import { useNotifications } from "./useNotifications";
import { useProviders } from "./useProviders";
import { useSessions } from "./useSessions";
import { useSettings } from "./useSettings";
import { useInstalledSkills } from "./useInstalledSkills";
import { useUi } from "./useUi";
import { useCliTerminals } from "./useCliTerminals";
import { useUserProfile } from "./useUserProfile";
import { useWorkspaces } from "./useWorkspaces";
import { resolveLocale, setLocale, t } from "../i18n";

function useAppStateValue() {
  const ui = useUi();
  const { setAppError, setActiveTab, setShowWorkspaceModal } = ui;
  const notifications = useNotifications();
  const { providers, setProviders } = useProviders({
    onUpdates: (updates) => {
      notifications.setNotifications(updates.notifications || []);
      notifications.setUpdateInfo(updates);
    },
    setAppError,
  });
  const { userProfile } = useUserProfile();
  const { workspaces, setWorkspaces } = useWorkspaces();
  const settings = useSettings(setAppError);
  // Applied during render so every string drawn in this pass already uses the chosen language.
  const locale = resolveLocale(settings.settings.language);
  setLocale(locale);
  const cliTerminals = useCliTerminals(setAppError, settings.settings.conversationMode === "terminal");
  const approvals = useApprovals(setAppError);
  const library = useInstalledSkills();
  const memory = useMemoryStatus();
  const sessions = useSessions({
    providers,
    setProviders,
    workspaces,
    userProfile,
    setAppError,
    setActiveTab,
    setShowWorkspaceModal,
    autoCompactTokens: settings.settings.autoCompactTokens,
    rememberSessionChoices: settings.settings.rememberSessionChoices,
    lastSessionChoices: settings.settings.lastSessionChoices,
    onSessionChoice: settings.recordSessionChoice,
  });
  const composer = useComposer({
    currentSession: sessions.currentSession,
    currentModel: sessions.currentModelSelection.model,
    pendingTurns: sessions.pendingTurns,
    setAppError,
    handleStopSession: sessions.handleStopSession,
    handleTriggerHandoff: sessions.handleTriggerHandoff,
    contextBySession: sessions.contextBySession,
    compactContext: sessions.compactContext,
    sendPrompt: sessions.sendPrompt,
  });
  const historyActions = useHistoryActions({
    sessions,
    setProviders,
    setAppError,
    setActiveTab,
    setInputMessage: composer.setInputMessage,
    setShowSkillsModal: ui.setShowSkillsModal,
    setShowHistoryModal: ui.setShowHistoryModal,
  });
  const maintenance = useMaintenanceChat({
    sessions,
    cliApprovals: approvals.cliApprovals,
    setAppError,
    setActiveTab,
  });

  // State saved in SQLite (workspaces, settings, sessions and messages)
  const { setSettings } = settings;
  const { hydrateSessions } = sessions;
  useEffect(() => {
    if (!backendAvailable()) {
      setAppError(
        t("app.backendUnavailable"),
      );
      return;
    }
    beagleApi
      .getSavedState()
      .then((saved) => {
        if (saved.workspaces && saved.workspaces.length > 0) {
          setWorkspaces(saved.workspaces);
        }
        if (saved.settings) {
          setSettings((prev) => ({ ...prev, ...saved.settings }));
        }
        if (saved.error) setAppError(saved.error);
        if (saved.settings?.securityWarning)
          setAppError(saved.settings.securityWarning);
        hydrateSessions(saved);
      })
      .catch((error: Error) => setAppError(error.message));
  }, []);

  // Conversation deleted with its terminal open: stop its CLI.
  const { terminals, closeTerminal } = cliTerminals;
  const sessionIds = sessions.allSessions.map((s) => s.id).join("|");
  useEffect(() => {
    if (!sessions.allSessions.length) return;
    const known = new Set(sessions.allSessions.map((s) => s.id));
    for (const id of Object.keys(terminals)) if (!known.has(id)) void closeTerminal(id);
  }, [sessionIds, terminals, closeTerminal]);

  // Auto-scroll the terminals when new logs come in
  const ptyScrollRef = useRef<HTMLDivElement>(null);
  const fullPtyScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ptyScrollRef.current) {
      ptyScrollRef.current.scrollTop = ptyScrollRef.current.scrollHeight;
    }
    if (fullPtyScrollRef.current) {
      fullPtyScrollRef.current.scrollTop =
        fullPtyScrollRef.current.scrollHeight;
    }
  }, [sessions.currentSession?.ptyLog?.length]);

  return {
    ...ui,
    ...notifications,
    providers,
    setProviders,
    userProfile,
    workspaces,
    setWorkspaces,
    ...settings,
    ...approvals,
    ...library,
    ...memory,
    ...sessions,
    ...composer,
    ...historyActions,
    ...maintenance,
    cliTerminals,
    locale,
    ptyScrollRef,
    fullPtyScrollRef,
  };
}

export type AppState = ReturnType<typeof useAppStateValue>;
const AppStateContext = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const value = useAppStateValue();
  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useApp(): AppState {
  const value = useContext(AppStateContext);
  if (!value) throw new Error("useApp must be used inside AppStateProvider.");
  return value;
}
