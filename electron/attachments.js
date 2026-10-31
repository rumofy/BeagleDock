const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveInsideProject } = require("./editor");

// Anexos do chat: a interface envia imagens e arquivos como data URL; aqui eles são validados, gravados
// numa pasta da conversa e normalizados para o formato nativo de cada CLI. O que a CLI não suporta
// vira aviso para a pessoa, nunca um anexo "fingido".
const MAX_ATTACHMENTS = 10;
const MAX_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};
const MENTION_RE = /(?<![\w./@:-])@((?:\.{1,2}\/)?(?:[\w@.+-]+\/)*[\w@.+-]*\.?[\w@+-]+)/g;

const safeName = (name) =>
  String(name || "arquivo")
    .replace(/[\\/\0]/g, "_")
    .replace(/^\.+/, "_")
    .replace(/[^\w.@+ -]/g, "_")
    .slice(0, 120) || "arquivo";

function parseDataUrl(url) {
  const match = /^data:([\w/+.-]+)?(?:;[\w=.-]+)*;base64,([A-Za-z0-9+/=\r\n]*)$/.exec(String(url || ""));
  if (!match) throw new Error("Anexo inválido: conteúdo ausente ou em formato desconhecido.");
  return { mime: match[1] || "application/octet-stream", buffer: Buffer.from(match[2], "base64") };
}

/** Grava os anexos da conversa e devolve `{ name, path, mime, kind, size }` de cada um. */
function saveAttachments({ sessionId, attachments, root, fsApi = fs }) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (list.length > MAX_ATTACHMENTS)
    throw new Error(`Anexe no máximo ${MAX_ATTACHMENTS} arquivos por mensagem.`);
  if (!list.length) return [];
  const dir = path.join(root, "attachments", String(sessionId).replace(/[^\w:-]/g, "_"));
  fsApi.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return list.map((item, index) => {
    const { mime, buffer } = parseDataUrl(item?.url);
    if (!buffer.length) throw new Error(`O anexo “${safeName(item?.name)}” está vazio.`);
    if (buffer.length > MAX_BYTES)
      throw new Error(`O anexo “${safeName(item?.name)}” passa de ${MAX_BYTES / 1024 / 1024} MB.`);
    const kind = IMAGE_TYPES[mime] ? "image" : "file";
    let name = safeName(item?.name);
    if (kind === "image" && !path.extname(name)) name += IMAGE_TYPES[mime];
    const file = path.join(dir, `${Date.now()}-${index}-${name}`);
    fsApi.writeFileSync(file, buffer, { mode: 0o600 });
    return { name, path: file, mime, kind, size: buffer.length };
  });
}

/** `@caminho` no texto que aponta para um arquivo do projeto vira menção; o resto fica como texto. */
function findMentions(prompt, cwd) {
  const seen = new Set();
  const mentions = [];
  for (const match of String(prompt || "").matchAll(MENTION_RE)) {
    const target = match[1].replace(/[.,;:!?)]+$/, "");
    if (seen.has(target)) continue;
    try {
      const { real, isDirectory } = resolveInsideProject(cwd, target);
      if (isDirectory) continue;
      seen.add(target);
      mentions.push({ name: target, path: real });
    } catch {
      /* não é um arquivo do projeto: segue como texto */
    }
  }
  return mentions;
}

const label = (file) => `- ${file.path}${file.kind === "image" ? " (imagem)" : ""}`;

/**
 * Entrada de cada CLI com os anexos já gravados:
 *  - Claude Code: blocos `image` em base64 na mensagem de usuário e, para os demais, o caminho no texto.
 *  - Codex: `localImage` e `mention` nativos do app-server (e texto com caminhos no modo `exec`).
 *  - Antigravity: sem campo de anexo verificado; os caminhos vão no texto e a pessoa é avisada.
 */
function buildInput(providerId, { prompt, files = [], mentions = [] }, { fsApi = fs } = {}) {
  const warnings = [];
  const images = files.filter((f) => f.kind === "image");
  const others = files.filter((f) => f.kind !== "image");
  if (providerId === "claude") {
    const lines = others.map(label);
    const text = lines.length ? `${prompt}\n\nArquivos anexados:\n${lines.join("\n")}` : prompt;
    const blocks = images.map((image) => ({
      type: "image",
      source: { type: "base64", media_type: image.mime, data: fsApi.readFileSync(image.path).toString("base64") },
    }));
    return { content: blocks.length ? [...blocks, { type: "text", text }] : text, text, warnings };
  }
  if (providerId === "codex") {
    const text = prompt;
    const input = [
      { type: "text", text },
      ...images.map((image) => ({ type: "localImage", path: image.path })),
      ...[...others, ...mentions].map((file) => ({ type: "mention", name: file.name, path: file.path })),
    ];
    const lines = [...files, ...mentions.map((m) => ({ ...m, kind: "file" }))].map(label);
    return {
      input,
      text: lines.length ? `${prompt}\n\nArquivos anexados:\n${lines.join("\n")}` : prompt,
      warnings,
    };
  }
  const lines = files.map(label);
  if (images.length)
    warnings.push(
      "O Antigravity não tem campo nativo de imagem verificado: o caminho da imagem foi enviado no texto e ele decide abri-la.",
    );
  return {
    text: lines.length ? `${prompt}\n\nArquivos anexados:\n${lines.join("\n")}` : prompt,
    warnings,
  };
}

/** Pasta de dados do app, para os anexos ficarem junto do banco. */
const dataRoot = () => process.env.BEAGLEDOCK_DATA_DIR || path.join(os.homedir(), ".beagledock");

module.exports = {
  MAX_ATTACHMENTS,
  MAX_BYTES,
  saveAttachments,
  findMentions,
  buildInput,
  dataRoot,
  safeName,
};
