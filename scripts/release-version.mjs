import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const UNRELEASED = "## [Unreleased]";

export function releaseChangelog(text, version, date) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === UNRELEASED);
  if (start < 0) throw new Error("CHANGELOG.md não tem a seção `## [Unreleased]`.");
  let end = lines.findIndex((l, i) => i > start && (/^## \[/.test(l) || /^\[[^\]]+\]: /.test(l)));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end);
  if (!body.some((l) => /^\s*[-*] \S/.test(l)))
    throw new Error(
      "A seção `## [Unreleased]` do CHANGELOG.md está sem entradas. Registre as mudanças antes de lançar a versão.",
    );
  const trimmed = body.join("\n").replace(/^\n+|\n+$/g, "");
  const before = lines.slice(0, start).join("\n");
  const rest = lines.slice(end);
  // Rodapé de links
  const linkIdx = rest.findIndex((l) => /^\[Unreleased\]: /.test(l));
  let footer = rest;
  if (linkIdx >= 0) {
    const m = rest[linkIdx].match(/^\[Unreleased\]: (.+)\/compare\/(v[^.\s]+\.[^.\s]+\.[^.\s]+?)\.\.\.HEAD$/);
    footer = rest.slice();
    if (m) {
      const [, base, prev] = m;
      footer[linkIdx] = `[Unreleased]: ${base}/compare/v${version}...HEAD`;
      footer.splice(linkIdx + 1, 0, `[${version}]: ${base}/compare/${prev}...v${version}`);
    }
  }
  const restText = footer.join("\n");
  const sep = rest[0] !== undefined && /^\[/.test(rest[0]) ? "\n" : "";
  return `${before}\n${UNRELEASED}\n\n## [${version}] - ${date}\n\n${trimmed}\n\n${sep}${restText.replace(/^\n+/, "")}`.replace(/\n{3,}/g, "\n\n");
}

export function syncOpenapi(json, version) {
  const doc = JSON.parse(json);
  doc.info = { ...doc.info, version };
  return JSON.stringify(doc, null, 2) + "\n";
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const date = new Date().toISOString().slice(0, 10);
  const clPath = path.join(root, "CHANGELOG.md");
  const oaPath = path.join(root, "docs", "openapi.json");
  try {
    const cl = releaseChangelog(readFileSync(clPath, "utf8"), version, date);
    const oa = syncOpenapi(readFileSync(oaPath, "utf8"), version);
    writeFileSync(clPath, cl);
    writeFileSync(oaPath, oa);
    console.log(`Versão ${version} registrada em CHANGELOG.md e docs/openapi.json.`);
  } catch (e) {
    console.error(`Erro: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
