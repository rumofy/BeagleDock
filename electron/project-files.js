const fs = require("fs");
const path = require("path");
const { execCli, findBinary } = require("./platform");

// Project files for @file autocomplete: uses git (honors .gitignore) and, outside a
// repository, walks the folders skipping dependency and hidden ones.
const MAX_FILES = 20000;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "release", ".next", "target", "__pycache__", ".venv", "venv", "coverage"]);

function walk(root, fsApi = fs, limit = MAX_FILES) {
  const found = [];
  const pending = [""];
  while (pending.length && found.length < limit) {
    const rel = pending.shift();
    let entries;
    try {
      entries = fsApi.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) pending.push(next);
      } else if (entry.isFile()) found.push(next);
      if (found.length >= limit) break;
    }
  }
  return found;
}

async function listFiles(cwd, { exec = execCli, find = findBinary, fsApi = fs } = {}) {
  const git = find("git");
  if (git) {
    try {
      const { stdout } = await exec(git, ["-C", cwd, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { timeout: 8000 });
      const files = stdout.split("\0").filter(Boolean);
      if (files.length) return files.slice(0, MAX_FILES);
    } catch {
      /* outside a git repository: walk the folders */
    }
  }
  return walk(cwd, fsApi);
}

/** Scores the path for the search: the file name and a prefix weigh more than a loose fragment in the path. */
function score(file, query) {
  const lower = file.toLowerCase();
  const base = lower.slice(lower.lastIndexOf("/") + 1);
  if (!query) return 1000 + file.length;
  if (base === query) return 0;
  if (base.startsWith(query)) return 10 + base.length;
  if (base.includes(query)) return 100 + base.length;
  if (lower.includes(query)) return 200 + file.length;
  // Letters in order (e.g. "uss" finds useSessions.ts): only in the file name.
  let at = 0;
  for (const ch of query) {
    at = base.indexOf(ch, at);
    if (at < 0) return -1;
    at++;
  }
  return 300 + base.length;
}

function searchFiles(files, query, limit = 30) {
  const q = String(query || "").toLowerCase();
  return files
    .map((file) => ({ file, s: score(file, q) }))
    .filter((item) => item.s >= 0)
    .sort((a, b) => a.s - b.s || a.file.localeCompare(b.file))
    .slice(0, limit)
    .map((item) => item.file);
}

module.exports = { listFiles, searchFiles, walk };
