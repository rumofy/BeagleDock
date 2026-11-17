const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const MARKER = ".ai-memory.toml";

function parseMarker(text) {
  const out = {};
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) break; // keys after a [table] header belong to that table
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*(?:#.*)?$/);
    if (m) out[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return out;
}

function findMarker(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    const file = path.join(dir, MARKER);
    try {
      if (fs.statSync(file).isFile()) return file;
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** `git@host:org/repo.git`, `https://host/org/repo.git`, `ssh://git@host/org/repo` → `org-repo`. */
function projectFromRemote(url) {
  let s = String(url || "").trim();
  if (!s) return "";
  let p;
  const scp = s.match(/^[^/@\s]+@[^:/\s]+:(.+)$/) || s.match(/^[^/@\s]+:(?!\/\/)(.+)$/);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) p = scp[1];
  else {
    try {
      p = new URL(s).pathname;
    } catch {
      return "";
    }
  }
  const segs = p.split("/").filter(Boolean);
  if (!segs.length) return "";
  segs[segs.length - 1] = segs[segs.length - 1].replace(/\.git$/i, "");
  return segs.join("-").replace(/[^A-Za-z0-9._-]/g, "-");
}

function gitRemote(cwd, name) {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", cwd, "remote", "get-url", name],
      { timeout: 3000, windowsHide: true },
      (err, stdout) => resolve(err ? "" : String(stdout).trim()),
    );
  });
}

async function resolveAiMemoryScope(cwd) {
  const markerPath = findMarker(cwd);
  let marker = {};
  if (markerPath) {
    try {
      marker = parseMarker(fs.readFileSync(markerPath, "utf8"));
    } catch {}
  }
  const workspace = marker.workspace || "default";
  if (marker.project)
    return { workspace, project: marker.project, source: "marker", markerPath };
  for (const name of ["upstream", "origin"]) {
    const project = projectFromRemote(await gitRemote(cwd, name));
    if (project) return { workspace, project, source: "git", markerPath };
  }
  return {
    workspace,
    project: path.basename(path.resolve(cwd)) || "default",
    source: "folder",
    markerPath,
  };
}

// Same shape as the names the ai-memory server lists; no quotes or line breaks reach the TOML.
const SCOPE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._ -]{0,127}$/;
const SCOPE_KEY = /^\s*(workspace|project)\s*=/;

function validScopeName(value) {
  const s = String(value || "").trim();
  return SCOPE_NAME.test(s) ? s : null;
}

/**
 * Points the folder at an existing ai-memory project by writing `workspace`/`project`
 * into the folder's own `.ai-memory.toml`. Other lines (comments, `server = ...`) are kept.
 */
function writeMarkerScope(dir, { workspace, project }, fsApi = fs) {
  const ws = validScopeName(workspace);
  const proj = validScopeName(project);
  if (!ws || !proj) throw new Error("invalid ai-memory scope");
  const file = path.join(path.resolve(dir), MARKER);
  let lines = [];
  try {
    lines = fsApi.readFileSync(file, "utf8").split(/\r?\n/);
  } catch {}
  // Top-level keys only: anything after the first `[table]` belongs to that table.
  const firstTable = lines.findIndex((l) => l.trim().startsWith("["));
  const top = firstTable === -1 ? lines : lines.slice(0, firstTable);
  const rest = firstTable === -1 ? [] : lines.slice(firstTable);
  const kept = top.filter((l) => !SCOPE_KEY.test(l));
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  const out = [`workspace = "${ws}"`, `project = "${proj}"`, ...kept];
  if (rest.length) out.push("", ...rest);
  let text = out.join("\n");
  if (!text.endsWith("\n")) text += "\n";
  fsApi.writeFileSync(file, text);
  return file;
}

/**
 * Removes the link from the folder's own `.ai-memory.toml`; deletes the file when nothing
 * else is left in it. Returns false when the folder has no marker of its own.
 */
function clearMarkerScope(dir, fsApi = fs) {
  const file = path.join(path.resolve(dir), MARKER);
  let text;
  try {
    text = fsApi.readFileSync(file, "utf8");
  } catch {
    return false;
  }
  const lines = text.split(/\r?\n/);
  const firstTable = lines.findIndex((l) => l.trim().startsWith("["));
  const kept = lines.filter((l, i) => !(SCOPE_KEY.test(l) && (firstTable === -1 || i < firstTable)));
  if (kept.every((l) => !l.trim() || l.trim().startsWith("#"))) fsApi.unlinkSync(file);
  else fsApi.writeFileSync(file, kept.join("\n").replace(/\n*$/, "\n"));
  return true;
}

/** Whether the marker that decides the scope lives in `dir` itself (not in a parent folder). */
function markerIsLocal(markerPath, dir) {
  return !!markerPath && path.dirname(markerPath) === path.resolve(dir);
}

module.exports = {
  resolveAiMemoryScope,
  parseMarker,
  projectFromRemote,
  findMarker,
  writeMarkerScope,
  clearMarkerScope,
  markerIsLocal,
  validScopeName,
};
