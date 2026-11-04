import {
  ChevronDown,
  ChevronRight,
  Search,
  Trash2,
  Wand2,
} from "lucide-react";
import { useMemoryExplorerState } from "./MemoryExplorerContext";
import { canPurgeProject, formatDate } from "./memoryUtils";
import { GROUP_CAP } from "./useMemoryExplorer";
import type { HealthKey } from "./useMemoryExplorer";
import { PaneMessage } from "./PaneMessage";

import { t, tn } from "../../i18n";
export function PageBrowser() {
  const {
    sel,
    setSel,
    pages,
    overview,
    pagesLoading,
    pagesError,
    filter,
    setFilter,
    healthFilter,
    setHealthFilter,
    collapsed,
    setCollapsed,
    expandedGroups,
    setExpandedGroups,
    serverQuery,
    setServerQuery,
    serverAll,
    setServerAll,
    serverResults,
    setServerResults,
    serverLoading,
    serverError,
    reader,
    setPurgeOpen,
    setPurgeInput,
    setActionError,
    setMaintOpen,
    selected,
    loadProject,
    openPage,
    runServerSearch,
    filteredPages,
    groups,
    filtering,
    readerInSel,
  } = useMemoryExplorerState();
  const badge = (
    label: string,
    count: number,
    key: HealthKey | null,
  ) => (
    <button
      key={label}
      type="button"
      disabled={!key || count === 0}
      onClick={() => key && setHealthFilter(healthFilter === key ? null : key)}
      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
        count === 0
          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
          : "bg-amber-50 border-amber-300 text-amber-800"
      } ${healthFilter === key && key ? "ring-2 ring-amber-400" : ""} ${key && count ? "hover:bg-amber-100 cursor-pointer" : "cursor-default"}`}
      title={key && count ? t("pages.filterHint") : undefined}
    >
      {label} {count}
    </button>
  );

  return (
      <section
        aria-label={t("pages.label")}
        className="w-64 xl:w-80 shrink-0 border-r border-[#dfdacd] flex flex-col min-h-0"
      >
        {!sel ? (
          <PaneMessage>{t("pages.selectProject")}</PaneMessage>
        ) : (
          <>
            <div className="p-2.5 border-b border-[#eeeae0] space-y-2">
              <div className="flex items-start gap-1.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold truncate">{sel.p}</div>
                  <div className="text-[10px] text-[#8c8270] truncate">
                    {sel.ws} · {tn("pages.count", pages.length)}
                    {selected ? ` · ${tn("pages.sessions", selected.sessionCount)}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => setMaintOpen(true)}
                  title={t("maintenance.title")}
                  className="px-2 py-1 rounded-lg text-[11px] font-bold bg-[#1c1b18] text-white hover:bg-[#32302b] flex items-center gap-1"
                >
                  <Wand2 size={12} /> {t("pages.maintenance")}
                </button>
                <button
                  onClick={() => {
                    setActionError("");
                    setPurgeInput("");
                    setPurgeOpen(true);
                  }}
                  disabled={!canPurgeProject(sel.ws, sel.p)}
                  title={
                    canPurgeProject(sel.ws, sel.p)
                      ? t("purge.title")
                      : t("pages.protectedProject")
                  }
                  className="p-1.5 rounded-lg text-rose-700 hover:bg-rose-50 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {overview && (
                <div className="flex flex-wrap gap-1">
                  {badge(t("pages.orphans"), overview.health.orphans, "orphans")}
                  {badge(t("pages.duplicates"), overview.health.duplicates, "duplicates")}
                  {badge(t("pages.stale"), overview.health.stale, "stale")}
                  {badge(t("pages.contradictions"), overview.health.contradictions, null)}
                </div>
              )}
              {healthFilter && (
                <button
                  onClick={() => setHealthFilter(null)}
                  className="text-[10px] underline text-amber-800"
                >
                  {t("pages.clearHealthFilter")}
                </button>
              )}
              <div className="relative">
                <Search
                  size={12}
                  className="absolute left-2 top-2 text-[#9c9381]"
                />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t("pages.filterPlaceholder")}
                  className="w-full pl-6 pr-2 py-1.5 rounded-lg border border-[#d6cfbe] bg-[#fcfbfa] text-xs outline-none focus:border-[#968d7a]"
                />
              </div>
              <form onSubmit={runServerSearch} className="space-y-1">
                <div className="flex gap-1">
                  <input
                    value={serverQuery}
                    onChange={(e) => setServerQuery(e.target.value)}
                    placeholder={t("pages.serverSearch")}
                    className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-[#d6cfbe] bg-[#fcfbfa] text-xs outline-none focus:border-[#968d7a]"
                  />
                  <button
                    type="submit"
                    className="px-2 rounded-lg bg-[#ede9de] hover:bg-[#e2dcce] text-xs font-bold"
                  >
                    {t("pages.search")}
                  </button>
                </div>
                <label className="flex items-center gap-1.5 text-[10px] text-[#6d6657]">
                  <input
                    type="checkbox"
                    checked={serverAll}
                    onChange={(e) => setServerAll(e.target.checked)}
                  />
                  {t("pages.allProjects")}
                </label>
              </form>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {serverLoading && <PaneMessage>{t("pages.searching")}</PaneMessage>}
              {serverError && <PaneMessage tone="error">{serverError}</PaneMessage>}
              {serverResults && (
                <div>
                  <div className="px-2.5 py-1.5 flex items-center justify-between text-[11px] font-bold bg-[#f4f1e8]">
                    <span>{t("pages.results", { count: serverResults.length })}</span>
                    <button
                      className="underline font-normal"
                      onClick={() => setServerResults(null)}
                    >
                      limpar
                    </button>
                  </div>
                  {!serverResults.length && (
                    <PaneMessage>{t("pages.noResults")}</PaneMessage>
                  )}
                  {serverResults.map((r, i) => (
                    <button
                      key={`${r.workspace}/${r.project}/${r.path}/${i}`}
                      onClick={() => {
                        const target = { ws: r.workspace, p: r.project };
                        if (!sel || sel.ws !== target.ws || sel.p !== target.p)
                          setSel(target);
                        void openPage(target, r.path);
                      }}
                      className="w-full text-left px-2.5 py-2 border-b border-[#f0ece1] hover:bg-[#f4f1e8]"
                    >
                      <div className="text-xs font-semibold truncate">
                        {r.title || r.path}
                      </div>
                      <div className="text-[10px] text-[#8c8270] truncate font-mono">
                        {serverAll ? `${r.workspace}/${r.project} · ` : ""}
                        {r.path}
                      </div>
                      {r.snippet && (
                        <div className="text-[10px] text-[#6d6657] line-clamp-2">
                          {r.snippet}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {!serverResults && (
                <>
                  {pagesLoading && <PaneMessage>{t("pages.loading")}</PaneMessage>}
                  {pagesError && (
                    <PaneMessage tone="error">
                      {pagesError}
                      <button
                        className="block mt-2 underline"
                        onClick={() => sel && void loadProject(sel)}
                      >
                        {t("common.retry")}
                      </button>
                    </PaneMessage>
                  )}
                  {!pagesLoading && !pagesError && !filteredPages.length && (
                    <PaneMessage>
                      {pages.length
                        ? t("pages.noMatch")
                        : t("pages.empty")}
                    </PaneMessage>
                  )}
                  {groups.map((g) => {
                    const isCollapsed = filtering ? false : !!collapsed[g.id];
                    const cap = expandedGroups[g.id]
                      ? g.pages.length
                      : GROUP_CAP;
                    return (
                      <div key={g.id}>
                        <button
                          onClick={() =>
                            setCollapsed((c) => ({ ...c, [g.id]: !isCollapsed }))
                          }
                          className="w-full flex items-center gap-1 px-2.5 py-1.5 bg-[#f4f1e8] border-y border-[#eeeae0] text-[11px] font-bold text-[#443e33] sticky top-0 z-10"
                        >
                          {isCollapsed ? (
                            <ChevronRight size={12} />
                          ) : (
                            <ChevronDown size={12} />
                          )}
                          <span className="flex-1 text-left">{g.label}</span>
                          <span className="font-mono text-[10px] text-[#8c8270]">
                            {g.pages.length}
                          </span>
                        </button>
                        {!isCollapsed && (
                          <>
                            {g.pages.slice(0, cap).map((pg) => {
                              const active =
                                readerInSel && reader?.path === pg.path;
                              return (
                                <button
                                  key={pg.path}
                                  onClick={() => void openPage(sel, pg.path)}
                                  className={`w-full text-left px-2.5 py-1.5 border-b border-[#f0ece1] ${active ? "bg-[#ede9de]" : "hover:bg-[#f7f5ef]"}`}
                                >
                                  <div className="text-xs font-semibold text-[#1c1b18] truncate">
                                    {pg.title}
                                  </div>
                                  <div className="text-[10px] text-[#9c9381] truncate font-mono">
                                    {pg.path}
                                  </div>
                                  <div className="flex items-center gap-1 mt-0.5 text-[9px]">
                                    {pg.kind && (
                                      <span className="px-1 rounded bg-[#ece7db] text-[#665e4f]">
                                        {pg.kind}
                                      </span>
                                    )}
                                    {pg.tier && (
                                      <span className="px-1 rounded bg-sky-100 text-sky-800">
                                        {pg.tier}
                                      </span>
                                    )}
                                    <span className="text-[#9c9381] ml-auto">
                                      {formatDate(pg.updatedAt)}
                                    </span>
                                  </div>
                                </button>
                              );
                            })}
                            {g.pages.length > cap && (
                              <button
                                className="w-full text-[11px] underline p-2 text-[#6d6657]"
                                onClick={() =>
                                  setExpandedGroups((x) => ({
                                    ...x,
                                    [g.id]: true,
                                  }))
                                }
                              >
                                Mostrar mais ({g.pages.length - cap})
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </>
        )}
      </section>
  );
}
