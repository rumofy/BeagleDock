const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const https = require("https");
const { execFileSync, spawn } = require("child_process");
const {
  findBinary,
  execCli,
  shellSpec,
  validCwd,
  cliEnv,
} = require("./platform");
const { createCatalogs } = require("./catalogs");
const { createAgyUsage } = require("./agy-usage");
const agyUsage = createAgyUsage();
const { createCliRunner } = require("./cli-runner");
const { resolveModelSelection } = require("./model-options");
const { createSessionService } = require("./session-service");
const { Worker } = require("worker_threads");
const {
  initDatabase,
  saveUserProfile,
  getUserProfile,
  saveSession,
  deleteSessionFromDb,
  getSavedSessions,
  saveChatMessage,
  replaceChatMessages,
  sessionExists,
  getChatMessages,
  getAllChatMessagesGrouped,
  saveWorkspace,
  getWorkspaces,
  saveAppSettings,
  getAppSettings,
  getNativeSession,
  setNativeSession,
} = require("./database");

const globalPermissions =
  require("./global-permissions").createGlobalPermissions();
const ecosystem = require("./ecosystem").createEcosystem();
// Preserve the existing OS vault identity and Chromium profile after the display-name change.
// These identifiers are compatibility keys; window titles and package names use BeagleDock.
app.setName?.("capyai");
app.commandLine?.appendSwitch("class", "BeagleDock");
app.setPath?.("userData", path.join(app.getPath("appData"), "capyai"));
let updatingCli = false;
let mainWindow;
let ptyModule = null;
try {
  ptyModule = require("node-pty");
} catch (e) {
  console.warn(
    "node-pty not available, falling back to child_process.spawn:",
    e.message,
  );
}

const activePtySessions = new Map();

// 1. Detecção 100% Sistema Operacional (Zero Git)
function detectUserIdentity() {
  let gecosName = "";
  try {
    if (process.platform === "linux" || process.platform === "darwin") {
      const entry = execFileSync(
        "getent",
        ["passwd", String(process.getuid())],
        { encoding: "utf-8", timeout: 1000 },
      ).trim();
      const parts = entry.split(":");
      if (parts.length >= 5 && parts[4]) {
        gecosName = parts[4].split(",")[0].trim();
      }
    }
  } catch (e) {}

  const envUser =
    process.env.USER ||
    process.env.LOGNAME ||
    process.env.USERNAME ||
    (os.userInfo && os.userInfo().username) ||
    "user";
  const fullName = gecosName || envUser;
  const firstName = fullName.split(" ")[0] || fullName;
  const hostname = os.hostname() || "localhost";
  const email = `${envUser}@${hostname}`;
  const initials =
    fullName.length >= 2
      ? fullName.slice(0, 2).toUpperCase()
      : fullName.toUpperCase();

  return { fullName, firstName, email, initials };
}

