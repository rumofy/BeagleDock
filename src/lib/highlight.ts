export type TokenType =
  | "plain"
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "function"
  | "property"
  | "add"
  | "del"
  | "meta";
export interface Token {
  type: TokenType;
  text: string;
}

const C_LIKE = new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "javascript",
  "typescript",
  "mjs",
  "cjs",
  "java",
  "c",
  "cpp",
  "cc",
  "h",
  "hpp",
  "cs",
  "csharp",
  "go",
  "rust",
  "rs",
  "kotlin",
  "kt",
  "swift",
  "php",
  "dart",
  "scala",
]);
const HASH = new Set([
  "py",
  "python",
  "sh",
  "bash",
  "zsh",
  "shell",
  "ruby",
  "rb",
  "yaml",
  "yml",
  "toml",
  "ini",
  "conf",
  "dockerfile",
  "make",
  "makefile",
  "r",
  "perl",
  "pl",
  "env",
]);
const SQL = new Set(["sql", "psql", "mysql"]);

const KEYWORDS: Record<string, string> = {
  c: "abstract async await break case catch class const continue default defer delete do else enum export extends extern final finally fn for from func function go if implements import in instanceof interface let match mod mut namespace new of package private protected pub public return static struct super switch this throw trait try type typeof use var void while with yield null undefined true false nil self",
  hash: "and as assert async await break case class continue def del do done elif else end esac except export fi finally for from function if import in is lambda local nil not or pass raise return select then try unless until when while with yield None True False true false null echo cd npm npx git sudo apt pip docker",
  sql: "select from where join left right inner outer on group by order having limit offset insert into values update set delete create table alter drop index primary key foreign references and or not null as distinct union all case when then else end like in is exists true false",
};

const set = (key: string) => new Set(KEYWORDS[key].split(" "));
const FAMILY_KEYWORDS = { c: set("c"), hash: set("hash"), sql: set("sql") };

function pushText(tokens: Token[], type: TokenType, text: string) {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last && last.type === type) last.text += text;
  else tokens.push({ type, text });
}

function tokenizeDiff(code: string): Token[] {
  const tokens: Token[] = [];
  const lines = code.split("\n");
  lines.forEach((line, i) => {
    const eol = i < lines.length - 1 ? "\n" : "";
    const type: TokenType = /^(\+\+\+|---|diff |index )/.test(line)
      ? "meta"
      : line.startsWith("@@")
        ? "keyword"
        : line.startsWith("+")
          ? "add"
          : line.startsWith("-")
            ? "del"
            : "plain";
    tokens.push({ type, text: line + eol });
  });
  return tokens;
}

/** Light highlighting by language family (no dependencies): comments, strings, numbers and keywords. */
export function tokenize(code: string, language: string): Token[] {
  const lang = (language || "").toLowerCase();
  if (lang === "diff" || lang === "patch") return tokenizeDiff(code);
  const json = lang === "json" || lang === "jsonc";
  const family = SQL.has(lang)
    ? "sql"
    : HASH.has(lang)
      ? "hash"
      : C_LIKE.has(lang) ||
          json ||
          !lang ||
          lang === "css" ||
          lang === "html" ||
          lang === "xml"
        ? "c"
        : "c";
  const keywords = FAMILY_KEYWORDS[family];
  const lineComment = family === "hash" ? "#" : family === "sql" ? "--" : "//";
  const tokens: Token[] = [];
  const n = code.length;
  let i = 0;
  while (i < n) {
    const ch = code[i];
    const rest2 = code.slice(i, i + 2);
    // Comments
    if (
      !json &&
      (code.startsWith(lineComment, i) || (family === "c" && rest2 === "/*"))
    ) {
      let end: number;
      if (rest2 === "/*" && family === "c") {
        end = code.indexOf("*/", i + 2);
        end = end < 0 ? n : end + 2;
      } else {
        end = code.indexOf("\n", i);
        end = end < 0 ? n : end;
      }
      pushText(tokens, "comment", code.slice(i, end));
      i = end;
      continue;
    }
    // Textos
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n && code[j] !== ch) {
        if (code[j] === "\\") j++;
        if (code[j] === "\n" && ch !== "`") break;
        j++;
      }
      const end = Math.min(n, j + 1);
      const text = code.slice(i, end);
      const isKey =
        json && ch === '"' && /^\s*:/.test(code.slice(end, end + 8));
      pushText(tokens, isKey ? "property" : "string", text);
      i = end;
      continue;
    }
    // Numbers
    if (/[0-9]/.test(ch) && !/[\w$]/.test(code[i - 1] || "")) {
      const m = /^(0x[0-9a-fA-F_]+|\d[\d_]*(\.\d+)?([eE][+-]?\d+)?)/.exec(
        code.slice(i),
      );
      if (m) {
        pushText(tokens, "number", m[0]);
        i += m[0].length;
        continue;
      }
    }
    // Identificadores
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][\w$-]*/.exec(code.slice(i))!;
      const word = m[0];
      const lower = family === "sql" ? word.toLowerCase() : word;
      const next = code.slice(i + word.length).match(/^\s*\(/);
      const type: TokenType = keywords.has(lower)
        ? "keyword"
        : next
          ? "function"
          : "plain";
      pushText(tokens, type, word);
      i += word.length;
      continue;
    }
    pushText(tokens, "plain", ch);
    i++;
  }
  return tokens;
}
