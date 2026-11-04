const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const https = require("https");
const { t } = require("./i18n");

const DEFAULT_SERVER = "http://127.0.0.1:49374";
const NAME_RE = /^[A-Za-z0-9._-]{1,120}$/;

function validName(value, label = "nome") {
  if (
    typeof value !== "string" ||
    !NAME_RE.test(value) ||
    value.startsWith("-") ||
    value.startsWith(".")
  )
    throw new Error(t("errors.invalidValue", { label }));
  return value;
}

function validPagePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 300 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    !value.endsWith(".md") ||
    value.split("/").some((seg) => seg === ".." || seg === "." || seg === "")
  )
    throw new Error(t("errors.invalidPagePath"));
  return value;
}

function readTextSafe(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function configDir(env, home) {
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "ai-memory");
}

function resolveServerUrl({ env = process.env, home = os.homedir() } = {}) {
  const clean = (v) => String(v || "").trim().replace(/\/+$/, "");
  if (clean(env.AI_MEMORY_SERVER_URL)) return clean(env.AI_MEMORY_SERVER_URL);
  const dir = configDir(env, home);
  const line = readTextSafe(path.join(dir, "env"))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith("AI_MEMORY_SERVER_URL="));
  if (line) {
    const value = clean(line.slice("AI_MEMORY_SERVER_URL=".length).replace(/^["']|["']$/g, ""));
    if (value) return value;
  }
  const remote = clean(readTextSafe(path.join(dir, "remote-active")).split(/\r?\n/)[0]);
  return remote || DEFAULT_SERVER;
}

function resolveToken({ env = process.env, home = os.homedir() } = {}) {
  if (String(env.AI_MEMORY_AUTH_TOKEN || "").trim()) return env.AI_MEMORY_AUTH_TOKEN.trim();
  const dataDir =
    env.AI_MEMORY_DATA_DIR ||
    path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "ai-memory");
  return readTextSafe(path.join(dataDir, "auth-token")).split(/\r?\n/)[0].trim();
}

function describeStatus(status) {
  if (status === 401 || status === 403) return t("errors.aiMemoryToken");
  if (status === 404) return t("errors.aiMemoryNotFound");
  return `Servidor ai-memory respondeu HTTP ${status}.`;
}

function fetchJson(urlPath, { timeoutMs = 20000, env = process.env, home = os.homedir() } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(resolveServerUrl({ env, home }).replace(/\/+$/, "") + urlPath);
    } catch {
      return reject(new Error(t("errors.aiMemoryUrl")));
    }
    const lib = url.protocol === "https:" ? https : http;
    const token = resolveToken({ env, home });
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = lib.request(url, { method: "GET", headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(describeStatus(res.statusCode));
          err.status = res.statusCode;
          return reject(err);
        }
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error(t("errors.aiMemoryResponse")));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(t("errors.aiMemoryTimeout"))));
    req.on("error", (err) => {
      if (err.code === "ECONNREFUSED") err.message = t("errors.aiMemoryOffline");
      reject(err);
    });
    req.end();
  });
}

const arr = (data, ...keys) => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const k of [...keys, "items", "pages", "data", "results"])
      if (Array.isArray(data[k])) return data[k];
    const found = Object.values(data).find(Array.isArray);
    if (found) return found;
  }
  return [];
};
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v) => (v == null ? "" : String(v));

function projectBase(ws, p) {
  return `/api/v1/workspaces/${encodeURIComponent(validName(ws, "workspace"))}/projects/${encodeURIComponent(validName(p, "project"))}`;
}

function normalizeProject(x) {
  return {
    workspace: str(x.workspace_name ?? x.workspace),
    project: str(x.project_name ?? x.project),
    projectId: str(x.project_id),
    pageCount: num(x.page_count),
    sessionCount: num(x.session_count),
    observationCount: num(x.observation_count),
    openSessionCount: num(x.open_session_count),
    lastUpdated: str(x.last_updated),
    lastActivity: str(x.last_activity),
  };
}
function normalizePage(x) {
  return {
    path: str(x.path),
    title: str(x.title) || str(x.path),
    kind: str(x.kind),
    tier: str(x.tier),
    updatedAt: str(x.updated_at ?? x.updatedAt),
  };
}

async function listProjects(opts) {
  return arr(await fetchJson("/api/v1/projects", opts), "projects").map(normalizeProject);
}
async function listPages(ws, p, opts) {
  const data = await fetchJson(`${projectBase(ws, p)}/pages?limit=2000`, opts);
  return arr(data, "pages").map(normalizePage).filter((x) => x.path);
}
async function getPage(ws, p, pagePath, opts) {
  validPagePath(pagePath);
  const encoded = pagePath.split("/").map(encodeURIComponent).join("/");
  const data = await fetchJson(`${projectBase(ws, p)}/pages/${encoded}`, opts);
  const page = data && typeof data === "object" && data.page ? data.page : data;
  return {
    path: str(page.path) || pagePath,
    title: str(page.title),
    kind: str(page.kind),
    tier: str(page.tier),
    updatedAt: str(page.updated_at ?? page.updatedAt),
    pinned: Boolean(page.pinned),
    createdAt: str(page.created_at ?? page.createdAt),
    frontmatter:
      page.frontmatter && typeof page.frontmatter === "object" ? page.frontmatter : {},
    links: Array.isArray(page.links) ? page.links : [],
    backlinks: Array.isArray(page.backlinks) ? page.backlinks : [],
    body: str(page.body_markdown ?? page.body ?? page.content ?? page.markdown ?? page.text),
  };
}
async function getOverview(ws, p, opts) {
  const d = await fetchJson(`${projectBase(ws, p)}/overview`, opts);
  const b = d?.briefing || {};
  const h = d?.health || {};
  const orphans = Array.isArray(h.orphan_pages) ? h.orphan_pages : [];
  const list = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? { path: x } : { path: str(x.path), title: str(x.title) })) : []);
  return {
    counts: b.counts || {},
    activity7d: b.activity_7d ?? null,
    activity30d: b.activity_30d ?? null,
    lastObservationAt: str(b.last_observation_at),
    pendingHandoffCount: num(b.pending_handoff_count),
    health: {
      stale: num(h.stale),
      duplicates: num(h.duplicates),
      contradictions: num(h.contradictions),
      orphans: num(h.orphans),
      stalePages: list(h.stale_pages),
      duplicatePages: list(h.duplicate_pages),
      orphanPages: orphans.map((x) => ({ path: str(x.path), title: str(x.title), kind: str(x.kind) })),
    },
  };
}
async function listSessions(ws, p, opts) {
  // Without `limit` the server returns only 20 (100 is the maximum) and, without `include_open`, it omits
  // sessions that never got their end (an interrupted test CLI, for example).
  const d = await fetchJson(`${projectBase(ws, p)}/sessions?limit=100&include_open=true`, opts);
  return arr(d, "sessions").map((s) => ({
    sessionId: str(s.session_id),
    cwd: str(s.cwd),
    agentKind: str(s.agent_kind),
    startedAt: str(s.started_at),
    endedAt: str(s.ended_at),
    observationCount: num(s.observation_count),
  }));
}

module.exports = {
  DEFAULT_SERVER,
  validName,
  validPagePath,
  resolveServerUrl,
  resolveToken,
  fetchJson,
  listProjects,
  listPages,
  getPage,
  getOverview,
  listSessions,
};
