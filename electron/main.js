const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  Notification,
  nativeImage,
  powerSaveBlocker,
  dialog,
  shell: electronShell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
// Migração única de nomes antigos: precisa rodar antes de abrir o banco e de definir userData.
const { migrateLegacyData } = require("./migration");
migrateLegacyData({ appData: app.getPath?.("appData") });
const { execFileSync, spawn } = require("child_process");
const {
  findBinary,
  execCli,
  shellSpec,
  validCwd,
  cliEnv,
} = require("./platform");
const aiMemoryApi = require("./ai-memory-api");
const { resolveAiMemoryScope } = require("./ai-memory-scope");
const memoryMaintenance = require("./memory-maintenance");
const { createCatalogs } = require("./catalogs");
const { createAgyUsage } = require("./agy-usage");
const { createProviderUsage } = require("./provider-usage");
const { createMcpAuthWatcher } = require("./codex-mcp-auth");
const { createBackgroundController } = require("./background");
const { pickDirectory } = require("./folder-picker");
const zoom = require("./zoom");
const { openInEditor } = require("./editor");
const { openExternalUrl, parseExternalUrl } = require("./external-links");
const { createNativeCommands } = require("./native-commands");
const { setAutostart } = require("./autostart");
const { listFiles, searchFiles } = require("./project-files");
const { inspectWorkspace, validateWorkspaceEdit } = require("./workspace-status");
const nativeCommands = createNativeCommands();
const agyUsage = createAgyUsage();
const providerUsage = createProviderUsage({
  // Cada leitura inicia uma CLI: com a janela oculta ou minimizada, consulta bem menos.
  getRefreshMs: () => (background?.isWindowActive() ? 45000 : 10 * 60000),
  onUpdate: () => pushToolsUpdate().catch(() => {}),
});
const codexMcpAuth = createMcpAuthWatcher({
  notify: (...args) => ecosystem.notifyOnce(...args),
});
const { createCliRunner } = require("./cli-runner");
const { resolveModelSelection } = require("./model-options");
const { createSessionService } = require("./session-service");
const { Worker } = require("worker_threads");
const {
  initDatabase,
  saveUserProfile,
  getUserProfile,
  saveSession,
  setSessionArchived,
  setSessionContext,
  mergeMessageEvents,
  deleteSessionFromDb,
  getSavedSessions,
  saveChatMessage,
  setMessageTime,
  deleteChatMessage,
  replaceChatMessages,
  sessionExists,
  getChatMessages,
  getAllChatMessagesGrouped,
  saveWorkspace,
  updateWorkspace,
  deleteWorkspace,
  workspaceSessionCounts,
  getWorkspaces,
  saveAppSettings,
  getAppSettings,
  dropUnreadableCredentials,
  getNativeSession,
  setNativeSession,
} = require("./database");

const globalPermissions =
  require("./global-permissions").createGlobalPermissions();
const ecosystem = require("./ecosystem").createEcosystem();
app.setName?.("beagledock");
app.commandLine?.appendSwitch("class", "BeagleDock");
app.setPath?.("userData", path.join(app.getPath("appData"), "beagledock"));
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
    providerUsage.get(),
    agyUsage.get(),
  ]);
  // Cota vem das próprias CLIs (/usage do Claude Code, limites do app-server do Codex);
  // os logs locais só fornecem tokens. Nada de leitura por log ou por modelo.
  for (const id of ["claude", "codex"])
    metrics[id] = { ...metrics[id], ...live[id] };
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

