export type MessagePart =
  | { type: "text"; value: string }
  | { type: "code"; lang: string; code: string; closed: boolean };

const FENCE = /^\s{0,3}```\s*([\w+#.-]*)[^\n]*$/;

/**
 * Splits the reply text into plain parts and ``` fenced code blocks.
 * A block still open (streaming) comes out as code with `closed: false`.
 */
export function splitMessage(text: string): MessagePart[] {
  if (!text.includes("```")) return [{ type: "text", value: text }];
  const parts: MessagePart[] = [];
  let buffer: string[] = [];
  let code: string[] | null = null;
  let lang = "";
  const flushText = () => {
    if (buffer.length) parts.push({ type: "text", value: buffer.join("\n") });
    buffer = [];
  };
  for (const line of text.split("\n")) {
    const fence = FENCE.exec(line);
    if (code === null) {
      if (fence) {
        flushText();
        code = [];
        lang = fence[1].toLowerCase();
      } else buffer.push(line);
    } else if (fence && fence[1] === "") {
      parts.push({ type: "code", lang, code: code.join("\n"), closed: true });
      code = null;
    } else code.push(line);
  }
  if (code !== null)
    parts.push({ type: "code", lang, code: code.join("\n"), closed: false });
  else flushText();
  return parts;
}
