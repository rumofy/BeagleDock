import {
  AlertTriangle,
} from "lucide-react";
import { useMemoryExplorerState } from "./MemoryExplorerContext";
import { Modal } from "../../components/Modal";
import { PaneMessage } from "./PaneMessage";

export function DeletePageDialog() {
  const {
    reader,
    page,
    deleteOpen,
    setDeleteOpen,
    deleteInput,
    setDeleteInput,
    busyAction,
    actionError,
    protection,
    fileName,
    canConfirmDelete,
    doDelete,
  } = useMemoryExplorerState();
  if (!(deleteOpen && page && reader)) return null;

  return (
        <Modal title="Excluir página" onClose={() => setDeleteOpen(false)}>
          <p className="text-sm">
            Excluir <code className="font-mono">{page.path}</code> de{" "}
            <b>
              {reader.ws}/{reader.p}
            </b>
            ?
          </p>
          {protection === "never" && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-300 text-xs text-rose-900 flex gap-2">
              <AlertTriangle size={16} className="shrink-0" />
              <span>
                Atenção: páginas em <b>decisions/</b> registram decisões
                duradouras e não devem ser excluídas. Para confirmar, digite o
                nome do arquivo: <b className="font-mono">{fileName}</b>
              </span>
            </div>
          )}
          {protection === "merge" && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-900 flex gap-2">
              <AlertTriangle size={16} className="shrink-0" />
              <span>
                Esta página é protegida. Mescle o conteúdo útil em outra página
                antes de excluir.
              </span>
            </div>
          )}
          {protection === "never" && (
            <input
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              placeholder={fileName}
              className="w-full px-3 py-2 rounded-xl border border-[#d6cfbe] text-sm font-mono outline-none"
            />
          )}
          {actionError && <PaneMessage tone="error">{actionError}</PaneMessage>}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setDeleteOpen(false)}
              className="px-3 py-2 rounded-lg text-xs font-bold bg-[#ede9de]"
            >
              Cancelar
            </button>
            <button
              disabled={!canConfirmDelete || busyAction}
              onClick={() => void doDelete()}
              className="px-3 py-2 rounded-lg text-xs font-bold bg-rose-700 text-white disabled:opacity-40"
            >
              {busyAction ? "Excluindo…" : "Excluir página"}
            </button>
          </div>
        </Modal>
  );
}
