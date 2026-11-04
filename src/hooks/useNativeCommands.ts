import { useEffect, useMemo, useState } from "react";
import { beagleApi } from "../api/beagleApi";
import { appControlCommands } from "../lib/sessionControls";
import type { NativeCommand, NativeCommandList } from "../types/api";

/** Text typed after the slash, only while the person is still writing the command name. */
export function commandQuery(input: string): string | null {
  const match = /^\/([^\s/]*)$/.exec(input);
  return match ? match[1].toLowerCase() : null;
}

export function filterCommands(commands: NativeCommand[], query: string): NativeCommand[] {
  const rank = (c: NativeCommand) => {
    const names = [c.name, ...(c.aliases || [])].map((n) => n.toLowerCase());
    if (names.some((n) => n === query)) return 0;
    if (names.some((n) => n.startsWith(query))) return 1;
    if (names.some((n) => n.includes(query))) return 2;
    return c.description?.toLowerCase().includes(query) ? 3 : -1;
  };
  return commands
    .map((command) => ({ command, score: rank(command) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => a.score - b.score || a.command.name.localeCompare(b.command.name))
    .map((item) => item.command);
}

/**
 * Native commands of the conversation's CLI for autocomplete. The list is read from the CLI itself (the
 * backend keeps a short cache) and is only queried when the person starts typing a slash.
 */
export function useNativeCommands(providerId?: string, cwd?: string, input = "") {
  const query = commandQuery(input);
  const active = query !== null && !!providerId && !!cwd;
  const [result, setResult] = useState<NativeCommandList | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!active || !providerId || !cwd) return;
    let cancelled = false;
    setLoading(true);
    beagleApi
      .listNativeCommands({ providerId, cwd })
      .then((list) => !cancelled && setResult(list))
      .catch((error: Error) =>
        !cancelled &&
        setResult({ ok: false, providerId, commands: [], error: error.message }),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [active, providerId, cwd]);

  const items = useMemo(
    () =>
      active && result?.providerId === providerId
        ? filterCommands(
            // With no native list of built-in commands (Codex), the app offers the controls it maintains.
            result.limitation
              ? [
                  ...result.commands,
                  ...appControlCommands().filter(
                    (app) => !result.commands.some((c) => c.name === app.name),
                  ),
                ]
              : result.commands,
            query ?? "",
          )
        : [],
    [active, result, providerId, query],
  );
  return {
    active,
    loading,
    items,
    error: result?.ok === false ? result.error : undefined,
    limitation: result?.limitation,
  };
}
