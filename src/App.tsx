import { useRef } from "react";
import { AppStateProvider, useApp } from "./hooks/AppStateProvider";
import { useTheme } from "./hooks/useTheme";
import { ApprovalPrompt } from "./features/approvals/ApprovalPrompt";
import { ChatHeader } from "./features/chat/ChatHeader";
import { ChatView } from "./features/chat/ChatView";
import { PermissionShortcuts } from "./features/chat/PermissionShortcuts";
import { MemoryHeader } from "./features/memory/MemoryHeader";
import { MemoryTab } from "./features/memory/MemoryTab";
import { HistoryModal } from "./features/modals/HistoryModal";
import { SkillsModal } from "./features/modals/SkillsModal";
import { WorkspaceModal } from "./features/modals/WorkspaceModal";
import { WorkspaceManager } from "./features/modals/WorkspaceManager";
import { SettingsHeader } from "./features/settings/SettingsHeader";
import { SettingsTab } from "./features/settings/SettingsTab";
import { ProviderList } from "./features/sidebar/ProviderList";
import { SidebarFooter } from "./features/sidebar/SidebarFooter";
import { SidebarHeader } from "./features/sidebar/SidebarHeader";
import { SidebarNav } from "./features/sidebar/SidebarNav";
import { FloatingTerminal } from "./features/terminal/FloatingTerminal";
import { TerminalHeader } from "./features/terminal/TerminalHeader";
import { TerminalTab } from "./features/terminal/TerminalTab";
import { CliTerminalView } from "./features/terminal/CliTerminalView";

import { t } from "./i18n";
function AppShell() {
  const { activeTab, appError, setAppError, settings, currentSession, cliTerminals } = useApp();
  const terminalMode = cliTerminals.isTerminal(currentSession?.id);
  useTheme(settings.theme);
  const chatAreaRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex h-screen w-screen bg-[#f7f5ef] text-[#1c1b18] overflow-hidden">
      {/* LEFT SIDEBAR */}
      <aside className="w-80 min-w-[320px] max-w-[320px] shrink-0 bg-[#ede9de]/85 border-r border-[#dfdacd] flex flex-col justify-between select-none relative z-30">
        <div className="flex flex-col h-full overflow-hidden">
          <SidebarHeader />
          <SidebarNav />
          <ProviderList />
        </div>
        <SidebarFooter />
      </aside>

      {/* CENTRAL PANEL */}
      <main className="flex-1 flex flex-col bg-[#fcfbfa] overflow-hidden">
        <header className="min-h-14 border-b border-[#ece7db] px-6 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-[#fcfbfa]">
          {activeTab === "chat" && <ChatHeader />}
          {activeTab === "memory" && <MemoryHeader />}
          {activeTab === "terminal" && <TerminalHeader />}
          {activeTab === "settings" && <SettingsHeader />}
        </header>

        {appError && (
          <div
            role="alert"
            className="px-6 py-3 bg-rose-50 text-rose-800 text-sm flex justify-between"
          >
            <span>{appError}</span>
            <button onClick={() => setAppError("")} aria-label={t("app.closeNotice")}>
              ×
            </button>
          </div>
        )}
        <div
          ref={chatAreaRef}
          className="flex-1 overflow-hidden relative flex flex-col bg-[#fcfbfa]"
        >
          {activeTab === "chat" &&
            (terminalMode && currentSession ? (
              <CliTerminalView key={currentSession.id} session={currentSession} />
            ) : (
              <ChatView />
            ))}
          {!terminalMode && <FloatingTerminal containerRef={chatAreaRef} />}
          {activeTab === "memory" && <MemoryTab />}
          {activeTab === "terminal" && <TerminalTab />}
          {activeTab === "settings" && <SettingsTab />}
        </div>
      </main>

      <PermissionShortcuts />
      <ApprovalPrompt />
      <WorkspaceModal />
      <WorkspaceManager />
      <SkillsModal />
      <HistoryModal />
    </div>
  );
}

// Changing the language redraws the whole interface. Conversations, drafts and running CLIs live
// in the state provider above, so nothing is lost.
function LocalizedShell() {
  const { locale } = useApp();
  return <AppShell key={locale} />;
}

export function App() {
  return (
    <AppStateProvider>
      <LocalizedShell />
    </AppStateProvider>
  );
}
