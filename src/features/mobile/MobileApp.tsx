import { useEffect, useRef, useState } from "react";
import { ChevronLeft, History, SlidersHorizontal, WifiOff } from "lucide-react";
import { CompanyIcon } from "../../components/CompanyIcon";
import { SkillsModal } from "../modals/SkillsModal";
import { AppStateProvider, useApp } from "../../hooks/AppStateProvider";
import { useTheme } from "../../hooks/useTheme";
import { ApprovalPrompt } from "../approvals/ApprovalPrompt";
import { ChatHeader } from "../chat/ChatHeader";
import { CliTerminalView } from "../terminal/CliTerminalView";
import { CliTerminalStart } from "../terminal/CliTerminalStart";
import { ChatView } from "../chat/ChatView";
import { HistoryModal } from "../modals/HistoryModal";
import { ProviderList } from "../sidebar/ProviderList";
import { SidebarHeader } from "../sidebar/SidebarHeader";
import type { BeagleAPI } from "../../types/api";
import { setLocale, t } from "../../i18n";
import { forget, getToken } from "./mobileClient";
import { PairScreen } from "./PairScreen";
import { createRemoteBridge, type ConnectionState } from "./remoteBridge";

setLocale(navigator.language);

// One bridge per page (React's development double render must not open two connections).
let bridge: ReturnType<typeof createRemoteBridge> | null = null;
const listeners = new Set<(state: ConnectionState) => void>();
function connect() {
  if (bridge) return;
  bridge = createRemoteBridge((state) => listeners.forEach((fn) => fn(state)));
  window.beagleAPI = bridge.api as unknown as BeagleAPI;
}
function disconnect() {
  bridge?.stop();
  bridge = null;
  delete window.beagleAPI;
}

/** Phone interface: the desktop chat itself, laid out for a small screen. */
export function MobileApp() {
  const [paired, setPaired] = useState(() => !!getToken());
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  if (paired) connect();
  useEffect(() => {
    const onState = (state: ConnectionState) => {
      if (state !== "unpaired") return setConnection(state);
      // Revoked on the computer: back to pairing.
      forget();
      disconnect();
      setPaired(false);
    };
    listeners.add(onState);
    return () => void listeners.delete(onState);
  }, []);
  if (!paired) return <PairScreen onPaired={() => setPaired(true)} />;
  return (
    <AppStateProvider>
      <MobileShell offline={connection === "offline"} />
    </AppStateProvider>
  );
}

