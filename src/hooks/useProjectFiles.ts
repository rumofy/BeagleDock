import { useEffect, useState } from "react";
import { beagleApi } from "../api/beagleApi";

/** Project files matching the typed `@fragment`; only queries while a mention is open. */
export function useProjectFiles(cwd: string | undefined, query: string | null) {
  const [state, setState] = useState<{ query: string; files: string[]; error?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const active = query !== null && !!cwd;

  useEffect(() => {
    if (!active || !cwd || query === null) return;
    let cancelled = false;
    setLoading(true);
    // A short delay avoids one query per keystroke.
    const timer = setTimeout(() => {
      beagleApi
        .searchProjectFiles({ cwd, query })
        .then((result) => {
          if (!cancelled) setState({ query, files: result.files, error: result.success ? undefined : result.error });
        })
        .catch((error: Error) => !cancelled && setState({ query, files: [], error: error.message }))
        .finally(() => !cancelled && setLoading(false));
    }, 90);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, cwd, query]);

  return {
    active,
    loading,
    files: active ? (state?.files ?? []) : [],
    error: active ? state?.error : undefined,
  };
}