const catalogs = createCatalogs();
// Consulta oficial de consumo do Claude Code via OAuth token local (~/.claude/.credentials.json)
let claudeQuotaCache = { at: 0, value: null };
function fetchClaudeLiveQuota() {
  // Evita estourar rate limit da API: consulta no máximo 1x por 45s
  if (Date.now() - claudeQuotaCache.at < 45000)
    return Promise.resolve(claudeQuotaCache.value);
  return fetchClaudeLiveQuotaRaw().then((v) => {
    claudeQuotaCache = {
      at: Date.now(),
      value: v
        ? { ...v, updatedAt: new Date().toISOString(), stale: false }
        : claudeQuotaCache.value
          ? { ...claudeQuotaCache.value, stale: true }
          : null,
    };
    return claudeQuotaCache.value;
  });
}
function fetchClaudeLiveQuotaRaw() {
  return new Promise((resolve) => {
    try {
      const credsPath = path.join(
        process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
        ".credentials.json",
      );
      if (!fs.existsSync(credsPath)) return resolve(null);
      const creds = JSON.parse(fs.readFileSync(credsPath, "utf-8"));
      const token = creds?.claudeAiOauth?.accessToken;
      if (!token) return resolve(null);

      const req = https.request(
        "https://api.anthropic.com/api/oauth/usage",
        {
          method: "GET",
          timeout: 4500,
          headers: {
            Authorization: `Bearer ${token}`,
            "anthropic-beta": "oauth-2025-04-20",
            "User-Agent": `BeagleDock/${require("../package.json").version}`,
          },
        },
        (res) => {
          let body = "";
          res.on("data", (d) => (body += d));
          res.on("end", () => {
            try {
              if (res.statusCode === 200) {
                const parsed = JSON.parse(body);
                resolve({
                  window5hPercent: Number.isFinite(
                    parsed?.five_hour?.utilization,
                  )
                    ? Math.round(parsed.five_hour.utilization)
                    : null,
                  weeklyPercent: Number.isFinite(parsed?.seven_day?.utilization)
                    ? Math.round(parsed.seven_day.utilization)
                    : null,
                  window5hResetAt: parsed?.five_hour?.resets_at || null,
                  weeklyResetAt: parsed?.seven_day?.resets_at || null,
                  planType: creds?.claudeAiOauth?.subscriptionType || undefined,
                  sourceLabel: "Anthropic OAuth Usage API",
                });
              } else {
                resolve(null);
              }
            } catch (e) {
              resolve(null);
            }
          });
        },
      );

      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    } catch (e) {
      resolve(null);
    }
  });
}

// Local logs are parsed off the UI process; no token estimates or invented quotas.
const localWorkers = new Set();
function runLocalJob(action, args = []) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "local-data-worker.js"), {
      workerData: { action, args },
    });
    localWorkers.add(worker);
    let received = false;
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("Tempo limite ao ler dados locais."));
    }, 30000);
    worker.once("message", (value) => {
      received = true;
      clearTimeout(timer);
      if (value.error) reject(new Error(value.error));
      else resolve(value.result);
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once("exit", () => {
      localWorkers.delete(worker);
      clearTimeout(timer);
      if (!received) reject(new Error("Falha ao ler dados locais."));
    });
  });
}
let metricsPending;
function readMetricsInWorker() {
  if (!metricsPending)
    metricsPending = runLocalJob("metrics").finally(() => {
      metricsPending = null;
    });
  return metricsPending;
}
let lastMetrics;
async function getRealQuotaMetrics() {
  const [metrics, live, liveAgy] = await Promise.all([
    readMetricsInWorker().catch((error) =>
      Object.fromEntries(
        ["claude", "codex", "antigravity"].map((id) => [
          id,
          {
            ...(lastMetrics?.[id] || {
              window5hPercent: null,
              weeklyPercent: null,
            }),
            stale: true,
            sourceLabel: error.message,
          },
        ]),
      ),
    ),
    fetchClaudeLiveQuota(),
    agyUsage.get(),
  ]);
  if (live)
    metrics.claude = {
      ...metrics.claude,
      ...live,
      remainingResetMinutes: live.window5hResetAt
        ? Math.max(
            0,
            Math.ceil(
              (new Date(live.window5hResetAt).getTime() - Date.now()) / 60000,
            ),
          )
        : null,
    };
  if (live) {
    if (
      live.window5hResetAt &&
      new Date(live.window5hResetAt).getTime() <= Date.now()
    ) {
      metrics.claude.window5hPercent = null;
      metrics.claude.stale = true;
    }
    if (
      live.weeklyResetAt &&
      new Date(live.weeklyResetAt).getTime() <= Date.now()
    ) {
      metrics.claude.weeklyPercent = null;
      metrics.claude.stale = true;
    }
  }
  metrics.antigravity = { ...metrics.antigravity, ...liveAgy };
  lastMetrics = metrics;
  return metrics;
}

