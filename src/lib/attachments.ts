import type { ChatAttachment } from "../types";

export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
/** Imagens maiores que isso não guardam a prévia no histórico (o arquivo já foi enviado à CLI). */
export const MAX_STORED_PREVIEW_CHARS = 700 * 1024;

/** Mensagem de erro se o arquivo não puder ser anexado; `null` se puder. */
export function attachmentProblem(
  file: { name: string; size: number },
  currentCount: number,
): string | null {
  if (currentCount >= MAX_ATTACHMENTS)
    return `Anexe no máximo ${MAX_ATTACHMENTS} arquivos por mensagem.`;
  if (file.size === 0) return `O arquivo “${file.name}” está vazio.`;
  if (file.size > MAX_ATTACHMENT_BYTES)
    return `O arquivo “${file.name}” passa de ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`;
  return null;
}

export const sizeText = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** O que a conversa guarda dos anexos: nome e tamanho sempre, a prévia só de imagens pequenas. */
export function storableAttachments(attachments: ChatAttachment[]): ChatAttachment[] {
  return attachments.map((a) => ({
    ...a,
    url: a.type === "image" && a.url.length <= MAX_STORED_PREVIEW_CHARS ? a.url : "",
  }));
}

/** `@trecho` imediatamente antes do cursor, no começo do texto ou depois de um espaço. */
export function mentionAt(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)@([\w@.+/-]*)$/.exec(before);
  return match ? { query: match[1], start: caret - match[1].length - 1 } : null;
}

/** Troca o `@trecho` sob o cursor pelo caminho escolhido e devolve o novo texto e cursor. */
export function applyMention(
  text: string,
  caret: number,
  start: number,
  file: string,
): { text: string; caret: number } {
  const insert = `@${file} `;
  return { text: text.slice(0, start) + insert + text.slice(caret), caret: start + insert.length };
}
