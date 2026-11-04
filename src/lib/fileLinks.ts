export type TextPart =
  | { type: "text"; value: string }
  | { type: "file"; value: string; path: string; line?: number; column?: number }
  | { type: "url"; value: string; url: string };

const EXTENSIONS =
  "tsx?|jsx?|mjs|cjs|json|jsonc|md|mdx|css|scss|html?|py|go|rs|java|kt|rb|php|c|cc|cpp|h|hpp|cs|sh|bash|zsh|toml|ya?ml|sql|vue|svelte|txt|lock|conf|ini|xml|gradle|swift|dart|lua|env";

// A path (relative or absolute) with a known extension and, optionally, :line[:column].
// The lookbehind avoids matching parts of URLs, e-mails and words (`example.com/a.ts`, `a@b.ts`).
const FILE_RE = new RegExp(
  `(?<![\\w./:@~-])((?:\\.{1,2}/|/)?(?:[\\w@.-]+/)*[\\w@.-]+\\.(?:${EXTENSIONS}))(?::(\\d{1,7})(?::(\\d{1,7}))?)?(?![\\w/-])`,
  "g",
);

const ROOT_FILE_RE = /\.(?:md|mdx|json|jsonc|toml|ya?ml|lock|env|ini|conf|xml|gradle|txt|sql)$/;

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const count = (text: string, char: string) => text.split(char).length - 1;

/** Strips trailing punctuation; ")" stays only when the address has a matching "(" (e.g. Wikipedia). */
function trimUrl(url: string): string {
  for (;;) {
    const last = url.at(-1);
    const strip =
      last !== undefined &&
      (".,;:!?]}".includes(last) ||
        (last === ")" && count(url, ")") > count(url, "(")));
    if (!strip) return url;
    url = url.slice(0, -1);
  }
}

/** http(s) addresses in the text, without the punctuation that ends the sentence. */
function splitUrls(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = trimUrl(match[0]);
    const start = match.index ?? 0;
    if (!/^https?:\/\/[^/?#]+/.test(url)) continue;
    if (start > last) parts.push({ type: "text", value: text.slice(last, start) });
    parts.push({ type: "url", value: url, url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

/** Splits the text into plain parts, web addresses and file references, keeping all the content. */
export function splitFileLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  for (const piece of splitUrls(text)) {
    if (piece.type === "text") parts.push(...splitFiles(piece.value));
    else parts.push(piece);
  }
  return parts.length ? parts : [{ type: "text", value: text }];
}

function splitFiles(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(FILE_RE)) {
    const [whole, filePath, line, column] = match;
    const start = match.index ?? 0;
    // A bare name, with no directory or line, only counts as a root config or documentation file
    // (README.md, package.json). A bare "node.js" or "useSessions.ts" is not clickable: the first
    // is a product name and the second wouldn't be found at the project root.
    if (!filePath.includes("/") && !line && !ROOT_FILE_RE.test(filePath)) continue;
    if (start > last) parts.push({ type: "text", value: text.slice(last, start) });
    parts.push({
      type: "file",
      value: whole,
      path: filePath,
      ...(line ? { line: Number(line) } : {}),
      ...(column ? { column: Number(column) } : {}),
    });
    last = start + whole.length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts.length ? parts : [{ type: "text", value: text }];
}
