import { useCallback, useEffect, useState } from "react";
import { beagleApi } from "../../api/beagleApi";
import type { AIMemoryProject, AIMemoryScope } from "../../types";
import { t, type MessageKey } from "../../i18n";

const SOURCE_LABEL: Record<AIMemoryScope["source"], MessageKey> = {
  marker: "workspaces.memorySource_marker",
  git: "workspaces.memorySource_git",
  folder: "workspaces.memorySource_folder",
};

const keyOf = (p: { workspace: string; project: string }) => `${p.workspace}/${p.project}`;

/** Shows which ai-memory project a workspace folder writes to and links it to an existing one. */
export function WorkspaceMemoryLink({
  path,
  onChanged,
  onError,
}: {
  path: string;
  /** Whether the folder now has its own `.ai-memory.toml` (drives the workspace's badge). */
  onChanged: (hasAIMemory: boolean) => void;
  onError: (message: string) => void;
}) {
  const [scope, setScope] = useState<AIMemoryScope | null>(null);
  const [projects, setProjects] = useState<AIMemoryProject[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([
        beagleApi.getAIMemoryScope(path),
        beagleApi.listAIMemoryProjects(),
      ]);
      setScope(s);
      const items = list.ok && list.data ? [...list.data] : null;
      items?.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
      setProjects(items);
      setSelected(s.projectExists ? keyOf(s) : "");
    } catch (error) {
      onError((error as Error).message);
    }
  }, [path, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = async (target: { workspace: string; project: string } | null) => {
    setBusy(true);
    try {
      const result = await beagleApi.linkAIMemoryProject(path, target);
      if (!result.success) throw new Error(result.error || t("workspaces.memoryLinkFailed"));
      if (result.scope) setScope(result.scope);
      onChanged(!!result.hasAIMemory);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const link = () => {
    const target = projects?.find((p) => keyOf(p) === selected);
    if (target) void apply({ workspace: target.workspace, project: target.project });
  };

  if (!scope) return null;
  const sourceKey =
    scope.source === "marker" && !scope.localMarker
      ? "workspaces.memorySource_markerParent"
      : SOURCE_LABEL[scope.source];
  const linkedHere = scope.localMarker && scope.source === "marker";

  return (
    <div
      data-testid="workspace-memory-link"
      className="rounded-lg border border-[#e4dec9] bg-white p-2.5 space-y-2 text-xs text-[#2c2822]"
    >
      <div className="font-bold">{t("workspaces.memoryTitle")}</div>
      <p className="text-[#6d6657]">
        {t("workspaces.memoryCurrent")}{" "}
        <span className="font-mono font-semibold text-[#1c1b18]">{keyOf(scope)}</span>{" "}
        <span className="text-[#8c8270]">({t(sourceKey)})</span>
      </p>
      {scope.serverOnline && (
        <p className="text-[11px] text-[#8c8270]">
          {scope.projectExists
            ? t("workspaces.memoryPages", { count: scope.pages ?? 0 })
            : t("workspaces.memoryNew")}
        </p>
      )}
      {projects ? (
        <div className="flex gap-2">
          <select
            aria-label={t("workspaces.memoryPick")}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-[#d6cfbe] bg-white text-xs font-mono outline-none focus:border-[#968d7a]"
          >
            <option value="">{t("workspaces.memoryPickPlaceholder")}</option>
            {projects.map((p) => (
              <option key={p.projectId || keyOf(p)} value={keyOf(p)}>
                {keyOf(p)} ({p.pageCount})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={link}
            disabled={busy || !selected || (linkedHere && selected === keyOf(scope))}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-[#1c1b18] hover:bg-[#32302b] disabled:opacity-30 text-white text-xs font-bold"
          >
            {t("workspaces.memoryLink")}
          </button>
          {linkedHere && (
            <button
              type="button"
              onClick={() => void apply(null)}
              disabled={busy}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#6d6657] hover:bg-[#ede9de] disabled:opacity-30"
            >
              {t("workspaces.memoryUnlink")}
            </button>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-[#8a4b0f]">{t("workspaces.memoryOffline")}</p>
      )}
      <p className="text-[11px] text-[#8c8270]">{t("workspaces.memoryNote")}</p>
    </div>
  );
}
