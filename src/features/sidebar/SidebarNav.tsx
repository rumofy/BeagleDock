import {
  Terminal,
  BrainCircuit,
  History,
  Wand2,
} from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";

export function SidebarNav() {
  const {
    activeTab,
    setActiveTab,
    setShowSkillsModal,
    setShowHistoryModal,
    messages,
    installedSkills,
    memoryStatus,
    refreshAIMemoryExplorer,
  } = useApp();
  // Shells em execução: comandos rodando agora em qualquer conversa (os mesmos das abas do shell).
  const runningShells = Object.values(messages).reduce(
    (total, list) =>
      total +
      list.reduce(
        (sum, message) =>
          sum +
          (message.events?.filter((e) => e.kind === "command" && e.status === "running").length ?? 0),
        0,
      ),
    0,
  );
  return (
          <div className="px-3 pt-3 pb-2 space-y-1">
            <button
              onClick={() => {
                setActiveTab("memory");
                refreshAIMemoryExplorer();
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition ${
                activeTab === "memory"
                  ? "bg-[#dfdacd] text-[#181715] shadow-xs"
                  : "text-[#5d5648] hover:bg-[#e4dec9]"
              }`}
            >
              <div className="flex items-center gap-2">
                <BrainCircuit size={16} className="text-[#847b6a]" />
                <span>ai-memory v{memoryStatus.version}</span>
              </div>
              <span className="flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full font-bold">
                {memoryStatus.totalPages} docs
              </span>
            </button>

            <button
              onClick={() => setActiveTab("terminal")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition ${
                activeTab === "terminal"
                  ? "bg-[#dfdacd] text-[#181715] shadow-xs"
                  : "text-[#5d5648] hover:bg-[#e4dec9]"
              }`}
            >
              <div className="flex items-center gap-2">
                <Terminal size={16} className="text-[#847b6a]" />
                <span>Shells</span>
              </div>
              <span className="font-mono text-[10px] bg-[#dfdacd] px-1.5 py-0.5 rounded text-[#5d5648]">
                {runningShells}{" "}
                rodando
              </span>
            </button>

            {/* ATALHO: SKILLS SALVAS (Ctrl+K) */}
            <button
              onClick={() => setShowSkillsModal(true)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-[#5d5648] hover:bg-[#e4dec9] transition"
              title="Atalho: Ctrl+K"
            >
              <div className="flex items-center gap-2">
                <Wand2 size={16} className="text-[#847b6a]" />
                <span>Skills & Revisor ({installedSkills.length})</span>
              </div>
              <span className="font-mono text-[10px] bg-[#dfdacd]/70 text-[#686050] px-1.5 py-0.5 rounded flex items-center gap-1">
                <kbd className="font-sans text-[9px]">Ctrl+K</kbd>
              </span>
            </button>

            {/* ATALHO: HISTÓRICO DE CONVERSAS (Ctrl+H) */}
            <button
              onClick={() => setShowHistoryModal(true)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-[#5d5648] hover:bg-[#e4dec9] transition"
              title="Atalho: Ctrl+H"
            >
              <div className="flex items-center gap-2">
                <History size={16} className="text-[#847b6a]" />
                <span>Histórico de Conversas</span>
              </div>
              <span className="font-mono text-[10px] bg-[#dfdacd]/70 text-[#686050] px-1.5 py-0.5 rounded flex items-center gap-1">
                <kbd className="font-sans text-[9px]">Ctrl+H</kbd>
              </span>
            </button>
          </div>
  );
}
