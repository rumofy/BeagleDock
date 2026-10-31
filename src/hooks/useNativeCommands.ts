import { useEffect, useMemo, useState } from "react";
import { beagleApi } from "../api/beagleApi";
import { APP_CONTROL_COMMANDS } from "../lib/sessionControls";
import type { NativeCommand, NativeCommandList } from "../types/api";

/** Pedaço digitado depois da barra, só enquanto a pessoa ainda escreve o nome do comando. */
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
 * Comandos nativos da CLI da conversa para o autocomplete. A lista é lida da própria CLI (o backend
 * guarda um cache curto) e só é consultada quando a pessoa começa a digitar uma barra.
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
            // Sem lista nativa dos comandos internos (Codex), o app oferece os controles que ele mantém.
            result.limitation
              ? [
                  ...result.commands,
                  ...APP_CONTROL_COMMANDS.filter(
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
