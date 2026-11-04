import {
  Terminal,
} from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";

export function TerminalHeader() {
  const {
    setActiveTab,
    currentSession,
    cliTerminals,
  } = useApp();
  const open = Object.keys(cliTerminals.terminals).length;
  return (
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-[#1c1b18] text-white">
                  <Terminal size={20} />
                </div>
                <div>
                  <div className="text-sm font-bold text-[#1c1b18]">
                    {open
                      ? `Terminais das CLIs (${open} ${open === 1 ? "aberto" : "abertos"})`
                      : `Shell PTY Interativo (${currentSession?.cwd})`}
                  </div>
                  <div className="text-[11px] text-[#7e7565]">
                    {open
                      ? "Cada CLI com a própria interface, lado a lado"
                      : "Terminal do sistema operacional"}
                  </div>
                </div>
              </div>

              <button
                onClick={() => setActiveTab("chat")}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#ede9de] hover:bg-[#e2dcce] text-[#36322b] transition"
              >
                Voltar ao Chat
              </button>
            </div>
  );
}
