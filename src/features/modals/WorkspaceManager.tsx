import { useCallback, useEffect, useState } from "react";
import { Code2, FolderSearch, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { Modal } from "../../components/Modal";
import { useApp } from "../../hooks/AppStateProvider";
import { beagleApi } from "../../api/beagleApi";
import type { WorkspaceItem, WorkspaceStatus } from "../../types";

import { t, tn } from "../../i18n";
/** Maintenance of registered workspaces: folder state, rename, change the folder and remove. */
export function WorkspaceManager() {
  const { showWorkspaceManager, setShowWorkspaceManager, setWorkspaces, setAppError } = useApp();
  const [items, setItems] = useState<WorkspaceStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string; path: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await beagleApi.listWorkspaceStatus();
      if (!result.success) throw new Error(result.error || t("workspaces.loadFailed"));
      setItems(result.workspaces);
      setWorkspaces(
        result.workspaces.map(
          ({ id, name, path, hasAIMemory }): WorkspaceItem => ({ id, name, path, hasAIMemory }),
        ),
      );
    } catch (error) {
      setAppError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [setAppError, setWorkspaces]);

  useEffect(() => {
    if (showWorkspaceManager) void refresh();
    else {
      setEditing(null);
      setRemoving(null);
    }
  }, [showWorkspaceManager, refresh]);

  if (!showWorkspaceManager) return null;

  const pickFolder = async () => {
    if (!editing) return;
    try {
      const picked = await beagleApi.pickDirectory({ defaultPath: editing.path || undefined });
      if (picked.error) setAppError(picked.error);
      if (picked.canceled || !picked.path) return;
      setEditing({ ...editing, path: picked.path });
    } catch (error) {
      setAppError((error as Error).message);
    }
  };

  const save = async () => {
    if (!editing) return;
    try {
      const result = await beagleApi.updateWorkspace(editing);
      if (!result.success) throw new Error(result.error || t("workspaces.saveFailed"));
      setEditing(null);
      await refresh();
    } catch (error) {
      setAppError((error as Error).message);
    }
  };

  const openInVsCode = async (cwd: string) => {
    try {
      const result = await beagleApi.openInEditor({ cwd });
      if (!result?.ok) setAppError(result?.error || t("header.vsCodeFailed"));
    } catch (error) {
      setAppError((error as Error).message);
    }
  };

  const remove = async (id: string) => {
    try {
      const result = await beagleApi.deleteWorkspace(id);
      if (!result.success) throw new Error(result.error || t("workspaces.removeFailed"));
      setRemoving(null);
      await refresh();
    } catch (error) {
      setAppError((error as Error).message);
    }
  };

  return (
    <Modal title={t("header.manageWorkspaces")} onClose={() => setShowWorkspaceManager(false)} wide>
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#6d6657]">
          {t("workspaces.intro")}
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          title={t("workspaces.refresh")}
          className="shrink-0 ml-3 p-2 rounded-lg hover:bg-[#ede9de] text-[#6d6657] disabled:opacity-40"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      <ul data-testid="workspace-list" className="space-y-2">
        {items.length === 0 && !loading && (
          <li className="text-xs text-[#8c8270] py-4 text-center">{t("workspaces.none")}</li>
        )}
        {items.map((ws) => (
          <li key={ws.id} className="rounded-xl border border-[#e4dec9] bg-[#fcfbfa] p-3 space-y-2">
            {editing?.id === ws.id ? (
              <div className="space-y-2">
                <input
                  aria-label={t("workspaces.name")}
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-lg border border-[#d6cfbe] bg-white text-sm outline-none focus:border-[#968d7a]"
                />
                <div className="flex gap-2">
                  <input
                    aria-label={t("workspaces.folder")}
                    value={editing.path}
                    onChange={(e) => setEditing({ ...editing, path: e.target.value })}
                    className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-[#d6cfbe] bg-white text-xs font-mono outline-none focus:border-[#968d7a]"
                  />
                  <button
                    type="button"
                    onClick={pickFolder}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#d6cfbe] bg-[#f4f1e8] hover:bg-[#ede9de] text-xs font-bold text-[#2c2822]"
                  >
                    <FolderSearch size={13} /> {t("workspaces.chooseFolder")}
                  </button>
                </div>
                {ws.conversations > 0 && editing.path !== ws.path && (
                  <p className="text-[11px] text-[#8a4b0f]">
                    {t("workspaces.moveNote", { count: ws.conversations })}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#6d6657] hover:bg-[#ede9de]">
                    {t("common.cancel")}
                  </button>
                  <button type="button" onClick={() => void save()} disabled={!editing.name.trim() || !editing.path.trim()} className="px-3 py-1.5 rounded-lg bg-[#1c1b18] hover:bg-[#32302b] disabled:opacity-30 text-white text-xs font-bold">
                    {t("common.save")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm text-[#1c1b18] truncate">{ws.name}</div>
                    <div className="font-mono text-[11px] text-[#7d7565] truncate" title={ws.path}>
                      {ws.path}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={t("workspaces.openInVsCode", { name: ws.name })}
                    title={ws.exists ? t("workspaces.openFolderHint") : t("workspaces.folderMissingHint")}
                    disabled={!ws.exists}
                    onClick={() => void openInVsCode(ws.path)}
                    className="p-1.5 rounded-lg hover:bg-[#ede9de] text-[#6d6657] disabled:opacity-30"
                  >
                    <Code2 size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("workspaces.editLabel", { name: ws.name })}
                    title={t("workspaces.editHint")}
                    onClick={() => setEditing({ id: ws.id, name: ws.name, path: ws.path })}
                    className="p-1.5 rounded-lg hover:bg-[#ede9de] text-[#6d6657]"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("workspaces.removeLabel", { name: ws.name })}
                    title={t("workspaces.removeHint")}
                    onClick={() => setRemoving(ws.id)}
                    className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-700"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold">
                  <span className={`px-1.5 py-0.5 rounded ${ws.exists ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
                    {ws.exists ? t("workspaces.folderFound") : t("workspaces.folderMissing")}
                  </span>
                  {ws.isGitRepo && <span className="px-1.5 py-0.5 rounded bg-[#f4f1e8] text-[#665e4f]">git</span>}
                  {ws.hasAIMemory && <span className="px-1.5 py-0.5 rounded bg-[#f4f1e8] text-[#665e4f]">ai-memory</span>}
                  <span className="px-1.5 py-0.5 rounded bg-[#f4f1e8] text-[#665e4f]">
                    {tn("workspaces.conversations", ws.conversations)}
                  </span>
                </div>
                {removing === ws.id && (
                  <div role="alertdialog" className="rounded-lg bg-rose-50 border border-rose-200 p-2 text-xs text-rose-900 space-y-2">
                    <p>
                      {t("workspaces.removeConfirm", { name: ws.name, count: ws.conversations })}
                    </p>
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setRemoving(null)} className="px-3 py-1 rounded-lg text-xs font-semibold hover:bg-rose-100">
                        {t("common.cancel")}
                      </button>
                      <button type="button" onClick={() => void remove(ws.id)} className="px-3 py-1 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold">
                        {t("common.remove")}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
