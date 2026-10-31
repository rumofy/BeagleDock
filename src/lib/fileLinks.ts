export type TextPart =
  | { type: "text"; value: string }
  | { type: "file"; value: string; path: string; line?: number; column?: number };

const EXTENSIONS =
  "tsx?|jsx?|mjs|cjs|json|jsonc|md|mdx|css|scss|html?|py|go|rs|java|kt|rb|php|c|cc|cpp|h|hpp|cs|sh|bash|zsh|toml|ya?ml|sql|vue|svelte|txt|lock|conf|ini|xml|gradle|swift|dart|lua|env";

// Caminho (relativo ou absoluto) com extensão conhecida e, opcionalmente, :linha[:coluna].
// O lookbehind evita pegar pedaços de URLs, e-mails e palavras (`example.com/a.ts`, `a@b.ts`).
const FILE_RE = new RegExp(
  `(?<![\\w./:@~-])((?:\\.{1,2}/|/)?(?:[\\w@.-]+/)*[\\w@.-]+\\.(?:${EXTENSIONS}))(?::(\\d{1,7})(?::(\\d{1,7}))?)?(?![\\w/-])`,
  "g",
);

const ROOT_FILE_RE = /\.(?:md|mdx|json|jsonc|toml|ya?ml|lock|env|ini|conf|xml|gradle|txt|sql)$/;

/** Separa o texto em trechos comuns e referências a arquivos, preservando todo o conteúdo. */
export function splitFileLinks(text: string): TextPart[] {
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
