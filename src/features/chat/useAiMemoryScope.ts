import { useCallback, useEffect, useState } from "react";
import { backendAvailable, beagleApi } from "../../api/beagleApi";
import type { AIMemoryScope } from "../../types";

/** Escopo do ai-memory (workspace/projeto) do diretório da sessão e estado real do servidor. */
export function useAiMemoryScope(cwd: string | undefined, refreshKey?: unknown) {
  const [scope, setScope] = useState<AIMemoryScope | null>(null);
  const load = useCallback(async () => {
    if (!cwd || !backendAvailable()) {
      setScope(null);
      return;
    }
    try {
      setScope(await beagleApi.getAIMemoryScope(cwd));
    } catch {
      setScope(null);
    }
  }, [cwd]);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  return { scope, reload: load };
}
