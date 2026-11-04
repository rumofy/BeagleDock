const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveInsideProject } = require("./editor");
const { t } = require("./i18n");

// Chat attachments: the interface sends images and files as data URLs; here they're validated, saved
// in a folder of the conversation and normalized to each CLI's native format. What the CLI doesn't support
// becomes a notice to the person, never a "fake" attachment.
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
  String(name || "file")
    .replace(/[\\/\0]/g, "_")
    .replace(/^\.+/, "_")
    .replace(/[^\w.@+ -]/g, "_")
    .slice(0, 120) || "file";

function parseDataUrl(url) {
  const match = /^data:([\w/+.-]+)?(?:;[\w=.-]+)*;base64,([A-Za-z0-9+/=\r\n]*)$/.exec(String(url || ""));
  if (!match) throw new Error(t("attachments.invalid"));
  return { mime: match[1] || "application/octet-stream", buffer: Buffer.from(match[2], "base64") };
}

const sessionDir = (root, sessionId) =>
  path.join(root, "attachments", String(sessionId).replace(/[^\w:-]/g, "_"));
// Images are named after their own content: the copy sent to the CLI and the one kept in the history
// are the same file, and pasting the same image again in the conversation takes no extra space.
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

/** Saves the conversation's attachments and returns `{ name, path, mime, kind, size }` for each. */
function saveAttachments({ sessionId, attachments, root, fsApi = fs }) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (list.length > MAX_ATTACHMENTS)
    throw new Error(t("attachments.tooMany", { max: MAX_ATTACHMENTS }));
  if (!list.length) return [];
  const dir = sessionDir(root, sessionId);
  fsApi.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return list.map((item, index) => {
    const { mime, buffer } = parseDataUrl(item?.url);
    if (!buffer.length) throw new Error(t("attachments.empty", { name: safeName(item?.name) }));
    if (buffer.length > MAX_BYTES)
      throw new Error(t("attachments.tooLarge", { name: safeName(item?.name), mb: MAX_BYTES / 1024 / 1024 }));
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
 * Attachments as the database stores them: the image goes to the conversation's folder and the message only references the
 * file (`file`), with no base64 inside the database.
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

/** Returns the preview of images saved to a file; a missing file becomes an attachment without a preview. */
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

/** Deletes the conversation's attachments (history images and files sent to the CLI). */
function removeSessionAttachments({ root, sessionId, fsApi = fs }) {
  fsApi.rmSync(sessionDir(root, sessionId), { recursive: true, force: true });
}

/** An `@path` in the text pointing to a project file becomes a mention; the rest stays as text. */
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
      /* not a project file: stays as text */
    }
  }
  return mentions;
}

// Images are saved with the content's name: the original name goes along so the CLI understands what it is.
const label = (file) =>
  `- ${file.path}${
    file.kind === "image"
      ? file.name && file.name !== path.basename(file.path)
        ? ` (imagem: ${file.name})`
        : " (imagem)"
      : ""
  }`;

/**
 * Each CLI's input with the attachments already saved:
 *  - Claude Code: base64 `image` blocks in the user message and, for the others, the path in the text.
 *  - Codex: the app-server's native `localImage` and `mention` (and text with paths in `exec` mode).
 *  - Antigravity: no verified attachment field; the paths go in the text and the person is notified.
 */
function buildInput(providerId, { prompt, files = [], mentions = [] }, { fsApi = fs } = {}) {
  const warnings = [];
  const images = files.filter((f) => f.kind === "image");
  const others = files.filter((f) => f.kind !== "image");
  if (providerId === "claude") {
    const lines = others.map(label);
    const text = lines.length ? `${prompt}\n\n${t("attachments.attachedFiles")}\n${lines.join("\n")}` : prompt;
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
      text: lines.length ? `${prompt}\n\n${t("attachments.attachedFiles")}\n${lines.join("\n")}` : prompt,
      warnings,
    };
  }
  const lines = files.map(label);
  if (images.length)
    warnings.push(
      t("attachments.agyImageNotice"),
    );
  return {
    text: lines.length ? `${prompt}\n\n${t("attachments.attachedFiles")}\n${lines.join("\n")}` : prompt,
    warnings,
  };
}

/** App data folder, so attachments sit next to the database. */
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
