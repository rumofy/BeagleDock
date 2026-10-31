import { useEffect, useState } from "react";

export type AppTab = "chat" | "memory" | "terminal" | "settings";

/** Navegação, aviso global e visibilidade de modais. */
export function useUi() {
  const [activeTab, setActiveTab] = useState<AppTab>("chat");
  const [appError, setAppError] = useState("");
  const [showInlineTerminal, setShowInlineTerminal] = useState<boolean>(true);
  const [showWorkspaceModal, setShowWorkspaceModal] = useState<boolean>(false);
  const [showWorkspaceManager, setShowWorkspaceManager] = useState<boolean>(false);
  const [showSkillsModal, setShowSkillsModal] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);

  // Atalho global de teclado: Ctrl+K para Skills, Ctrl+H para Histórico
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
