import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { beagleApi } from "../../api/beagleApi";
import type {
  AIMemoryApiResult,
  AIMemoryOverview,
  AIMemoryPageContent,
  AIMemoryPageItem,
  AIMemoryProject,
  AIMemoryStatus,
  AIMemoryWikiPage,
  AIProviderId,
  AIProviderStatus,
  UserProfile,
} from "../../types";
import type { MaintenanceChat } from "./MaintenanceChatPane";
import {
  frontmatterEntries,
  groupPages,
  isTestProject,
  protectionFor,
  resolveWikiTarget,
  splitFrontmatter,
} from "./memoryUtils";

const LAST_PROJECT_KEY = "beagledock.memory.lastProject";
export const GROUP_CAP = 150;

export type Sel = { ws: string; p: string };
export type HealthKey = "orphans" | "duplicates" | "stale";

export interface MemoryExplorerProps {
  providers: AIProviderStatus[];
  memoryStatus: AIMemoryStatus;
  userProfile: UserProfile;
  onRefreshStatus: () => void | Promise<void>;
  onStartMaintenance: (args: {
    providerId: AIProviderId;
    model: string;
    effort: string;
    title: string;
    prompt: string;
  }) => Promise<string | null>;
  chat: MaintenanceChat | null;
}

function readLast(): string {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY) || "";
  } catch {
    return "";
  }
}
export function writeLast(v: string) {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, v);
  } catch {}
}


