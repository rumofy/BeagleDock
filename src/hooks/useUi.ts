import { useEffect, useState } from "react";

export type AppTab = "chat" | "memory" | "terminal" | "settings";

/** Navigation, global notice and modal visibility. */
export function useUi() {
  const [activeTab, setActiveTab] = useState<AppTab>("chat");
  const [appError, setAppError] = useState("");
  const [showInlineTerminal, setShowInlineTerminal] = useState<boolean>(true);
  const [showWorkspaceModal, setShowWorkspaceModal] = useState<boolean>(false);
  const [showWorkspaceManager, setShowWorkspaceManager] = useState<boolean>(false);
  const [showSkillsModal, setShowSkillsModal] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);

  // Global keyboard shortcuts: Ctrl+K for Skills, Ctrl+H for History
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowSkillsModal((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setShowHistoryModal((prev) => !prev);
      } else if (e.key === "Escape") {
        setShowSkillsModal(false);
        setShowHistoryModal(false);
        setShowWorkspaceModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
  return {
    activeTab,
    setActiveTab,
    appError,
    setAppError,
    showInlineTerminal,
    setShowInlineTerminal,
    showWorkspaceModal,
    setShowWorkspaceModal,
    showWorkspaceManager,
    setShowWorkspaceManager,
    showSkillsModal,
    setShowSkillsModal,
    showHistoryModal,
    setShowHistoryModal,
  };
}