function runAiMemoryJson(args, cwd, timeout = 10000) {
  return new Promise((resolve) => {
    const aiMemoryBin = findBinary("ai-memory");
    if (!aiMemoryBin)
      return resolve({ ok: false, error: "ai-memory binary not found" });

    execCli(aiMemoryBin, args, { cwd: cwd || process.cwd(), timeout })
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
  let httpProjects = null;
  try {
    httpProjects = await aiMemoryApi.listProjects();
  } catch {}
  if (httpProjects) {
    for (const p of httpProjects)
      projectsList.push({
        workspace: p.workspace,
        project: p.project,
        projectId: p.projectId,
        pages: p.pageCount,
        lastUpdated: p.lastUpdated,
      });
  } else if (projectsRes.rawText) {
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
    mainWindow.webContents.send(
      channel,
      // Carimbo de emissão para medir o atraso do stream até a tela.
      channel === "cli-stream-chunk" || channel === "cli-activity-event"
        ? { ...payload, emittedAt: Date.now() }
        : payload,
    );
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
let background;
// Título e CLI de cada conversa, para o menu da bandeja listar as que estão rodando.
const sessionInfo = new Map();
const providerNames = { claude: "Claude Code", codex: "Codex CLI", antigravity: "Antigravity" };
const approvals = require("./approvals").createApprovalBroker({
  emit: (channel, payload) => {
    sendToRenderer(channel, payload);
    if (channel === "cli-approvals") background?.onApprovalsChanged();
  },
});
// Limite de compactação automática (configuração do usuário), mantido em memória para cada turno.
let savedAutoCompactTokens;
getAppSettings()
  .then((saved) => {
    if (saved && savedAutoCompactTokens === undefined) savedAutoCompactTokens = saved.autoCompactTokens;
  })
  .catch(() => {});
const { plainText } = require("./message-segments");
const cliRunner = createCliRunner({
  approvals,
  getAutoCompactTokens: () => savedAutoCompactTokens,
  onMcpAuthError: (line) => codexMcpAuth.inspect(line),
  // Agentes em segundo plano atualizam a linha do tempo depois do turno: grava no histórico.
  onLateEvents: (payload) => sessionService.saveLateEvents(payload),
  onAutoTurn: (payload) => {
    void sessionService.saveAutoTurn(payload);
    if (payload.discard) return;
    const names = { claude: "Claude Code", codex: "Codex CLI", antigravity: "Antigravity" };
    background.notifyTurnFinished({
      sessionId: payload.sessionId,
      title: `${names[payload.providerId] || payload.providerId} respondeu`,
      body: plainText(String(payload.ok ? payload.text : payload.error || "Falha na execução."))
        .replace(/\s+/g, " ")
        .slice(0, 140),
    });
  },
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
    setSessionArchived,
    setSessionContext,
    mergeMessageEvents,
    saveChatMessage,
    setMessageTime,
    deleteChatMessage,
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

// Ambiente de teste: sem bandeja, confirmação nem instância única.
const smokeRun = !!process.env.BEAGLEDOCK_SMOKE_ROOT;
background = createBackgroundController({
  app,
  Tray,
  Menu,
  Notification,
  nativeImage,
  powerSaveBlocker,
  dialog,
  getWindow: () => mainWindow,
  iconPath: path.join(__dirname, "../dist/brand/beagledock-logo.png"),
  // Turnos rodando ou na fila de qualquer sessão.
  runningCount: () => Math.max(cliRunner.busyCount(), sessionService.activeCount()),
  approvalsList: () => approvals.list(),
  runningSessions: () =>
    sessionService.activeIds().map((id) => ({
      id,
      title: sessionInfo.get(id)?.title,
      providerName: providerNames[sessionInfo.get(id)?.providerId],
    })),
  // A interface leva o chat até a conversa (clique no menu da bandeja ou na notificação).
  openSession: (sessionId) => sendToRenderer("open-session", { sessionId }),
  bypass: smokeRun,
  onQuit: shutdown,
});
// Instância única: abrir de novo só traz a janela de volta; `beagledock --quit` pede para encerrar
// a instância em execução (com a mesma confirmação da bandeja), útil sem bandeja visível.
const gotLock = smokeRun || app.requestSingleInstanceLock();
if (!gotLock) app.exit(0);
else if (!smokeRun) {
  app.on("second-instance", (_event, argv) =>
    argv.includes("--quit") ? background.requestQuit() : background.showWindow(),
  );
  if (process.argv.includes("--quit")) app.exit(0); // nada em execução para encerrar
  // Encerramento do sistema (logout/desligamento) não depende da bandeja.
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      background.allowQuit();
      app.quit();
    });
}

function createWindow() {
  const iconPath = path.join(__dirname, "../dist/brand/beagledock-logo.png");

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#f7f5ef",
    // Aberto com o sistema (--hidden) e com a bandeja funcionando, começa só na bandeja.
    show: false,
    title: "BeagleDock - Multi-AI Cockpit",
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      // Minimizada ou na bandeja, a interface continua recebendo o stream sem atraso.
      backgroundThrottling: false,
    },
  });
  background.attachWindow(mainWindow);
  mainWindow.once("ready-to-show", () => {
    if (process.argv.includes("--hidden") && background.trayReady() && !smokeRun) return;
    mainWindow.show();
  });
  // Zoom da interface: atalhos Ctrl +/-/0, persistido nas configurações.
  const applyZoom = (factor) => {
    const value = zoom.clamp(factor);
    mainWindow.webContents.setZoomFactor(value);
    void saveAppSettings({ zoomFactor: value }).catch(() => {});
    return value;
  };
  mainWindow.webContents.on("before-input-event", (event, input) => {
    const next = zoom.zoomForKey(input, mainWindow.webContents.getZoomFactor());
    if (next === null) return;
    event.preventDefault();
    applyZoom(next);
  });
  mainWindow.webContents.once("did-finish-load", () => {
    getAppSettings()
      .then((saved) => {
        if (Number.isFinite(saved?.zoomFactor))
          mainWindow.webContents.setZoomFactor(zoom.clamp(saved.zoomFactor));
      })
      .catch(() => {});
  });
  mainWindow.zoomControl = { apply: applyZoom };
  // Links http(s) abrem no navegador padrão; a janela do app nunca navega nem abre outra janela.
  const openInBrowser = (url) => {
    try {
      electronShell.openExternal(parseExternalUrl(url)).catch(() => {});
    } catch {
      /* endereço não permitido */
    }
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url === mainWindow.webContents.getURL()) return;
    event.preventDefault();
    openInBrowser(url);
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
  if (!gotLock) return; // segunda instância: não abre banco nem janela
  await initDatabase();
  try {
    const dropped = await dropUnreadableCredentials(
      require("electron").safeStorage,
    );
    if (dropped.length) {
      console.warn(
        `[migração] credenciais ilegíveis removidas: ${dropped.join(", ")}`,
      );
      ecosystem.notifyOnce(
        "migration:credentials",
        "cli_update",
        "Recadastre as chaves de API",
        "Chaves de API cadastradas no app precisam ser recadastradas após a renomeação para BeagleDock. As CLIs (Claude Code, Codex e Antigravity) mantêm a própria autenticação.",
      );
    }
  } catch (error) {
    console.warn("[migração] verificação de credenciais falhou:", error.message);
  }
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

  handle("get-app-version", () => app.getVersion());
  handle("get-cli-approvals", () => approvals.list());
  handle("resolve-cli-approval", (_event, id, decision, message) =>
    approvals.resolve(id, decision, { message }),
  );
  handle("set-live-permission", (_event, sessionId, permission) =>
    cliRunner.setPermission({ sessionId, permission }),
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
      if (!workspace || !project)
        return {
          ok: false,
          error: "Workspace e projeto são obrigatórios para ler uma página.",
        };
      try {
        const page = await aiMemoryApi.getPage(workspace, project, pagePath);
        return { ok: true, data: { ...page, workspace, project } };
      } catch (err) {
        if (err && err.status === 404)
          return { ok: false, notFound: true, error: "Página não encontrada." };
        // Fallback para a CLI (servidor HTTP indisponível ou resposta inesperada).
        try {
          aiMemoryApi.validName(workspace, "workspace");
          aiMemoryApi.validName(project, "projeto");
          aiMemoryApi.validPagePath(pagePath);
        } catch (e) {
          return { ok: false, error: e.message };
        }
        return await runAiMemoryJson([
          "read-page",
          "--path",
          pagePath,
          "--json",
          "--workspace",
          workspace,
          "--project",
          project,
        ]);
      }
    },
  );

  const httpCall = async (fn) => {
    try {
      return { ok: true, data: await fn() };
    } catch (err) {
      return { ok: false, status: err.status, error: err.message };
    }
  };
  let projectsCache = { at: 0, list: null };
  const reachableProjects = async () => {
    if (Date.now() - projectsCache.at < 15000) return projectsCache.list;
    let list = null;
    try {
      list = await aiMemoryApi.listProjects({ timeoutMs: 3000 });
    } catch {}
    projectsCache = { at: Date.now(), list };
    return list;
  };
  handle("ai-memory-scope", async (_e, cwd) => {
    const scope = await resolveAiMemoryScope(validCwd(cwd));
    const list = await reachableProjects();
    const found = list?.find(
      (x) => x.workspace === scope.workspace && x.project === scope.project,
    );
    return {
      ...scope,
      serverOnline: !!list,
      projectExists: !!found,
      pages: found ? found.pageCount : null,
    };
  });
  handle("ai-memory-projects", () => httpCall(() => aiMemoryApi.listProjects()));
  handle("ai-memory-project-pages", (_e, ws, p) =>
    httpCall(() => aiMemoryApi.listPages(ws, p)),
  );
  handle("ai-memory-project-overview", (_e, ws, p) =>
    httpCall(() => aiMemoryApi.getOverview(ws, p)),
  );
  handle("ai-memory-project-sessions", (_e, ws, p) =>
    httpCall(() => aiMemoryApi.listSessions(ws, p)),
  );
  handle("ai-memory-delete-page", async (_e, ws, p, pagePath, confirmProtected) => {
    try {
      aiMemoryApi.validName(ws, "workspace");
      aiMemoryApi.validName(p, "projeto");
      aiMemoryApi.validPagePath(pagePath);
    } catch (err) {
      return { ok: false, error: err.message };
    }
    const denied = memoryMaintenance.deleteConfirmationError(
      pagePath,
      confirmProtected,
    );
    if (denied) return { ok: false, error: denied };
    return await runAiMemoryJson(
      ["delete-page", "--path", pagePath, "--workspace", ws, "--project", p],
      undefined,
      120000,
    );
  });
  handle("ai-memory-purge-project", async (_e, ws, p, confirmName) => {
    try {
      aiMemoryApi.validName(ws, "workspace");
      aiMemoryApi.validName(p, "projeto");
    } catch (err) {
      return { ok: false, error: err.message };
    }
    if (!memoryMaintenance.canPurgeProject(ws, p))
      return { ok: false, error: "Este projeto não pode ser excluído." };
    if (confirmName !== `${ws}/${p}`)
      return { ok: false, error: "Confirmação não confere com workspace/projeto." };
    return await runAiMemoryJson(
      ["purge-project", "--workspace", ws, "--project", p, "--confirm"],
      undefined,
      120000,
    );
  });
  handle("ai-memory-maintenance-prompt", (_e, opts) => {
    const { workspace, project, mode, maxDeletions } = opts || {};
    aiMemoryApi.validName(workspace, "workspace");
    aiMemoryApi.validName(project, "projeto");
    return memoryMaintenance.buildMaintenancePrompt({
      workspace,
      project,
      mode: mode === "execute" ? "execute" : "plan",
      maxDeletions,
    });
  });
  handle("ai-memory-maintenance-cwd", () => {
    const dir = path.join(
      process.env.BEAGLEDOCK_DATA_DIR ||
        path.join(os.homedir(), ".beagledock"),
      "maintenance",
    );
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return validCwd(dir);
  });

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
      const saved = await sessionService.saveSession(session);
      if (session?.id)
        sessionInfo.set(session.id, { title: session.title, providerId: session.providerId });
      return saved;
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

      for (const saved of sessions)
        sessionInfo.set(saved.id, { title: saved.title, providerId: saved.providerId });
      background.setRunInBackground(appSettings?.runInBackground !== false);
      savedAutoCompactTokens = appSettings?.autoCompactTokens;
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

  handle("open-in-editor", async (_event, request) => {
    try {
      return await openInEditor({
        cwd: validCwd(request?.cwd),
        target: request?.target,
        line: request?.line,
        column: request?.column,
      });
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  handle("list-native-commands", (_event, request) =>
    nativeCommands.list(String(request?.providerId || ""), validCwd(request?.cwd), {
      refresh: !!request?.refresh,
    }),
  );
  handle("open-external-url", (_event, url) => openExternalUrl(url, electronShell));
  handle("get-zoom", () => mainWindow.webContents.getZoomFactor());
  handle("set-zoom", (_event, factor) => mainWindow.zoomControl.apply(Number(factor)));

  handle("pick-directory", async (_event, options) => {
    try {
      return await pickDirectory({
        dialog,
        window: mainWindow,
        defaultPath: options?.defaultPath,
        title: options?.title,
      });
    } catch (e) {
      return { canceled: true, error: e.message };
    }
  });

  handle("save-workspace", async (_event, ws) => {
    try {
      validCwd(ws.path);
      const enriched = {
        ...ws,
        hasAIMemory: fs.existsSync(path.join(ws.path, ".ai-memory.toml")),
      };
      await saveWorkspace(enriched);
      return enriched;
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Lista do projeto guardada por poucos segundos: o autocomplete consulta a cada tecla.
  const projectFileCache = new Map();
  handle("search-project-files", async (_event, request) => {
    try {
      const cwd = validCwd(request?.cwd);
      let entry = projectFileCache.get(cwd);
      if (!entry || Date.now() - entry.at > 10000) {
        entry = { at: Date.now(), files: await listFiles(cwd) };
        projectFileCache.set(cwd, entry);
      }
      return { success: true, files: searchFiles(entry.files, request?.query) };
    } catch (e) {
      return { success: false, error: e.message, files: [] };
    }
  });

  handle("list-workspace-status", async () => {
    try {
      const counts = await workspaceSessionCounts();
      return {
        success: true,
        workspaces: (await getWorkspaces()).map((ws) => inspectWorkspace(ws, counts)),
      };
    } catch (e) {
      return { success: false, error: e.message, workspaces: [] };
    }
  });

  handle("update-workspace", async (_event, request) => {
    try {
      const edit = validateWorkspaceEdit(request || {}, { validCwd });
      const hasAIMemory = fs.existsSync(path.join(edit.path, ".ai-memory.toml"));
      return {
        success: true,
        workspace: await updateWorkspace(String(request.id), { ...edit, hasAIMemory }),
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  handle("delete-workspace", async (_event, id) => {
    try {
      return await deleteWorkspace(String(id));
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  handle("save-app-settings", async (_event, settingsObj) => {
    try {
      // Iniciar com o sistema mexe em um arquivo do usuário: se falhar, nada é gravado.
      if (Object.hasOwn(settingsObj || {}, "launchAtLogin")) {
        const auto = setAutostart(!!settingsObj.launchAtLogin);
        if (!auto.ok) return { success: false, error: auto.error };
      }
      const result = await saveAppSettings(settingsObj);
      if (Object.hasOwn(settingsObj || {}, "autoCompactTokens"))
        savedAutoCompactTokens = result?.settings?.autoCompactTokens;
      if (Object.hasOwn(settingsObj || {}, "runInBackground"))
        background.setRunInBackground(settingsObj.runInBackground !== false);
      return result;
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

  handle("compact-session", async (_event, id, providerId) => {
    if (typeof id !== "string" || !["claude", "codex", "antigravity"].includes(providerId))
      return { ok: false, error: "Conversa inválida." };
    const result = await cliRunner.compact(id, providerId);
    // A compactação manual acontece fora de turno: grava o contexto resultante.
    if (result.ok && result.context)
      await sessionService.setSessionContext(id, result.context).catch(() => {});
    return { ok: result.ok, error: result.error };
  });

  handle("set-session-archived", async (_event, id, archived) => {
    try {
      if (typeof id !== "string") throw new Error("Conversa inválida.");
      return await sessionService.setSessionArchived(id, archived === true);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  handle("replace-chat-messages", async (_event, id, messages) => {
    try {
      return await sessionService.replaceChatMessages(id, messages);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  handle("interrupt-cli-session", (_event, id) => sessionService.interrupt(id));
  // Mensagem na fila: tira da fila antes de a CLI recebê-la / interrompe a execução atual para ela passar.
  handle("cancel-queued-prompt", (_event, request) => sessionService.cancelQueued(request));
  handle("force-queued-prompt", (_event, request) => sessionService.forceQueued(request));
  handle("execute-cli-prompt", async (_event, payload) =>
    updatingCli
      ? { ok: false, error: "Aguarde a atualização da CLI terminar." }
      : sessionService.execute(payload),
  );

  createWindow();
  background.start();

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

app.on("before-quit", (event) => background.beforeQuit(event));
app.on("window-all-closed", () => {
  for (const [, entry] of activePtySessions.entries()) {
    try {
      entry.proc.kill();
    } catch (e) {}
  }
  if (process.platform !== "darwin") app.quit();
});
