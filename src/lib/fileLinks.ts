export type TextPart =
  | { type: "text"; value: string }
  | { type: "file"; value: string; path: string; line?: number; column?: number }
  | { type: "url"; value: string; url: string };

const EXTENSIONS =
  "tsx?|jsx?|mjs|cjs|json|jsonc|md|mdx|css|scss|html?|py|go|rs|java|kt|rb|php|c|cc|cpp|h|hpp|cs|sh|bash|zsh|toml|ya?ml|sql|vue|svelte|txt|lock|conf|ini|xml|gradle|swift|dart|lua|env";

// Caminho (relativo ou absoluto) com extensão conhecida e, opcionalmente, :linha[:coluna].
// O lookbehind evita pegar pedaços de URLs, e-mails e palavras (`example.com/a.ts`, `a@b.ts`).
const FILE_RE = new RegExp(
  `(?<![\\w./:@~-])((?:\\.{1,2}/|/)?(?:[\\w@.-]+/)*[\\w@.-]+\\.(?:${EXTENSIONS}))(?::(\\d{1,7})(?::(\\d{1,7}))?)?(?![\\w/-])`,
  "g",
);

const ROOT_FILE_RE = /\.(?:md|mdx|json|jsonc|toml|ya?ml|lock|env|ini|conf|xml|gradle|txt|sql)$/;

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const count = (text: string, char: string) => text.split(char).length - 1;

/** Tira pontuação final; ")" só fica quando há "(" correspondente no endereço (ex.: Wikipedia). */
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

/** Endereços http(s) do texto, sem a pontuação que fecha a frase. */
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

/** Separa o texto em trechos comuns, endereços web e referências a arquivos, preservando todo o conteúdo. */
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
    // Nome solto, sem diretório nem linha, só vale se for arquivo de configuração ou documentação
    // na raiz (README.md, package.json). "node.js" ou "useSessions.ts" soltos não são clicáveis:
    // o primeiro é nome de produto e o segundo não seria encontrado na raiz do projeto.
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
