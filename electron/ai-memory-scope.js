const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const MARKER = ".ai-memory.toml";

function parseMarker(text) {
  const out = {};
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("[")) continue;
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

module.exports = { resolveAiMemoryScope, parseMarker, projectFromRemote, findMarker };
