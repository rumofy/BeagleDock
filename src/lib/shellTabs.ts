import type { ChatEvent } from "../types";

export interface ShellTab {
  id: string;
  /** Command or tool that produced the output. */
  label: string;
  /** Agent that started the command, if any. */
  agent?: string;
  status: "running" | "done" | "error";
  /** Length of text already received, to flag new output in unseen tabs. */
  size: number;
}

export const MAX_VISIBLE_TABS = 8;
export const MAX_SHELL_CHARS = 256 * 1024;
export const MAX_SHELLS = 40;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Shell tabs built from the text received per source and from the timeline events, which provide
 * title, state and agent. A source without an event (unidentified) still becomes a tab.
 */
export function buildShellTabs(
  shellRaw: Record<string, string> | undefined,
  events: ChatEvent[],
): ShellTab[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  return Object.entries(shellRaw ?? {}).flatMap(([id, text]) => {
    const event = byId.get(id);
    // Only commands are shells: file reads, MCP and the like get no tab, and a source whose event
    // hasn't arrived yet waits for it instead of showing its id in place of the command.
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
 * Visible tabs: running ones, the most recent finished ones and the selected one, in arrival order;
 * the rest go to the "more" menu, so hundreds of commands don't crowd the bar.
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

/** Appends output to a source, within the text-per-tab and tabs-per-session limits. */
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
  /** When the tab was first seen as finished. */
  finishedAt?: number;
  /** Last time the tab was open on screen. */
  viewedAt?: number;
}

/**
 * Tabs that may close on their own: only a command that finished successfully, isn't open, has no
 * output you haven't seen, and after the delay counted from the last time it was on screen. Errors never close.
 * Closing only hides the tab; the output stays under "All".
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
