import { useEffect, useState } from "react";
import { backendAvailable, beagleApi } from "../api/beagleApi";
import type { AIMemoryStatus } from "../types";

export function useMemoryStatus() {
  const [isLoadingMemory, setIsLoadingMemory] = useState<boolean>(false);
  const [memoryStatus, setAIMemoryStatus] = useState<AIMemoryStatus>({
    installed: false,
    serverRunning: false,
    activeDaemonId: "",
    availableDaemons: [],
  });
  // Função para sincronizar status e páginas reais do ai-memory
  const refreshAIMemoryExplorer = async () => {
    if (!backendAvailable()) return;
    setIsLoadingMemory(true);
    try {
      const res = await beagleApi.getAIMemoryStatus();
      const data = res?.data;
      if (res && res.running && data) {
        setAIMemoryStatus((prev) => ({
          ...prev,
          installed: true,
          serverRunning: true,
          cliPath: res.cliPath,
          version: data.version,
          serverUrl: data.server_url || data.serverUrl || undefined,
          totalPages: data.counts?.pages_latest ?? prev.totalPages,
          recentObservationsCount:
            data.counts?.observations ?? prev.recentObservationsCount,
        }));
      } else {
        setAIMemoryStatus((prev) => ({ ...prev, serverRunning: false }));
      }
    } catch {
      setAIMemoryStatus((prev) => ({ ...prev, serverRunning: false }));
    }
    setIsLoadingMemory(false);
  };

  // Status real do ai-memory
  useEffect(() => {
    if (!backendAvailable()) return;
    void refreshAIMemoryExplorer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { memoryStatus, isLoadingMemory, refreshAIMemoryExplorer };
}
