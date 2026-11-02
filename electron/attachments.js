const crypto = require("crypto");
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

const sessionDir = (root, sessionId) =>
  path.join(root, "attachments", String(sessionId).replace(/[^\w:-]/g, "_"));
// Imagens ficam com o nome do próprio conteúdo: a cópia enviada à CLI e a guardada no histórico
// são o mesmo arquivo, e colar a mesma imagem de novo na conversa não ocupa espaço outra vez.
const STORED_IMAGE_RE = /^[a-f0-9]{32}\.(png|jpg|gif|webp)$/;
const MIME_BY_EXT = Object.fromEntries(
  Object.entries(IMAGE_TYPES).map(([mime, ext]) => [ext.slice(1), mime]),
);
function storeImage({ root, sessionId, mime, buffer, fsApi = fs }) {
  const dir = sessionDir(root, sessionId);
  fsApi.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name =
    crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32) + IMAGE_TYPES[mime];
  const file = path.join(dir, name);
  if (!fsApi.existsSync(file)) fsApi.writeFileSync(file, buffer, { mode: 0o600 });
  return { name, file };
}

/** Grava os anexos da conversa e devolve `{ name, path, mime, kind, size }` de cada um. */
function saveAttachments({ sessionId, attachments, root, fsApi = fs }) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (list.length > MAX_ATTACHMENTS)
    throw new Error(`Anexe no máximo ${MAX_ATTACHMENTS} arquivos por mensagem.`);
  if (!list.length) return [];
  const dir = sessionDir(root, sessionId);
  fsApi.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return list.map((item, index) => {
    const { mime, buffer } = parseDataUrl(item?.url);
    if (!buffer.length) throw new Error(`O anexo “${safeName(item?.name)}” está vazio.`);
    if (buffer.length > MAX_BYTES)
      throw new Error(`O anexo “${safeName(item?.name)}” passa de ${MAX_BYTES / 1024 / 1024} MB.`);
    const kind = IMAGE_TYPES[mime] ? "image" : "file";
    let name = safeName(item?.name);
    if (kind === "image") {
      if (!path.extname(name)) name += IMAGE_TYPES[mime];
      const { file } = storeImage({ root, sessionId, mime, buffer, fsApi });
      return { name, path: file, mime, kind, size: buffer.length };
    }
    const file = path.join(dir, `${Date.now()}-${index}-${name}`);
    fsApi.writeFileSync(file, buffer, { mode: 0o600 });
    return { name, path: file, mime, kind, size: buffer.length };
  });
}

/**
 * Anexos como o banco guarda: a imagem vai para a pasta da conversa e a mensagem só referencia o
 * arquivo (`file`), sem base64 dentro do banco.
 */
function toStoredAttachments({ root, sessionId, attachments, fsApi = fs }) {
  if (!Array.isArray(attachments)) return attachments;
  return attachments.map((item) => {
    if (!item || typeof item !== "object" || typeof item.url !== "string") return item;
    if (!item.url.startsWith("data:")) return item;
    try {
      const { mime, buffer } = parseDataUrl(item.url);
      if (!IMAGE_TYPES[mime] || !buffer.length || buffer.length > MAX_BYTES)
        return { ...item, url: "" };
      const { name } = storeImage({ root, sessionId, mime, buffer, fsApi });
      return { ...item, url: "", file: name };
    } catch {
      return { ...item, url: "" };
    }
  });
}

/** Devolve a prévia das imagens guardadas em arquivo; arquivo ausente vira anexo sem prévia. */
function fromStoredAttachments({ root, sessionId, attachments, fsApi = fs }) {
  if (!Array.isArray(attachments)) return attachments;
  return attachments.map((item) => {
    if (!item || typeof item.file !== "string") return item;
    const { file, ...rest } = item;
    if (!STORED_IMAGE_RE.test(file)) return { ...rest, url: "" };
    try {
      const data = fsApi.readFileSync(path.join(sessionDir(root, sessionId), file));
      const mime = MIME_BY_EXT[path.extname(file).slice(1)];
      return { ...rest, url: `data:${mime};base64,${data.toString("base64")}` };
    } catch {
      return { ...rest, url: "" };
    }
  });
}

/** Apaga os anexos da conversa (imagens do histórico e arquivos enviados à CLI). */
function removeSessionAttachments({ root, sessionId, fsApi = fs }) {
  fsApi.rmSync(sessionDir(root, sessionId), { recursive: true, force: true });
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

// Imagens são gravadas com o nome do conteúdo: o nome original vai junto para a CLI entender o que é.
const label = (file) =>
  `- ${file.path}${
    file.kind === "image"
      ? file.name && file.name !== path.basename(file.path)
        ? ` (imagem: ${file.name})`
        : " (imagem)"
      : ""
  }`;

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
  toStoredAttachments,
  fromStoredAttachments,
  removeSessionAttachments,
  findMentions,
  buildInput,
  dataRoot,
  safeName,
};
