import {
  BrainCircuit,
  RefreshCw,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useMemoryExplorerState } from "./MemoryExplorerContext";
import { relativeTime } from "./memoryUtils";
import { PaneMessage } from "./PaneMessage";

export function ProjectList() {
  const {
    memoryStatus,
    projects,
    projectsLoading,
    projectsError,
    showHidden,
    setShowHidden,
    sel,
    setSel,
    pagesLoading,
    leftCollapsed,
    setLeftCollapsed,
    refreshAll,
    hiddenCount,
    shownProjects,
    online,
  } = useMemoryExplorerState();
  return (
<>
      {leftCollapsed ? (
        <div className="w-9 shrink-0 border-r border-[#dfdacd] flex flex-col items-center py-2">
          <button
            onClick={() => setLeftCollapsed(false)}
            title="Mostrar projetos"
            className="p-1.5 rounded-lg hover:bg-[#ede9de] text-[#6d6657]"
          >
            <PanelLeftOpen size={16} />
          </button>
        </div>
      ) : (
        <section
          aria-label="Projetos"
          className="w-44 xl:w-60 shrink-0 border-r border-[#dfdacd] flex flex-col min-h-0"
        >
          <div className="p-2.5 border-b border-[#eeeae0] space-y-1.5">
            <div className="flex items-center gap-1.5">
              <BrainCircuit size={14} className="text-[#6d6657]" />
              <span className="text-xs font-bold flex-1">Projetos</span>
              <button
                onClick={refreshAll}
                title="Atualizar"
                className="p-1 rounded-lg hover:bg-[#ede9de] text-[#6d6657]"
              >
                <RefreshCw
                  size={13}
                  className={projectsLoading || pagesLoading ? "animate-spin" : ""}
                />
              </button>
              <button
                onClick={() => setLeftCollapsed(true)}
                title="Recolher"
                className="p-1 rounded-lg hover:bg-[#ede9de] text-[#6d6657]"
              >
                <PanelLeftClose size={14} />
              </button>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
              {projectsError ? (
                <span className="font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800">
                  Offline
                </span>
              ) : (
                <span className="font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {online === null ? "…" : "Online"}
                </span>
              )}
              {memoryStatus.version && (
                <span className="text-[#8c8270] font-mono">
                  v{memoryStatus.version}
                </span>
              )}
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {projectsLoading && !projects.length && (
              <PaneMessage>Carregando projetos…</PaneMessage>
            )}
            {projectsError && (
              <PaneMessage tone="error">
                {projectsError}
                <button className="block mt-2 underline" onClick={refreshAll}>
                  Tentar novamente
                </button>
              </PaneMessage>
            )}
            {!projectsLoading && !projectsError && !shownProjects.length && (
              <PaneMessage>Nenhum projeto encontrado.</PaneMessage>
            )}
            {shownProjects.map((pr) => {
              const active =
                sel && pr.workspace === sel.ws && pr.project === sel.p;
              return (
                <button
                  key={`${pr.workspace}/${pr.project}`}
                  onClick={() => setSel({ ws: pr.workspace, p: pr.project })}
                  className={`w-full text-left px-2.5 py-2 border-b border-[#f0ece1] transition ${active ? "bg-[#ede9de]" : "hover:bg-[#f4f1e8]"}`}
                >
                  <div className="text-xs font-bold text-[#1c1b18] truncate">
                    {pr.project}
                  </div>
                  <div className="text-[10px] text-[#8c8270] truncate">
                    {pr.workspace}
                  </div>
                  <div className="text-[10px] text-[#6d6657] mt-0.5">
                    {pr.pageCount} pág. · {pr.sessionCount} sess. ·{" "}
                    {relativeTime(pr.lastActivity || pr.lastUpdated)}
                  </div>
                </button>
              );
            })}
          </div>
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowHidden((v) => !v)}
              className="text-[11px] text-[#6d6657] underline p-2 text-left border-t border-[#eeeae0]"
            >
              {showHidden ? "Ocultar" : "Mostrar"} projetos de teste/vazios (
              {hiddenCount})
            </button>
          )}
        </section>
      )}
</>
  );
}
