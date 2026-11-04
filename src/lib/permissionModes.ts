import type { ChatSession, PermissionLevel } from "../types";

import { t, tn } from "../i18n";
/** Order in which the shortcut cycles through the modes, from most restricted to most open. */
export const PERMISSION_CYCLE: PermissionLevel[] = ["inherit", "plan", "ask", "edits", "full"];

// Getters: every read uses the current interface language.
export const PERMISSION_LABELS: Record<PermissionLevel, string> = {
  get inherit() {
    return t("permission.inherit");
  },
  get plan() {
    return t("permission.plan");
  },
  get ask() {
    return t("permission.ask");
  },
  get edits() {
    return t("permission.edits");
  },
  get full() {
    return t("permission.full");
  },
};

/** Next mode in the cycle (Alt+M); wraps around to the first after the last. */
export function nextPermission(current: PermissionLevel | undefined): PermissionLevel {
  const index = PERMISSION_CYCLE.indexOf(current ?? "inherit");
  return PERMISSION_CYCLE[(index + 1) % PERMISSION_CYCLE.length];
}

/** Plans temporarily restrict the conversation; leaving restores its previous permission. */
export const permissionAfterPlan = (session: Pick<ChatSession, "permissionBeforePlan">): PermissionLevel =>
  session.permissionBeforePlan || "edits";

export function withPermission(session: ChatSession, permission: PermissionLevel): ChatSession {
  return {
    ...session,
    permission,
    permissionBeforePlan: permission === "plan"
      ? session.permission === "plan" ? session.permissionBeforePlan : session.permission || "inherit"
      : undefined,
  };
}

/** Alt+P toggles plan mode and restores the permission held before entering it. */
export const togglePlan = (current: PermissionLevel | undefined, previous?: Exclude<PermissionLevel, "plan">): PermissionLevel =>
  current === "plan" ? previous || "edits" : "plan";

/** Message sent by the "Approve plan and run" button, with the conversation already out of plan mode. */
export const planApprovedPrompt = () => t("prompt.planApproved");

/**
 * The approve-plan button shows when the conversation is in plan mode, idle, and the last message
 * is a finished AI reply (the plan to approve). It applies to all three CLIs: in Codex and AGY the
 * plan ends as plain text, and Claude Code sometimes also asks in text.
 */
export function canApprovePlan(
  permission: PermissionLevel | undefined,
  executing: boolean,
  lastMessage: { sender: string; text?: string; isStreaming?: boolean } | undefined,
): boolean {
  return (
    permission === "plan" &&
    !executing &&
    !!lastMessage &&
    lastMessage.sender !== "user" &&
    !lastMessage.isStreaming &&
    !!lastMessage.text?.trim()
  );
}

export interface ShortcutKey {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** Which action the shortcut asks for: `plan` (Alt+P), `cycle` (Alt+M) or none. Alt alone, no Ctrl/Meta. */
export function permissionShortcut(e: ShortcutKey): "plan" | "cycle" | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  const key = e.key.toLowerCase();
  return key === "p" ? "plan" : key === "m" ? "cycle" : null;
}

export interface LivePermissionOutcome {
  ok: boolean;
  applied?: "now" | "next";
  approved?: number;
}

/**
 * Explains a permission change made while a reply is running: whether the CLI already uses the new
 * level or only from the next message, and how many pending approvals were released. Null when
 * there is nothing to explain.
 */
export function livePermissionNotice(
  result: LivePermissionOutcome | undefined,
  executing: boolean,
): string | null {
  if (!result?.ok) return null;
  const approved = result.approved || 0;
  const released = approved > 0 ? ` ${tn("permission.released", approved)}` : "";
  if (!executing) return released ? released.trim() : null;
  return result.applied === "now"
    ? `${t("permission.appliedNow")}${released}`
    : `${t("permission.appliedNext")}${released}`;
}
