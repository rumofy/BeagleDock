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

function AppShell() {
  const { activeTab, appError, setAppError, settings } = useApp();
  useTheme(settings.theme);
  const chatAreaRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex h-screen w-screen bg-[#f7f5ef] text-[#1c1b18] overflow-hidden">
      {/* SIDEBAR ESQUERDA */}
      <aside className="w-80 min-w-[320px] max-w-[320px] shrink-0 bg-[#ede9de]/85 border-r border-[#dfdacd] flex flex-col justify-between select-none relative z-30">
        <div className="flex flex-col h-full overflow-hidden">
          <SidebarHeader />
          <SidebarNav />
          <ProviderList />
        </div>
        <SidebarFooter />
      </aside>

      {/* PAINEL CENTRAL */}
      <main className="flex-1 flex flex-col bg-[#fcfbfa] overflow-hidden">
        <header className="h-14 border-b border-[#ece7db] px-6 flex items-center justify-between bg-[#fcfbfa]">
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
            <button onClick={() => setAppError("")} aria-label="Fechar aviso">
              ×
            </button>
          </div>
        )}
        <div
          ref={chatAreaRef}
          className="flex-1 overflow-hidden relative flex flex-col bg-[#fcfbfa]"
        >
          {activeTab === "chat" && <ChatView />}
          <FloatingTerminal containerRef={chatAreaRef} />
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

export function App() {
  return (
    <AppStateProvider>
      <AppShell />
    </AppStateProvider>
  );
}
