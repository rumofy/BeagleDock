import type { ChatAttachment } from "../types";

import { t } from "../i18n";
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** Error message when the file can't be attached; `null` when it can. */
export function attachmentProblem(
  file: { name: string; size: number },
  currentCount: number,
): string | null {
  if (currentCount >= MAX_ATTACHMENTS)
    return t("attachments.tooMany", { max: MAX_ATTACHMENTS });
  if (file.size === 0) return t("attachments.empty", { name: file.name });
  if (file.size > MAX_ATTACHMENT_BYTES)
    return t("attachments.tooLarge", { name: file.name, mb: MAX_ATTACHMENT_BYTES / 1024 / 1024 });
  return null;
}

export const sizeText = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * What the conversation keeps from attachments: always the name and size, plus the image (the
 * backend writes it to a file in the conversation folder; the database only keeps the reference).
 * Non-image files keep only the name and size.
 */
export function storableAttachments(attachments: ChatAttachment[]): ChatAttachment[] {
  return attachments.map((a) => ({ ...a, url: a.type === "image" ? a.url : "" }));
}

/** `@fragment` right before the caret, at the start of the text or after a space. */
export function mentionAt(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)@([\w@.+/-]*)$/.exec(before);
  return match ? { query: match[1], start: caret - match[1].length - 1 } : null;
}

/** Replaces the `@fragment` under the caret with the chosen path; returns the new text and caret. */
export function applyMention(
  text: string,
  caret: number,
  start: number,
  file: string,
): { text: string; caret: number } {
  const insert = `@${file} `;
  return { text: text.slice(0, start) + insert + text.slice(caret), caret: start + insert.length };
}
