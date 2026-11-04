import type { AIMemoryPageItem } from "../../types";

import { t, type MessageKey } from "../../i18n";
export const GROUP_ORDER = [
  "_rules",
  "decisions",
  "procedures",
  "gotchas",
  "concepts",
  "review",
  "claude-memory",
  "notes",
  "preferences",
  "profile",
  "sessions",
  "others",
] as const;

// Protection/purge rules come from the single source shared with the main process.
export {
  protectionFor,
  isTestProject,
  canPurgeProject,
} from "../../../shared/memory-rules.mjs";

export function groupOf(pagePath: string): string {
  const i = pagePath.indexOf("/");
  const top = i > 0 ? pagePath.slice(0, i) : "others";
  return (GROUP_ORDER as readonly string[]).includes(top) ? top : "others";
}

export function groupPages(pages: AIMemoryPageItem[]) {
  const map = new Map<string, AIMemoryPageItem[]>();
  for (const page of pages) {
    const g = groupOf(page.path);
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(page);
  }
  return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({
    id: g,
    label: t(`memoryGroup.${g}` as MessageKey),
    pages: map
      .get(g)!
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")),
  }));
}

export function relativeTime(iso?: string, now = Date.now()): string {
  if (!iso) return "—";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "—";
  const s = Math.max(0, Math.floor((now - time) / 1000));
  if (s < 60) return t("time.now");
  const m = Math.floor(s / 60);
  if (m < 60) return t("time.minutesAgo", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("time.hoursAgo", { n: h });
  const d = Math.floor(h / 24);
  if (d < 30) return t("time.daysAgo", { n: d });
  const mo = Math.floor(d / 30);
  if (mo < 12) return t("time.monthsAgo", { n: mo });
  return t("time.yearsAgo", { n: Math.floor(d / 365) });
}

export function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR");
}

export function splitFrontmatter(raw: string): {
  meta: Array<[string, string]>;
  body: string;
} {
  const text = raw.replace(/^﻿/, "");
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { meta: [], body: text };
  const meta: Array<[string, string]> = [];
  let current: [string, string] | null = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) {
      current = [kv[1], kv[2]];
      meta.push(current);
    } else if (current && line.trim()) {
      current[1] += (current[1] ? "\n" : "") + line.trim();
    }
  }
  return { meta, body: text.slice(m[0].length) };
}

export function frontmatterEntries(
  fm: Record<string, unknown> | undefined,
): Array<[string, string]> {
  if (!fm) return [];
  return Object.entries(fm).map(([k, v]) => [
    k,
    typeof v === "string" ? v : JSON.stringify(v),
  ]);
}

// Turns [[target]] / [[target|label]] into markdown links with the internal wiki: scheme.
export function transformWikiLinks(body: string): string {
  return body.replace(/\[\[([^\]\n|]+?)(?:\|([^\]\n]+?))?\]\]/g, (_m, target, label) => {
    const t = String(target).trim();
    const l = String(label || t).replace(/[\[\]]/g, "");
    return `[${l}](wiki:${encodeURIComponent(t)})`;
  });
}

export function resolveWikiTarget(
  target: string,
  pages: AIMemoryPageItem[],
): string | null {
  const t = target.trim().replace(/^\/+/, "");
  const withMd = t.endsWith(".md") ? t : `${t}.md`;
  const exact = pages.find((p) => p.path === withMd || p.path === t);
  if (exact) return exact.path;
  const suffix = pages.find((p) => p.path.endsWith(`/${withMd}`));
  if (suffix) return suffix.path;
  const title = pages.find((p) => p.title.toLowerCase() === t.toLowerCase());
  return title ? title.path : null;
}
