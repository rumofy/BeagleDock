// Limpeza automática dos projetos temporários do ai-memory.
//
// O ai-memory cria um projeto para cada pasta onde um CLI abre. Testes com CLI real em pastas
// temporárias (/tmp/tmp.XXXX, /tmp/issue58…) viram projetos soltos que ninguém apaga. Aqui só
// entram projetos em que TODAS as sessões conhecidas vieram de uma pasta temporária: projeto
// com sessão sem pasta registrada, com pasta fora do temporário, sem sessões ou com mais
// sessões do que o servidor devolve numa consulta nunca é apagado.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { canPurgeProject } = require("../shared/memory-rules.mjs");

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 365;
// O endpoint de sessões do ai-memory devolve no máximo 100 por consulta.
const SESSION_PAGE_LIMIT = 100;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_MS = 60 * 1000;

function normalizeDays(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_DAYS;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_DAYS, n);
}

function realOrSelf(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

function defaultTempRoots() {
  const roots = new Set();
  for (const dir of [os.tmpdir(), "/tmp", "/var/tmp"]) {
    if (!dir) continue;
    roots.add(path.resolve(dir));
    roots.add(path.resolve(realOrSelf(dir)));
  }
  return [...roots];
}

function isTempCwd(cwd, roots) {
  const value = typeof cwd === "string" ? cwd.trim() : "";
  if (!value || !path.isAbsolute(value)) return false;
  const dir = path.resolve(value);
  return roots.some((root) => dir === root || dir.startsWith(root + path.sep));
}

function lastSeen(project, sessions) {
  let last = 0;
  const stamps = [project.lastActivity];
  for (const s of sessions) stamps.push(s.startedAt, s.endedAt);
  for (const stamp of stamps) {
    const t = Date.parse(stamp || "");
    if (Number.isFinite(t) && t > last) last = t;
  }
  return last;
}

// Decide, sem I/O, se o projeto é temporário e está parado há mais de `days` dias.
function classifyProject({ project, sessions, roots, days, now }) {
  if (!canPurgeProject(project.workspace, project.project))
    return { temp: false, reason: "protegido" };
  if (!Array.isArray(sessions) || !sessions.length)
    return { temp: false, reason: "sem sessões" };
  if (sessions.length >= SESSION_PAGE_LIMIT || sessions.length < project.sessionCount)
    return { temp: false, reason: "sessões incompletas" };
  if (!sessions.every((s) => isTempCwd(s.cwd, roots)))
    return { temp: false, reason: "pasta fora do temporário" };
  const last = lastSeen(project, sessions);
  if (!last) return { temp: true, stale: false, lastSeen: null };
  return {
    temp: true,
    stale: days > 0 && now - last >= days * DAY_MS,
    lastSeen: new Date(last).toISOString(),
  };
}

function createTempCleanup({
  api,
  purge,
  getDays,
  roots = defaultTempRoots(),
  now = Date.now,
  log = () => {},
} = {}) {
  let running = null;
  let timer = null;
  let firstTimer = null;
  let lastRun = null;

  async function scan(days) {
    const projects = await api.listProjects();
    const found = [];
    for (const project of projects) {
      // Só vale a pena consultar sessões de quem pode ser apagado.
      if (!canPurgeProject(project.workspace, project.project) || !project.sessionCount) continue;
      if (project.sessionCount >= SESSION_PAGE_LIMIT) continue;
      let sessions;
      try {
        sessions = await api.listSessions(project.workspace, project.project);
      } catch {
        continue;
      }
      const result = classifyProject({ project, sessions, roots, days, now: now() });
      if (!result.temp) continue;
      found.push({
        workspace: project.workspace,
        project: project.project,
        sessionCount: project.sessionCount,
        pageCount: project.pageCount,
        lastSeen: result.lastSeen,
        stale: result.stale,
        folders: [...new Set(sessions.map((s) => s.cwd))].slice(0, 5),
      });
    }
    return found;
  }

  async function preview() {
    const days = normalizeDays(await getDays());
    const projects = await scan(days);
    return { days, lastRun, projects };
  }

  // `all`: apaga todos os temporários agora (botão), ignorando o prazo.
  function run({ all = false } = {}) {
    if (running) return running;
    running = (async () => {
      const days = normalizeDays(await getDays());
      if (!all && !days) return { ok: true, days, removed: [], failed: [], skipped: "desligada" };
      const candidates = (await scan(days)).filter((x) => all || x.stale);
      const removed = [];
      const failed = [];
      for (const item of candidates) {
        const res = await purge(item.workspace, item.project);
        if (res?.ok) removed.push(`${item.workspace}/${item.project}`);
        else failed.push({ name: `${item.workspace}/${item.project}`, error: res?.error || "falha" });
      }
      lastRun = { at: new Date(now()).toISOString(), removed: removed.length, failed: failed.length };
      if (removed.length || failed.length)
        log(`ai-memory: limpeza de temporários removeu ${removed.length}, falhou ${failed.length}`);
      return { ok: !failed.length, days, removed, failed };
    })().finally(() => {
      running = null;
    });
    return running;
  }

  function start() {
    stop();
    const tick = () => run().catch((err) => log(`ai-memory: limpeza de temporários: ${err.message}`));
    firstTimer = setTimeout(tick, FIRST_CHECK_MS);
    timer = setInterval(tick, CHECK_EVERY_MS);
    firstTimer.unref?.();
    timer.unref?.();
  }
  function stop() {
    if (firstTimer) clearTimeout(firstTimer);
    if (timer) clearInterval(timer);
    firstTimer = timer = null;
  }

  return { preview, run, start, stop };
}

module.exports = {
  DEFAULT_DAYS,
  MAX_DAYS,
  SESSION_PAGE_LIMIT,
  normalizeDays,
  defaultTempRoots,
  isTempCwd,
  classifyProject,
  createTempCleanup,
};