function MobileShell({ offline }: { offline: boolean }) {
  const {
    settings,
    cliTerminals,
    appError,
    setAppError,
    activeSessionId,
    setShowHistoryModal,
    setActiveTab,
    currentSession,
    currentProvider,
    currentModelSelection,
    isExecutingPrompt,
  } = useApp();
  const terminalMode = cliTerminals.isTerminal(currentSession?.id);
  const terminalState = currentSession ? cliTerminals.terminals[currentSession.id] : undefined;
  const running = terminalMode ? terminalState?.status === "running" : isExecutingPrompt;
  useTheme(settings.theme);
  const [view, setView] = useState<"list" | "chat">("list");
  // The chat's controls (model, level, permission, folder, quotas…) open on demand.
  const [controls, setControls] = useState(false);
  useEffect(() => setControls(false), [activeSessionId]);
  // A conversation opened or created from the list takes the screen to the chat.
  const wantsChat = useRef(false);
  useEffect(() => {
    if (!wantsChat.current) return;
    wantsChat.current = false;
    setView("chat");
  }, [activeSessionId]);
  useEffect(() => setActiveTab("chat"), [setActiveTab]);
  // The phone's back gesture returns to the list instead of leaving the app.
  useEffect(() => {
    if (view !== "chat") return;
    history.pushState({ beagledock: "chat" }, "");
    const back = () => setView("list");
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [view]);

  const banners = (
    <>
      {offline && (
        <p className="flex items-center gap-2 px-4 py-2 text-xs bg-rose-50 text-rose-800 border-b border-rose-200">
          <WifiOff size={14} className="shrink-0" /> {t("mobile.offlineHint")}
        </p>
      )}
      {appError && (
        <div role="alert" className="px-4 py-2 bg-rose-50 text-rose-800 text-sm flex justify-between gap-3">
          <span className="min-w-0 break-words">{appError}</span>
          <button onClick={() => setAppError("")} aria-label={t("app.closeNotice")}>
            ×
          </button>
        </div>
      )}
    </>
  );

  if (view === "list")
    return (
      <div
        className="h-dvh flex flex-col bg-[#ede9de] text-[#1c1b18] overflow-hidden pt-[env(safe-area-inset-top)]"
        onClickCapture={(e) => {
          const target = e.target as HTMLElement;
          const row = target.closest("[data-session-id]");
          // Renaming or closing a conversation acts on its row without opening it.
          if (row && target.closest("button, input")) return;
          // Same conversation tapped again: no change of selection, but still open it.
          if (row) setTimeout(() => setView("chat"));
          // Creating one, or reopening one from the history, changes the selection.
          wantsChat.current = true;
        }}
      >
        <SidebarHeader />
        {banners}
        <div className="px-3 pt-2">
          <button
            type="button"
            onClick={() => setShowHistoryModal(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-[#5d5648] hover:bg-[#e4dec9]"
          >
            <History size={16} className="text-[#847b6a]" /> {t("nav.history")}
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col pb-[env(safe-area-inset-bottom)]">
          <ProviderList />
        </div>
        <HistoryModal />
        <ApprovalPrompt />
      </div>
    );

  return (
    <div className="h-dvh flex flex-col bg-[#fcfbfa] text-[#1c1b18] overflow-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="border-b border-[#ece7db] bg-[#fcfbfa]">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <button
            type="button"
            onClick={() => history.back()}
            className="p-2 -ml-1 text-[#1c1b18] shrink-0"
            aria-label={t("mobile.back")}
          >
            <ChevronLeft size={22} />
          </button>
          {currentProvider && <CompanyIcon id={currentProvider.id} size={22} />}
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm truncate">{currentSession?.title}</div>
            <div className="text-[11px] text-[#7d7565] truncate flex items-center gap-1.5">
              {running && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />}
              {terminalMode
                ? t(terminalState?.exited ? "terminal.exited" : terminalState?.status === "running" ? "session.running" : terminalState?.status === "waiting_input" ? "terminal.waitingInput" : "session.idle")
                : isExecutingPrompt
                ? t("mobile.running")
                : [currentModelSelection.model || t("stale.cliDefault"), currentModelSelection.effort]
                    .filter(Boolean)
                    .join(" · ")}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setControls((open) => !open)}
            aria-expanded={controls}
            aria-label={t("mobile.chatControls")}
            className={`p-2 rounded-xl shrink-0 ${controls ? "bg-[#1c1b18] text-white" : "text-[#36322b] bg-[#ede9de]"}`}
          >
            <SlidersHorizontal size={18} />
          </button>
        </div>
        {controls && (
          <div className="max-h-[55dvh] overflow-y-auto px-3 pb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-[#ece7db] pt-2">
            <ChatHeader />
          </div>
        )}
      </header>
      {banners}
      <div className="flex-1 min-h-0 overflow-hidden relative flex flex-col">
        {terminalMode && currentSession ? (
          currentSession.nativeSessionId || currentSession.cwdLocked || cliTerminals.hasStarted(currentSession.id) || cliTerminals.isOpening(currentSession.id)
            ? <CliTerminalView key={currentSession.id} session={currentSession} mobile />
            : <CliTerminalStart />
        ) : <ChatView />}
      </div>
      <ApprovalPrompt />
      <SkillsModal />
      <HistoryModal />
    </div>
  );
}