/** Estado e ações do explorador do ai-memory (projetos, páginas, leitor, exclusão e manutenção). */
export function useMemoryExplorer({
  providers,
  memoryStatus,
  userProfile,
  onRefreshStatus,
  onStartMaintenance,
  chat,
}: MemoryExplorerProps) {
  const [projects, setProjects] = useState<AIMemoryProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [sel, setSel] = useState<Sel | null>(null);
  const [pages, setPages] = useState<AIMemoryPageItem[]>([]);
  const [overview, setOverview] = useState<AIMemoryOverview | null>(null);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState("");
  const [filter, setFilter] = useState("");
  const [healthFilter, setHealthFilter] = useState<HealthKey | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    sessions: true,
  });
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightTab, setRightTab] = useState<"reader" | "chat">("reader");

  const [serverQuery, setServerQuery] = useState("");
  const [serverAll, setServerAll] = useState(false);
  const [serverResults, setServerResults] = useState<AIMemoryWikiPage[] | null>(
    null,
  );
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState("");

  const [reader, setReader] = useState<{
    ws: string;
    p: string;
    path: string;
  } | null>(null);
  const [page, setPage] = useState<AIMemoryPageContent | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [linkMissing, setLinkMissing] = useState("");
  const [copied, setCopied] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeInput, setPurgeInput] = useState("");
  const [busyAction, setBusyAction] = useState(false);
  const [actionError, setActionError] = useState("");
  const [maintOpen, setMaintOpen] = useState(false);

  const projectToken = useRef(0);
  const pageToken = useRef(0);
  const maintTarget = useRef<Sel | null>(null);

  const selected = useMemo(
    () =>
      sel
        ? projects.find((x) => x.workspace === sel.ws && x.project === sel.p) ||
          null
        : null,
    [projects, sel],
  );

  const loadProjects = useCallback(async () => {
        setProjectsLoading(true);
    setProjectsError("");
    try {
      const res = await beagleApi.listAIMemoryProjects();
      if (!res?.ok) throw new Error(res?.error || "Falha ao listar projetos.");
      const list: AIMemoryProject[] = res.data || [];
      setProjects(list);
      setSel((cur) => {
        if (cur && list.some((x) => x.workspace === cur.ws && x.project === cur.p))
          return cur;
        const last = readLast();
        const found = list.find((x) => `${x.workspace}/${x.project}` === last);
        const first = list.find(
          (x) => !isTestProject(x.project) && x.pageCount > 0,
        );
        const pick = found || first || list[0];
        return pick ? { ws: pick.workspace, p: pick.project } : null;
      });
    } catch (e) {
      setProjects([]);
      setProjectsError((e as Error).message);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const loadProject = useCallback(async (s: Sel) => {
    const token = ++projectToken.current;
    setPagesLoading(true);
    setPagesError("");
    const [pagesRes, ovRes] = await Promise.all([
      beagleApi.listAIMemoryProjectPages(s.ws, s.p).catch(
        (e: Error): AIMemoryApiResult<AIMemoryPageItem[]> => ({
          ok: false,
          error: e.message,
        }),
      ),
      beagleApi.getAIMemoryProjectOverview(s.ws, s.p).catch((): AIMemoryApiResult<any> => ({ ok: false })),
    ]);
    if (token !== projectToken.current) return;
    if (pagesRes?.ok) {
      setPages(pagesRes.data || []);
    } else {
      setPages([]);
      setPagesError(pagesRes?.error || "Falha ao listar páginas.");
    }
    setOverview(ovRes?.ok ? ovRes.data : null);
    setPagesLoading(false);
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!sel) return;
    writeLast(`${sel.ws}/${sel.p}`);
    setFilter("");
    setHealthFilter(null);
    setServerResults(null);
    setServerError("");
    setExpandedGroups({});
    void loadProject(sel);
  }, [sel?.ws, sel?.p, loadProject]);

  // Ao terminar um turno da manutenção, atualiza o projeto.
  const wasExecuting = useRef(false);
  useEffect(() => {
    if (wasExecuting.current && chat && !chat.executing && maintTarget.current) {
      void loadProject(maintTarget.current);
      void loadProjects();
    }
    wasExecuting.current = !!chat?.executing;
  }, [chat?.executing]);

  useEffect(() => {
    if (chat) setRightTab("chat");
    else setRightTab("reader");
  }, [chat?.session.id]);

  const openPage = useCallback(async (s: Sel, path: string) => {
    const token = ++pageToken.current;
    setReader({ ws: s.ws, p: s.p, path });
    setRightTab("reader");
    setPage(null);
    setPageError("");
    setLinkMissing("");
    setPageLoading(true);
    try {
      const res = await beagleApi.readAIMemoryPage(path, s.ws, s.p);
      if (token !== pageToken.current) return;
      if (res?.ok && res.data) {
        setPage({
          ...res.data,
          path: res.data.path || path,
          title: res.data.title || path,
          body: res.data.body ?? res.data.body_markdown ?? "",
        });
      } else if (res?.rawText) {
        setPage({
          path,
          title: path,
          kind: "",
          tier: "",
          updatedAt: "",
          body: res.rawText,
        });
      } else {
        setPageError(
          res?.notFound
            ? "Página não encontrada."
            : res?.error || "Falha ao ler a página.",
        );
      }
    } catch (e) {
      if (token === pageToken.current) setPageError((e as Error).message);
    } finally {
      if (token === pageToken.current) setPageLoading(false);
    }
  }, []);

  const handleWikiLink = (target: string) => {
    if (!reader) return;
    const sameProject = sel && sel.ws === reader.ws && sel.p === reader.p;
    const path = sameProject ? resolveWikiTarget(target, pages) : null;
    if (!path) {
      setLinkMissing(target);
      return;
    }
    void openPage({ ws: reader.ws, p: reader.p }, path);
  };

  const runServerSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = serverQuery.trim();
    if (!q) {
      setServerResults(null);
      return;
    }
    setServerLoading(true);
    setServerError("");
    try {
      const res = await beagleApi.searchAIMemory(
        q,
        serverAll,
        sel?.ws,
        sel?.p,
      );
      if (!res?.ok) throw new Error(res?.error || "Falha na busca.");
      setServerResults(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setServerResults(null);
      setServerError((err as Error).message);
    } finally {
      setServerLoading(false);
    }
  };

  const refreshAll = () => {
    void onRefreshStatus();
    void loadProjects();
    if (sel) void loadProject(sel);
  };

  const visibleProjects = useMemo(() => {
    const sorted = [...projects].sort((a, b) =>
      (b.lastActivity || b.lastUpdated).localeCompare(
        a.lastActivity || a.lastUpdated,
      ),
    );
    return sorted;
  }, [projects]);
  const hiddenCount = visibleProjects.filter(
    (x) => isTestProject(x.project) || x.pageCount === 0,
  ).length;
  const shownProjects = visibleProjects.filter(
    (x) =>
      showHidden ||
      (sel && x.workspace === sel.ws && x.project === sel.p) ||
      (!isTestProject(x.project) && x.pageCount > 0),
  );

  const healthPaths = useMemo(() => {
    if (!overview || !healthFilter) return null;
    const h = overview.health;
    const list =
      healthFilter === "orphans"
        ? h.orphanPages
        : healthFilter === "duplicates"
          ? h.duplicatePages
          : h.stalePages;
    return new Set(list.map((x) => x.path));
  }, [overview, healthFilter]);

  const filteredPages = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return pages.filter(
      (x) =>
        (!healthPaths || healthPaths.has(x.path)) &&
        (!q ||
          x.title.toLowerCase().includes(q) ||
          x.path.toLowerCase().includes(q)),
    );
  }, [pages, filter, healthPaths]);
  const groups = useMemo(() => groupPages(filteredPages), [filteredPages]);
  const filtering = !!filter.trim() || !!healthFilter;

  const readerInSel =
    reader && sel && reader.ws === sel.ws && reader.p === sel.p;
  const protection = page ? protectionFor(page.path) : "none";
  const fileName = page ? page.path.split("/").pop() || page.path : "";
  const canConfirmDelete =
    protection === "never" ? deleteInput === fileName : true;

  const doDelete = async () => {
    if (!reader || !page) return;
    setBusyAction(true);
    setActionError("");
    try {
      const res = await beagleApi.deleteAIMemoryPage(
        reader.ws,
        reader.p,
        page.path,
        protection !== "none" ? page.path : undefined,
      );
      if (!res?.ok) throw new Error(res?.error || "Falha ao excluir a página.");
      setDeleteOpen(false);
      setDeleteInput("");
      setPage(null);
      setReader(null);
      await Promise.all([
        loadProject({ ws: reader.ws, p: reader.p }),
        loadProjects(),
      ]);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyAction(false);
    }
  };

  const doPurge = async () => {
    if (!sel) return;
    setBusyAction(true);
    setActionError("");
    try {
      const res = await beagleApi.purgeAIMemoryProject(
        sel.ws,
        sel.p,
        `${sel.ws}/${sel.p}`,
      );
      if (!res?.ok) throw new Error(res?.error || "Falha ao excluir o projeto.");
      setPurgeOpen(false);
      setPurgeInput("");
      setPage(null);
      setReader(null);
      setPages([]);
      setOverview(null);
      setSel(null);
      await loadProjects();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyAction(false);
    }
  };

  const copyPath = async () => {
    if (!page) return;
    try {
      await navigator.clipboard.writeText(page.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const online = !projectsError && !projectsLoading ? projects.length >= 0 : null;
  const meta = page
    ? (() => {
        const split = splitFrontmatter(page.body);
        const entries = split.meta.length
          ? split.meta
          : frontmatterEntries(page.frontmatter);
        const base: Array<[string, string]> = [];
        if (page.kind) base.push(["kind", page.kind]);
        if (page.tier) base.push(["tier", page.tier]);
        if (page.updatedAt) base.push(["updated", page.updatedAt]);
        const keys = new Set(base.map(([k]) => k));
        return {
          body: split.body,
          entries: [
            ...base,
            ...entries.filter(([k]) => !keys.has(k) && k !== "title"),
          ],
        };
      })()
    : null;

  return {
    providers,
    memoryStatus,
    userProfile,
    onRefreshStatus,
    onStartMaintenance,
    chat,
    projects,
    setProjects,
    projectsLoading,
    setProjectsLoading,
    projectsError,
    setProjectsError,
    showHidden,
    setShowHidden,
    sel,
    setSel,
    pages,
    setPages,
    overview,
    setOverview,
    pagesLoading,
    setPagesLoading,
    pagesError,
    setPagesError,
    filter,
    setFilter,
    healthFilter,
    setHealthFilter,
    collapsed,
    setCollapsed,
    expandedGroups,
    setExpandedGroups,
    leftCollapsed,
    setLeftCollapsed,
    rightTab,
    setRightTab,
    serverQuery,
    setServerQuery,
    serverAll,
    setServerAll,
    serverResults,
    setServerResults,
    serverLoading,
    setServerLoading,
    serverError,
    setServerError,
    reader,
    setReader,
    page,
    setPage,
    pageLoading,
    setPageLoading,
    pageError,
    setPageError,
    linkMissing,
    setLinkMissing,
    copied,
    setCopied,
    deleteOpen,
    setDeleteOpen,
    deleteInput,
    setDeleteInput,
    purgeOpen,
    setPurgeOpen,
    purgeInput,
    setPurgeInput,
    busyAction,
    setBusyAction,
    actionError,
    setActionError,
    maintOpen,
    setMaintOpen,
    projectToken,
    pageToken,
    maintTarget,
    selected,
    loadProjects,
    loadProject,
    wasExecuting,
    openPage,
    handleWikiLink,
    runServerSearch,
    refreshAll,
    visibleProjects,
    hiddenCount,
    shownProjects,
    healthPaths,
    filteredPages,
    groups,
    filtering,
    readerInSel,
    protection,
    fileName,
    canConfirmDelete,
    doDelete,
    doPurge,
    copyPath,
    online,
    meta,
  };
}

export type MemoryExplorerState = ReturnType<typeof useMemoryExplorer>;
