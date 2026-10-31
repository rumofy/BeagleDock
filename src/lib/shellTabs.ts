import type { ChatEvent } from "../types";

export interface ShellTab {
  id: string;
  /** Comando ou ferramenta que produziu a saída. */
  label: string;
  /** Agente que lançou o comando, quando houver. */
  agent?: string;
  status: "running" | "done" | "error";
  /** Tamanho do texto já recebido, para marcar saída nova em abas não vistas. */
  size: number;
}

export const MAX_VISIBLE_TABS = 8;
export const MAX_SHELL_CHARS = 256 * 1024;
export const MAX_SHELLS = 40;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Abas de shell a partir do texto recebido por origem e dos eventos da linha do tempo, que dão
 * título, estado e agente. Origem sem evento (não identificada) ainda assim vira aba.
 */
export function buildShellTabs(
  shellRaw: Record<string, string> | undefined,
  events: ChatEvent[],
): ShellTab[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  return Object.entries(shellRaw ?? {}).flatMap(([id, text]) => {
    const event = byId.get(id);
    // Só comandos são shells: leitura de arquivo, MCP e afins não ganham aba, e uma origem cujo
    // evento ainda não chegou espera por ele em vez de aparecer com o id no lugar do comando.
    if (event?.kind !== "command") return [];
    const parent = event?.parentId ? byId.get(event.parentId) : undefined;
    const label = event.detail || event.title;
    return [
      {
        id,
        label: clip(label || id, 60),
        ...(parent ? { agent: clip(parent.detail || parent.title, 30) } : {}),
        status: event.status,
        size: text.length,
      },
    ];
  });
}

/**
 * Abas visíveis: as em execução, as concluídas mais recentes e a selecionada, em ordem de chegada;
 * o resto vai para o menu "mais", para centenas de comandos não lotarem a barra.
 */
export function splitVisibleTabs(
  tabs: ShellTab[],
  selectedId: string | null,
  max = MAX_VISIBLE_TABS,
): { visible: ShellTab[]; overflow: ShellTab[] } {
  if (tabs.length <= max) return { visible: tabs, overflow: [] };
  const keep = new Set<string>();
  if (selectedId) keep.add(selectedId);
  for (const tab of tabs) if (tab.status === "running" && keep.size < max) keep.add(tab.id);
  for (let i = tabs.length - 1; i >= 0 && keep.size < max; i--) keep.add(tabs[i].id);
  return {
    visible: tabs.filter((tab) => keep.has(tab.id)),
    overflow: tabs.filter((tab) => !keep.has(tab.id)).reverse(),
  };
}

/** Acrescenta saída a uma origem respeitando os limites de texto por aba e de abas por sessão. */
export function appendShellOutput(
  shellRaw: Record<string, string> | undefined,
  additions: Map<string, string>,
): Record<string, string> {
  const next = { ...(shellRaw ?? {}) };
  for (const [id, data] of additions)
    next[id] = ((next[id] ?? "") + data).slice(-MAX_SHELL_CHARS);
  const ids = Object.keys(next);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_SHELLS))) delete next[id];
  return next;
}

export const DEFAULT_AUTO_CLOSE_SECONDS = 120;
export const AUTO_CLOSE_CHOICES = [30, 60, 120, 300, 600];

export interface TabClock {
  /** Quando a aba passou a ser vista como concluída. */
  finishedAt?: number;
  /** Última vez em que a aba esteve aberta na tela. */
  viewedAt?: number;
}

/**
 * Abas que podem fechar sozinhas: só comando concluído com sucesso, que não está aberto, sem saída que
 * você ainda não viu, e depois do prazo contado da última vez que ele esteve na tela. Erro nunca fecha.
 * Fechar só esconde a aba; a saída continua em "Tudo".
 */
export function tabsToAutoClose(
  tabs: ShellTab[],
  clocks: Record<string, TabClock>,
  {
    now,
    seconds,
    selectedId,
    seenSizes,
  }: { now: number; seconds: number; selectedId: string | null; seenSizes: Record<string, number> },
): string[] {
  return tabs
    .filter((tab) => {
      if (tab.status !== "done" || tab.id === selectedId) return false;
      if ((seenSizes[tab.id] ?? 0) < tab.size) return false;
      const clock = clocks[tab.id];
      const since = Math.max(clock?.finishedAt ?? Infinity, clock?.viewedAt ?? 0);
      return Number.isFinite(since) && now - since >= seconds * 1000;
    })
    .map((tab) => tab.id);
}