// 3. Integração Completa com o binário real do ai-memory (Stripping log line on stdout)
function parseAiMemoryJsonOutput(stdout) {
  if (!stdout) return null;
  const trimmed = stdout.trim();
  // O binário do ai-memory imprime uma linha de INFO no início do stdout antes do JSON
  const lines = trimmed.split("\n");
  const cleanLines = lines.filter(
    (l) =>
      !l.includes("INFO ai_memory_cli:") && !l.includes("WARN ai_memory_cli:"),
  );
  const candidate = cleanLines.join("\n").trim();
  try {
    return JSON.parse(candidate);
  } catch (e) {
    // Fallback: procura o primeiro '{' ou '['
    const firstBrace = candidate.indexOf("{");
    const firstBracket = candidate.indexOf("[");
    let startIdx = -1;
    if (firstBrace !== -1 && firstBracket !== -1)
      startIdx = Math.min(firstBrace, firstBracket);
    else startIdx = Math.max(firstBrace, firstBracket);

    if (startIdx !== -1) {
      try {
        return JSON.parse(candidate.slice(startIdx));
      } catch (e2) {}
    }
    return null;
  }
}

function runAiMemoryJson(args, cwd) {
  return new Promise((resolve) => {
    const aiMemoryBin = findBinary("ai-memory");
    if (!aiMemoryBin)
      return resolve({ ok: false, error: "ai-memory binary not found" });

    execCli(aiMemoryBin, args, { cwd: cwd || process.cwd(), timeout: 10000 })
      .then(({ stdout, stderr }) => {
        const parsed = parseAiMemoryJsonOutput(stdout);
        if (parsed !== null) {
          resolve({ ok: true, data: parsed });
        } else {
          const cleanText = (stdout || "")
            .split("\n")
            .filter((l) => !l.includes("INFO ai_memory_cli:"))
            .join("\n")
            .trim();
          resolve({ ok: true, rawText: cleanText, stderr });
        }
      })
      .catch((err) => resolve({ ok: false, error: err.message }));
  });
}

async function checkAIMemoryServer() {
  const [statusRes, recentRes, handoffsRes, projectsRes] = await Promise.all([
    runAiMemoryJson(["status", "--json"]),
    runAiMemoryJson(["recent", "--global", "--limit", "40", "--json"]),
    Promise.resolve({ ok: true, rawText: "" }),
    runAiMemoryJson(["list-projects"]),
  ]);

  if (!statusRes.ok || !statusRes.data) {
    return {
      running: false,
      error: statusRes.error || "Failed to read ai-memory status",
    };
  }

  const projectsList = [];
  if (projectsRes.rawText) {
    const lines = projectsRes.rawText.trim().split("\n");
    for (const line of lines) {
      if (
        line.startsWith("WORKSPACE") ||
        line.includes("INFO ai_memory_cli") ||
        !line.trim()
      )
        continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        projectsList.push({
          workspace: parts[0],
          project: parts[1],
          projectId: parts[2],
          pages: parseInt(parts[3], 10) || 0,
          lastUpdated: parts[4] || "",
        });
      }
    }
  }

  return {
    running: true,
    cliPath: findBinary("ai-memory"),
    data: statusRes.data,
    recentPages: Array.isArray(recentRes.data) ? recentRes.data : [],
    handoffsRaw: handoffsRes.rawText || "",
    projects: projectsList,
  };
}

