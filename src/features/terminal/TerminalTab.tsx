import { useApp } from "../../hooks/AppStateProvider";
import { SessionShell } from "./SessionShell";

export function TerminalTab() {
  const {
    currentSession,
    currentProvider,
  } = useApp();
  return (
            <div className="p-6 flex-1 flex flex-col overflow-hidden">
              <div className="max-w-5xl w-full mx-auto flex-1 flex flex-col bg-[#141416] rounded-2xl overflow-hidden shadow-xl border border-[#27272a]">
                <div className="h-10 bg-[#1e1e21] px-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
                    <span className="ml-2 font-mono text-xs text-[#a1a1aa] font-medium">
                      {currentProvider?.cliPath} — Workspace:{" "}
                      {currentSession?.cwd}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs font-mono text-[#a1a1aa]">
                    <span className="px-2 py-0.5 rounded bg-[#27272a] text-[#e4e4e7]">
                      PID {currentSession?.pid || "ativo"}
                    </span>
                  </div>
                </div>

                <SessionShell sessionId={currentSession?.id || ""} />
              </div>
            </div>
  );
}
