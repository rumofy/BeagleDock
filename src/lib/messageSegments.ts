/** Text parts of a reply, separated by two line breaks with U+2063 between them.
 *  Same definition as electron/message-segments.js. Text without the marker is a single part. */
export const SEGMENT_MARK = "⁣";
export const SEGMENT_SEPARATOR = `\n\n${SEGMENT_MARK}\n\n`;

/** Splits the reply into parts, without empty ones. Always returns at least one (the whole text). */
export function messageSegments(text: string): string[] {
  if (!text.includes(SEGMENT_MARK)) return [text];
  const parts = text.split(SEGMENT_SEPARATOR).map((part) => part.split(SEGMENT_MARK).join(""));
  const filled = parts.filter((part) => part.trim());
  return filled.length ? filled : [text.split(SEGMENT_MARK).join("")];
}

/** Text without the marker: parts separated by a blank line (copy, continuing in another CLI). */
export function plainMessageText(text: string): string {
  return text.split(SEGMENT_SEPARATOR).join("\n\n").split(SEGMENT_MARK).join("");
}
