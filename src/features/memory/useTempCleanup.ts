import { useCallback, useEffect, useState } from "react";
import { backendAvailable, beagleApi } from "../../api/beagleApi";
import type { AIMemoryTempProject } from "../../types/api";

/** Configuração e execução da limpeza dos projetos temporários do ai-memory. */
export function useTempCleanup(onCleaned: () => void) {
  const [days, setDays] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [temps, setTemps] = useState<AIMemoryTempProject[]>([]);
  const [lastRun, setLastRun] = useState<{ at: string; removed: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!backendAvailable()) return;
    setLoading(true);
    try {
      const res = await beagleApi.previewAIMemoryTempCleanup();
      if (!res?.ok) throw new Error(res?.error || "Falha ao verificar os temporários.");
      setDays(res.days ?? 0);
      setDraft(String(res.days ?? 0));
      setTemps(res.projects || []);
      setLastRun(res.lastRun || null);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveDays = async () => {
    const value = Math.max(0, Math.floor(Number(draft)) || 0);
    if (value === days) return;
    setBusy(true);
    try {
      const res = await beagleApi.setAIMemoryTempCleanupDays(value);
      if (!res?.ok) throw new Error(res?.error || "Falha ao salvar o prazo.");
      setMessage(res.days ? `Prazo salvo: ${res.days} dia(s).` : "Limpeza automática desligada.");
      setError("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cleanNow = async () => {
    setBusy(true);
    setMessage("");
    try {
      const res = await beagleApi.runAIMemoryTempCleanup({ all: true });
      const removed = res?.removed?.length || 0;
      const failed = res?.failed?.length || 0;
      if (res?.error) throw new Error(res.error);
      setMessage(
        removed
          ? `${removed} projeto(s) temporário(s) apagado(s).`
          : "Nenhum projeto temporário para apagar.",
      );
      setError(failed ? `${failed} não puderam ser apagados.` : "");
      await load();
      onCleaned();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return {
    days,
    draft,
    setDraft,
    temps,
    staleCount: temps.filter((x) => x.stale).length,
    lastRun,
    loading,
    busy,
    message,
    error,
    saveDays,
    cleanNow,
  };
}
