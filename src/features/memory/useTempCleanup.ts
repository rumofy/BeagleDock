import { useCallback, useEffect, useState } from "react";
import { backendAvailable, beagleApi } from "../../api/beagleApi";
import type { AIMemoryTempProject } from "../../types/api";

import { t, tn } from "../../i18n";
/** Settings and execution of the cleanup of ai-memory's temporary projects. */
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
      if (!res?.ok) throw new Error(res?.error || t("temp.checkFailed"));
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
      if (!res?.ok) throw new Error(res?.error || t("temp.saveFailed"));
      setMessage(res.days ? tn("temp.saved", res.days) : t("temp.autoOffSaved"));
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
          ? tn("temp.removed", removed)
          : t("temp.nothing"),
      );
      setError(failed ? tn("temp.failed", failed) : "");
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
