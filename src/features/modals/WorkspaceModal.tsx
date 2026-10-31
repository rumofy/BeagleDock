import React, { useState } from "react";
import { X, FolderOpen, FolderSearch } from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";
import { backendAvailable, beagleApi } from "../../api/beagleApi";
import type { WorkspaceItem } from "../../types";

export function WorkspaceModal() {
  const {
    setAppError,
    showWorkspaceModal,
    setShowWorkspaceModal,
    workspaces,
    setWorkspaces,
    currentSession,
    handleWorkspaceChange,
  } = useApp();
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspacePath, setNewWorkspacePath] = useState("");
  const [pickedInfo, setPickedInfo] = useState("");

  // Seletor de pastas do sistema operacional; digitar o caminho continua possível.
  const handlePickFolder = async () => {
    try {
      const picked = await beagleApi.pickDirectory({
        defaultPath: newWorkspacePath.trim() || undefined,
      });
      if (picked.error) setAppError(picked.error);
      if (picked.canceled || !picked.path) return;
      setNewWorkspacePath(picked.path);
      if (!newWorkspaceName.trim() && picked.name)
        setNewWorkspaceName(picked.name);
      setPickedInfo(
        [
          workspaces.some((w) => w.path === picked.path)
            ? "Esta pasta já está cadastrada; salvar atualiza o workspace."
            : "",
          picked.isGitRepo ? "Repositório git" : "",
          picked.hasAIMemory ? "ai-memory configurado" : "",
        ]
          .filter(Boolean)
          .join(" · "),
      );
    } catch (error) {
      setAppError((error as Error).message);
    }
  };

  const handleAddWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspacePath.trim()) return;

    const name =
      newWorkspaceName.trim() ||
      newWorkspacePath.split(/[\\/]/).filter(Boolean).pop() ||
      "Workspace";
    let newWs: WorkspaceItem = {
      id: `ws-${Date.now()}`,
      name,
      path: newWorkspacePath.trim(),
      hasAIMemory: false,
    };
    if (backendAvailable()) {
      try {
        const saved = await beagleApi.saveWorkspace(newWs);
        if (saved?.success === false) throw new Error(saved.error);
        newWs = saved;
      } catch (err) {
        setAppError((err as Error).message);
        return;
      }
    }

    setWorkspaces((prev) => [
      ...prev.filter((w) => w.path !== newWs.path),
      newWs,
    ]);
    if (currentSession) {
      handleWorkspaceChange(newWs.path);
    }
    setNewWorkspaceName("");
    setNewWorkspacePath("");
    setPickedInfo("");
    setShowWorkspaceModal(false);
  };

  if (!showWorkspaceModal) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-[#ffffff] border border-[#d8d2c3] rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#eeeae0]">
          <div className="flex items-center gap-2">
            <FolderOpen size={20} className="text-[#8c8270]" />
            <h3 className="font-bold text-base text-[#1c1b18]">
              Cadastrar Novo Workspace
            </h3>
          </div>
          <button
            onClick={() => setShowWorkspaceModal(false)}
            className="p-1 hover:bg-[#ede9de] rounded-lg text-[#6d6657]"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleAddWorkspace} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#443e33] uppercase tracking-wider mb-1">
              Nome do Projeto
            </label>
            <input
              type="text"
              placeholder="Ex: API, App Mobile..."
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[#d6cfbe] bg-[#fcfbfa] text-sm outline-none focus:border-[#968d7a]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#443e33] uppercase tracking-wider mb-1">
              Caminho Absoluto no Disco
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Escolha a pasta ou cole o caminho"
                value={newWorkspacePath}
                onChange={(e) => {
                  setNewWorkspacePath(e.target.value);
                  setPickedInfo("");
                }}
                required
                className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-[#d6cfbe] bg-[#fcfbfa] text-sm font-mono outline-none focus:border-[#968d7a]"
              />
              <button
                type="button"
                onClick={handlePickFolder}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#d6cfbe] bg-[#f4f1e8] hover:bg-[#ede9de] text-xs font-bold text-[#2c2822] transition"
              >
                <FolderSearch size={14} /> Escolher pasta
              </button>
            </div>
            {pickedInfo && (
              <p className="mt-1.5 text-[11px] text-[#6d6657]">{pickedInfo}</p>
            )}
          </div>

          <div className="p-3 rounded-xl bg-[#f8f7f2] border border-[#eae4d7] text-xs text-[#6d6657] space-y-1">
            <div className="font-semibold text-[#2c2822]">
              💡 Persistência no SQLite & Auto-detecção:
            </div>
            <p>
              O BeagleDock grava o workspace na tabela `workspaces` e verifica
              se existe `.ai-memory.toml` ou `AGENTS.md`.
            </p>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowWorkspaceModal(false)}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-[#6d6657] hover:bg-[#ede9de] transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!newWorkspacePath.trim()}
              className="px-4 py-2 rounded-xl bg-[#1c1b18] hover:bg-[#32302b] disabled:opacity-30 text-white text-xs font-bold transition"
            >
              Salvar Workspace
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
