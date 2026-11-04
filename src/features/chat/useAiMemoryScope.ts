import { useCallback, useEffect, useState } from "react";
import { backendAvailable, beagleApi } from "../../api/beagleApi";
import type { AIMemoryScope } from "../../types";

/** ai-memory scope (workspace/project) of the session folder and the server's real state. */
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
