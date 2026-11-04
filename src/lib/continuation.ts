import type { AIProviderStatus, ChatEvent, ChatMessage } from "../types";
import { plainMessageText } from "./messageSegments";
import { providerQuota } from "./format";

import { t } from "../i18n";
const MAX_TOTAL = 9000;
const clip = (text: string, max: number) => {
  const clean = text.replace(/\r/g, "").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
};

// Obvious secrets that may have slipped into the history text never go to another CLI.
const SECRETS: Array<[RegExp, string]> = [
  [/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, "[secret removed]"],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi, "$1 [secret removed]"],
  [/\b((?:api[_-]?key|token|secret|password|senha)\s*[=:]\s*)["']?[^\s"']{6,}/gi, "$1[secret removed]"],
];
export const redact = (text: string) =>
  SECRETS.reduce((acc, [re, to]) => acc.replace(re, to), text);

/** Files the conversation changed, read from the edit steps of the timeline. */
export function changedFiles(messages: ChatMessage[]): string[] {
  const seen = new Set<string>();
  for (const message of messages)
    for (const event of message.events ?? []) {
      if (event.kind !== "file") continue;
      const file = (event.detail || event.title || "").trim();
      if (file) seen.add(file);
    }
  return [...seen];
}

const failedCommands = (messages: ChatMessage[]): ChatEvent[] =>
  messages
    .flatMap((m) => m.events ?? [])
    .filter((e) => e.kind === "command" && e.status === "error")
    .slice(-5);

export interface ContinuationInput {
  fromProviderName: string;
  toProviderName: string;
  title: string;
  cwd: string;
  messages: ChatMessage[];
}

/**
 * Continuation request for the new CLI, built only from the visible history stored locally.
 * Everything taken from the history is data between delimiters: the new CLI is told not to treat
 * it as instructions and to check the real state of the project before going on.
 * Written in the interface language, so the new CLI answers in it.
 */
export function buildContinuation({
  fromProviderName,
  toProviderName,
  title,
  cwd,
  messages,
}: ContinuationInput): string {
  const real = messages.filter((m) => m.text && !m.id.startsWith("init-"));
  const users = real.filter((m) => m.sender === "user");
  const answers = real.filter((m) => m.sender !== "user" && !m.isStreaming);
  const first = users[0];
  const recent = users.slice(-3);
  const last = answers.at(-1);
  const files = changedFiles(messages);
  const failed = failedCommands(messages);

  const parts: string[] = [
    t("prompt.continuation.intro", { to: toProviderName, from: fromProviderName, title: clip(title, 120), cwd }),
    t("prompt.continuation.dataOnly"),
    "<history>",
  ];
  if (first) parts.push(`${t("prompt.continuation.original")}\n${clip(plainMessageText(first.text), 1500)}`);
  if (recent.length > 1 || (recent.length === 1 && recent[0] !== first))
    parts.push(
      `${t("prompt.continuation.recent")}\n${recent.map((m, i) => `${i + 1}. ${clip(plainMessageText(m.text), 600)}`).join("\n")}`,
    );
  if (last) parts.push(`${t("prompt.continuation.lastReply")}\n${clip(plainMessageText(last.text), 2500)}`);
  if (files.length)
    parts.push(
      `${t("prompt.continuation.files", { count: files.length })}\n${files.slice(0, 40).map((f) => `- ${f}`).join("\n")}${files.length > 40 ? `\n- ${t("prompt.continuation.more", { count: files.length - 40 })}` : ""}`,
    );
  if (failed.length)
    parts.push(
      `${t("prompt.continuation.failed")}\n${failed.map((e) => `- ${clip(e.detail || e.title, 160)}`).join("\n")}`,
    );
  parts.push("</history>");
  parts.push(
    t("prompt.continuation.request"),
  );
  return clip(redact(parts.join("\n\n")), MAX_TOTAL);
}

const LIMIT_5H = 90;
const LIMIT_WEEK = 95;
const SPARE = 80;

export interface QuotaSuggestion {
  /** Which window of the current CLI is running out. */
  reason: string;
  /** Highest percentage among the windows. */
  percent: number;
  /** Other installed CLIs, from the one with most room to the one with least. */
  targets: Array<{ id: string; name: string; percent: number | null }>;
}

/** Highest usage percentage among the CLI's windows; `null` without a reading. */
export const providerUsage = (provider: AIProviderStatus): number | null => {
  const q = providerQuota(provider);
  const value = Math.max(q?.window5hPercent ?? -1, q?.weeklyPercent ?? -1);
  return value < 0 ? null : value;
};

/** Suggests continuing in another CLI when the current one's quota is nearly used and another has room. */
export function suggestContinuation(
  current: AIProviderStatus | undefined,
  all: AIProviderStatus[],
): QuotaSuggestion | null {
  if (!current) return null;
  const q = providerQuota(current);
  if (!q || q.stale) return null;
  const five = q.window5hPercent ?? -1;
  const week = q.weeklyPercent ?? -1;
  if (five < LIMIT_5H && week < LIMIT_WEEK) return null;
  const targets = all
    .filter((p) => p.id !== current.id && p.installed && p.type === "cli")
    .map((p) => ({ id: p.id, name: p.name, percent: providerUsage(p) }))
    .filter((p) => p.percent === null || p.percent < SPARE)
    .sort((a, b) => (a.percent ?? 50) - (b.percent ?? 50));
  if (!targets.length) return null;
  return {
    reason: five >= LIMIT_5H ? t("quota.reason.window5h") : t("quota.reason.week"),
    percent: Math.max(five, week),
    targets,
  };
}
