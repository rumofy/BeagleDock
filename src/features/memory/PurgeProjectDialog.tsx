import {
  AlertTriangle,
} from "lucide-react";
import { useMemoryExplorerState } from "./MemoryExplorerContext";
import { Modal } from "../../components/Modal";
import { PaneMessage } from "./PaneMessage";

import { t } from "../../i18n";
export function PurgeProjectDialog() {
  const {
    sel,
    purgeOpen,
    setPurgeOpen,
    purgeInput,
    setPurgeInput,
    busyAction,
    actionError,
    doPurge,
  } = useMemoryExplorerState();
  if (!(purgeOpen && sel)) return null;

  return (
        <Modal title={t("purge.title")} onClose={() => setPurgeOpen(false)}>
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-300 text-xs text-rose-900 flex gap-2">
            <AlertTriangle size={16} className="shrink-0" />
            <span>
              {t("purge.before")} <b>{t("purge.irreversible")}</b>{t("purge.after")}{" "}
              <b>
                {sel.ws}/{sel.p}
              </b>
              .
            </span>
          </div>
          <p className="text-xs">
            Para confirmar, digite{" "}
            <b className="font-mono">
              {sel.ws}/{sel.p}
            </b>
            :
          </p>
          <input
            value={purgeInput}
            onChange={(e) => setPurgeInput(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-[#d6cfbe] text-sm font-mono outline-none"
          />
          {actionError && <PaneMessage tone="error">{actionError}</PaneMessage>}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setPurgeOpen(false)}
              className="px-3 py-2 rounded-lg text-xs font-bold bg-[#ede9de]"
            >
              {t("common.cancel")}
            </button>
            <button
              disabled={purgeInput !== `${sel.ws}/${sel.p}` || busyAction}
              onClick={() => void doPurge()}
              className="px-3 py-2 rounded-lg text-xs font-bold bg-rose-700 text-white disabled:opacity-40"
            >
              {busyAction ? t("memory.deleting") : t("purge.title")}
            </button>
          </div>
        </Modal>
  );
}