// 4. Skills Reais do Sistema
function getInstalledSkills() {
  const dirs = [
    path.join(os.homedir(), ".agents", "skills"),
    path.join(os.homedir(), ".claude", "skills"),
    path.join(os.homedir(), ".gemini", "config", "skills"),
    path.join(os.homedir(), ".gemini", "antigravity-cli", "builtin", "skills"),
  ];
  const skills = [];
  const seen = new Set();

  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    try {
      const items = fs.readdirSync(d);
      for (const item of items) {
        if (seen.has(item) || item.startsWith(".")) continue;
        const skillPath = path.join(d, item);
        const skillFile = path.join(skillPath, "SKILL.md");
        let desc = "Skill instalada no ambiente local";
        if (fs.existsSync(skillFile)) {
          try {
            const content = fs.readFileSync(skillFile, "utf-8");
            const match = content.match(/description:\s*(.+)/i);
            if (match) desc = match[1].replace(/['\"]/g, "").trim();
          } catch (e) {}
        }
        seen.add(item);
        skills.push({
          id: `skill-${item}`,
          name: item,
          description: desc,
          path: skillPath,
          category: item.startsWith("ai-memory")
            ? "ai-memory"
            : item.startsWith("aws-")
              ? "AWS"
              : item.includes("revis")
                ? "Review"
                : "Geral",
          commandSnippet:
            item === "revisao-interna"
              ? "manda pro revisor"
              : item === "revisao-seguranca"
                ? "revisar seguranca"
                : `use skill ${item}`,
        });
      }
    } catch (e) {}
  }

  skills.sort((a, b) => {
    const score = (s) =>
      s.category === "Review" ? 0 : s.category === "ai-memory" ? 1 : 2;
    if (score(a) !== score(b)) return score(a) - score(b);
    return a.name.localeCompare(b.name);
  });

  return skills;
}

function getCliHistory() {
  return runLocalJob("history");
}
function loadFullConversation(provider, sessionId) {
  return runLocalJob("conversation", [provider, sessionId]);
}
function discoverLocalWorkspaces() {
  const cwd = process.cwd();
  return [
    {
      id: "ws-current",
      name: path.basename(cwd),
      path: cwd,
      hasAIMemory: fs.existsSync(path.join(cwd, ".ai-memory.toml")),
      aiMemoryDaemonActive: false,
    },
  ];
}

// 8. Gerenciador de Processos PTY Interativos e Execução de Prompts Reais
function ensurePtySession(sessionId, cwd, providerId) {
  if (activePtySessions.has(sessionId)) {
    const existing = activePtySessions.get(sessionId);
    if (existing.cwd === validCwd(cwd)) return existing;
    try {
      existing.proc.kill();
    } catch {}
    activePtySessions.delete(sessionId);
  }

  const targetCwd = validCwd(cwd);
  const shell = shellSpec();
  const shellBin = shell.bin;

  if (ptyModule) {
    try {
      const ptyProc = ptyModule.spawn(shellBin, shell.args, {
        name: "xterm-256color",
        cols: 100,
        rows: 30,
        cwd: targetCwd,
        env: { ...cliEnv(), TERM: "xterm-256color", COLORTERM: "truecolor" },
      });

      const entry = {
        type: "pty",
        proc: ptyProc,
        pid: ptyProc.pid,
        cwd: targetCwd,
        providerId,
      };

      ptyProc.onData((data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("pty-data", {
            sessionId,
            data,
            pid: ptyProc.pid,
          });
        }
      });

      ptyProc.onExit(({ exitCode }) => {
        if (activePtySessions.get(sessionId) === entry)
          activePtySessions.delete(sessionId);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("pty-exit", { sessionId, exitCode });
        }
      });

      activePtySessions.set(sessionId, entry);
      return entry;
    } catch (err) {
      console.error(
        "Failed to spawn node-pty, falling back to child_process:",
        err.message,
      );
    }
  }

  const cp = spawn(shellBin, shell.fallbackArgs, {
    cwd: targetCwd,
    env: { ...cliEnv(), TERM: "xterm-256color" },
  });

  const entry = {
    type: "cp",
    proc: cp,
    pid: cp.pid,
    cwd: targetCwd,
    providerId,
  };

  cp.stdout.on("data", (chunk) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pty-data", {
        sessionId,
        data: chunk.toString(),
        pid: cp.pid,
      });
    }
  });
  cp.stderr.on("data", (chunk) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pty-data", {
        sessionId,
        data: chunk.toString(),
        pid: cp.pid,
      });
    }
  });
  cp.on("error", (error) => {
    activePtySessions.delete(sessionId);
    sendToRenderer("pty-exit", { sessionId, error: error.message });
  });
  cp.on("close", (code) => {
    if (activePtySessions.get(sessionId) === entry)
      activePtySessions.delete(sessionId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pty-exit", { sessionId, exitCode: code });
    }
  });

  activePtySessions.set(sessionId, entry);
  return entry;
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send(channel, payload);
}
let refreshTimer;
let modelTimer;
let pushing;
async function pushToolsUpdate() {
  if (pushing) return pushing;
  pushing = (async () => {
    const [tools, quotas] = await Promise.all([
      catalogs.detect(),
      getRealQuotaMetrics(),
    ]);
    ecosystem.observe(tools);
    void ecosystem.check().catch(() => {});
    const updates = ecosystem.get();
    sendToRenderer("tools-update", { tools, quotas, updates });
    return { tools, quotas, updates };
  })().finally(() => {
    pushing = null;
  });
  return pushing;
}
const approvals = require("./approvals").createApprovalBroker({
  emit: sendToRenderer,
});
const cliRunner = createCliRunner({
  approvals,
  globalFingerprint: globalPermissions.fingerprint,
  resolveSelection: ({ providerId, model, effort }) =>
    resolveModelSelection(
      catalogs.localCatalogs()[providerId]?.modelOptions || [],
      model,
      effort,
    ),
  store: { getNativeSession, setNativeSession },
  emit: sendToRenderer,
  onComplete: () => pushToolsUpdate(),
});
const sessionService = createSessionService({
  store: {
    saveSession,
    saveChatMessage,
    replaceChatMessages,
    sessionExists,
    deleteSessionFromDb,
  },
  runner: cliRunner,
});
function shutdown() {
  clearInterval(refreshTimer);
  clearInterval(modelTimer);
  cliRunner.shutdown();
  for (const worker of localWorkers) worker.terminate();
  for (const [, entry] of activePtySessions) {
    try {
      entry.proc.kill();
    } catch {}
  }
  activePtySessions.clear();
}
module.exports = { shutdown };

