import { useCallback, useEffect, useState } from "react";
import { beagleApi } from "../api/beagleApi";
import type { DictationStatus } from "../types/api";

export interface DictationDownload {
  received: number;
  total: number;
}

/** Status do ditado local (modelo baixado, motor compilado) e download do modelo com progresso. */
export function useDictationModel(onError: (message: string) => void) {
  const [status, setStatus] = useState<DictationStatus | null>(null);
  const [download, setDownload] = useState<DictationDownload | null>(null);

  const refresh = useCallback(async () => {
    if (typeof window.beagleAPI?.getDictationStatus !== "function") return null;
    try {
      const next = await beagleApi.getDictationStatus();
      setStatus(next);
      if (next.model.downloading)
        setDownload((d) => d ?? { received: next.model.received, total: next.model.size });
      return next;
    } catch (error) {
      onError((error as Error).message);
      return null;
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
    if (typeof window.beagleAPI?.on !== "function") return;
    return beagleApi.on("dictation-model-progress", (progress) => {
      if (progress.done) {
        setDownload(null);
        void refresh();
      } else setDownload({ received: progress.received, total: progress.total });
    });
  }, [refresh]);

  const start = useCallback(async () => {
    setDownload((d) => d ?? { received: 0, total: status?.model.size ?? 0 });
    const result = await beagleApi.downloadDictationModel();
    setDownload(null);
    await refresh();
    // Cancelar não é erro para mostrar.
    if (!result.success && !/cancelado/i.test(result.error || "")) onError(result.error || "Falha ao baixar o modelo de voz.");
    return result.success;
  }, [onError, refresh, status?.model.size]);

  const cancel = useCallback(async () => {
    await beagleApi.cancelDictationModelDownload();
  }, []);

  const remove = useCallback(async () => {
    const result = await beagleApi.removeDictationModel();
    if (!result.success) onError(result.error || "Falha ao apagar o modelo de voz.");
    await refresh();
  }, [onError, refresh]);

  const needsModel = !!status && status.engine === "local" && !status.model.installed;
  return { status, download, needsModel, refresh, start, cancel, remove };
}

export const formatMegabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;
