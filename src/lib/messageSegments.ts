/** Trechos de texto de uma resposta, separados por duas quebras de linha com U+2063 no meio.
 *  Mesma definição de electron/message-segments.js. Texto sem o marcador é um trecho só. */
export const SEGMENT_MARK = "⁣";
export const SEGMENT_SEPARATOR = `\n\n${SEGMENT_MARK}\n\n`;

/** Divide a resposta em trechos, sem os vazios. Sempre devolve ao menos um (o texto inteiro). */
export function messageSegments(text: string): string[] {
  if (!text.includes(SEGMENT_MARK)) return [text];
  const parts = text.split(SEGMENT_SEPARATOR).map((part) => part.split(SEGMENT_MARK).join(""));
  const filled = parts.filter((part) => part.trim());
  return filled.length ? filled : [text.split(SEGMENT_MARK).join("")];
}

/** Texto sem o marcador: trechos separados por uma linha em branco (cópia, continuação em outra CLI). */
export function plainMessageText(text: string): string {
  return text.split(SEGMENT_SEPARATOR).join("\n\n").split(SEGMENT_MARK).join("");
}