function createWindow() {
  const iconPath = path.join(__dirname, "../dist/brand/beagledock-logo.png");

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#f7f5ef",
    title: "BeagleDock - Multi-AI Cockpit",
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });

  const devUrl = "http://127.0.0.1:5173";
  if (process.env.NODE_ENV === "development" || !app.isPackaged) {
    mainWindow.loadURL(devUrl).catch(() => {
      setTimeout(() => mainWindow.loadURL(devUrl), 1000);
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

module.exports.ready = app.whenReady().then(async () => {
  await initDatabase();
  const registerHandler = ipcMain.handle.bind(ipcMain);
  const handle = (channel, handler) =>
    registerHandler(channel, (event, ...args) => {
      if (!mainWindow || event.sender !== mainWindow.webContents)
        throw new Error("Remetente IPC inválido.");
      if (
        event.senderFrame &&
        event.senderFrame !== mainWindow.webContents.mainFrame
      )
        throw new Error("Frame IPC inválido.");
      return handler(event, ...args);
    });

  // IPC: Ferramentas, Catálogos de Modelos e Cotas Reais (OAuth + Token Count)
  handle("detect-tools", async () => {
    return pushToolsUpdate();
  });

  handle("get-cli-approvals", () => approvals.list());
  handle("resolve-cli-approval", (_event, id, decision) =>
    approvals.resolve(id, decision),
  );
  handle("get-global-permissions", () => globalPermissions.all());
  handle("save-global-permissions", (_event, id, changes) => {
    const policy = globalPermissions.save(id, changes);
    return policy;
  });
  handle("check-cli-updates", async () => {
    await ecosystem.check(true);
    return pushToolsUpdate();
  });
  handle("read-notifications", () => ecosystem.markRead());
  handle("update-cli", async (_event, id) => {
    if (!["claude", "codex", "antigravity"].includes(id))
      throw new Error("CLI inválida.");
    if (activePtySessions.size || sessionService.isBusy())
      throw new Error(
        "Aguarde as execuções terminarem antes de atualizar uma CLI.",
      );
    if (updatingCli) throw new Error("Atualização já em andamento.");
    updatingCli = true;
    try {
      await cliRunner.prepareUpdate();
      const result = await ecosystem.update(id);
      if (result.ok) {
        catalogs.invalidateVersions();
        await catalogs.refreshAgy(true);
        await pushToolsUpdate();
      }
      return result;
    } finally {
      updatingCli = false;
    }
  });
  // IPC: Status e Comandos Reais do ai-memory
  handle("ai-memory-status", async () => {
    return await checkAIMemoryServer();
  });

  handle(
    "ai-memory-search",
    async (
      _event,
      query,
      isGlobal = true,
      workspace = null,
      project = null,
    ) => {
      const args = ["search", query, "--limit", "40", "--json"];
      if (workspace && project && !isGlobal) {
        args.push("--workspace", workspace, "--project", project);
      } else {
        args.push("--global");
      }
      const res = await runAiMemoryJson(args);
      if (res.ok && Array.isArray(res.data) && workspace && project) {
        res.data = res.data.map((p) => ({
          ...p,
          workspace: p.workspace || workspace,
          project: p.project || project,
        }));
      }
      return res;
    },
  );

  handle(
    "ai-memory-list-pages",
    async (_event, workspace = null, project = null, limit = 50) => {
      const args = ["recent", "--limit", String(limit), "--json"];
      if (workspace && project) {
        args.push("--workspace", workspace, "--project", project);
      } else {
        args.push("--global");
      }
      const res = await runAiMemoryJson(args);
      if (res.ok && Array.isArray(res.data) && workspace && project) {
        res.data = res.data.map((p) => ({
          ...p,
          workspace: p.workspace || workspace,
          project: p.project || project,
        }));
      }
      return res;
    },
  );

  handle(
    "ai-memory-read-page",
    async (_event, pagePath, workspace, project) => {
      const args = ["read-page", "--path", pagePath, "--json"];
      if (!workspace || !project)
        return {
          ok: false,
          error: "Workspace e projeto são obrigatórios para ler uma página.",
        };
      args.push("--workspace", workspace, "--project", project);
      return await runAiMemoryJson(args);
    },
  );

  handle("ai-memory-command", async (_event, subcmdArgs, cwd) => {
    if (
      !Array.isArray(subcmdArgs) ||
      subcmdArgs.length !== 1 ||
      subcmdArgs[0] !== "handoffs"
    )
      return { ok: false, error: "Comando não permitido pela interface." };
    return await runAiMemoryJson(subcmdArgs, validCwd(cwd));
  });

  // IPC: Skills e Histórico
  handle("get-skills", async () => {
    return getInstalledSkills();
  });

  handle("get-history", async () => {
    return getCliHistory();
  });

  handle("load-full-conversation", async (_event, provider, sessionId) => {
    try {
      return await loadFullConversation(provider, sessionId);
    } catch (e) {
      return { error: e.message };
    }
  });

  // IPC: Identidade OS + SQLite Profile
  handle("get-user-profile", async () => {
    try {
      const detected = detectUserIdentity();
      await saveUserProfile(detected);
      return detected;
    } catch (e) {
      return detectUserIdentity();
    }
  });

  // IPC: Sessões e Mensagens no SQLite
  handle("save-session", async (_event, session) => {
    try {
      return await sessionService.saveSession(session);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  handle("delete-session", async (_event, sessionId) => {
    try {
      const ptyEntry = activePtySessions.get(sessionId);
      if (ptyEntry && ptyEntry.proc) {
        try {
          ptyEntry.proc.kill();
        } catch (e) {}
        activePtySessions.delete(sessionId);
      }
      return await sessionService.remove(sessionId);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  handle("get-saved-state", async () => {
    try {
      const [sessions, messagesBySession, savedWorkspaces, appSettings] =
        await Promise.all([
          getSavedSessions(),
          getAllChatMessagesGrouped(),
          getWorkspaces(),
          getAppSettings(),
        ]);

      let workspaces = savedWorkspaces;
      if (!workspaces || workspaces.length === 0) {
        workspaces = discoverLocalWorkspaces();
        for (const ws of workspaces) {
          await saveWorkspace(ws);
        }
      }

      return {
        sessions,
        messagesBySession,
        workspaces,
        settings: appSettings,
      };
    } catch (e) {
      return {
        sessions: [],
        messagesBySession: {},
        workspaces: discoverLocalWorkspaces(),
        settings: null,
        error: e.message,
      };
    }
  });

  handle("save-workspace", async (_event, ws) => {
    try {
      validCwd(ws.path);
      const enriched = {
        ...ws,
        hasAIMemory: fs.existsSync(path.join(ws.path, ".ai-memory.toml")),
        aiMemoryDaemonActive: false,
      };
      await saveWorkspace(enriched);
      return enriched;
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  handle("save-app-settings", async (_event, settingsObj) => {
    try {
      return await saveAppSettings(settingsObj);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  handle("save-chat-message", async (_event, msg) => {
    try {
      return await sessionService.saveChatMessage(msg);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  handle("get-chat-messages", async (_event, sessionId) => {
    try {
      return await getChatMessages(sessionId);
    } catch (e) {
      return [];
    }
  });

  // IPC: PTY e Execução Real de Prompts
  handle("pty-spawn", async (_event, { sessionId, cwd, providerId }) => {
    if (updatingCli) throw new Error("Aguarde a atualização da CLI terminar.");
    const entry = ensurePtySession(sessionId, cwd, providerId);
    return { ok: true, pid: entry.pid, cwd: entry.cwd };
  });

  handle("pty-write", async (_event, { sessionId, input, cwd, providerId }) => {
    const entry = ensurePtySession(sessionId, cwd, providerId);
    if (entry.type === "pty") {
      entry.proc.write(input);
    } else if (entry.proc.stdin) {
      entry.proc.stdin.write(input);
    }
    return { ok: true, pid: entry.pid };
  });

  handle("pty-resize", async (_event, { sessionId, cols, rows }) => {
    const entry = activePtySessions.get(sessionId);
    if (entry && entry.type === "pty" && cols > 0 && rows > 0) {
      try {
        entry.proc.resize(cols, rows);
      } catch (e) {}
    }
    return { ok: true };
  });

  handle("replace-chat-messages", async (_event, id, messages) => {
    try {
      return await sessionService.replaceChatMessages(id, messages);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  handle("interrupt-cli-session", (_event, id) => sessionService.interrupt(id));
  handle("execute-cli-prompt", async (_event, payload) =>
    updatingCli
      ? { ok: false, error: "Aguarde a atualização da CLI terminar." }
      : sessionService.execute(payload),
  );

  createWindow();

  refreshTimer = setInterval(() => {
    pushToolsUpdate().catch(() => {});
  }, 15000);
  // Refreshing a remote CLI catalog never delays usage updates.
  catalogs
    .refreshAgy()
    .then(() => pushToolsUpdate())
    .catch(() => {});
  modelTimer = setInterval(
    () =>
      catalogs
        .refreshAgy()
        .then(() => pushToolsUpdate())
        .catch(() => {}),
    60000,
  );
  modelTimer.unref();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", shutdown);
app.on("window-all-closed", () => {
  for (const [, entry] of activePtySessions.entries()) {
    try {
      entry.proc.kill();
    } catch (e) {}
  }
  if (process.platform !== "darwin") app.quit();
});
