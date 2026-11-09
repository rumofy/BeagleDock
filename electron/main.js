const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  Notification,
  powerSaveBlocker,
  dialog,
  shell: electronShell,
} = require("electron");
const path = require("path");
const i18n = require("./i18n");
const fs = require("fs");
const os = require("os");
// One-time migration of old names: must run before opening the database and setting userData.
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
const memoryTempCleanup = require("./memory-temp-cleanup");
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
const { transcribeAudio, findLocalEngine } = require("./transcription");
const { createSpeechModels } = require("./speech-models");
const { inspectWorkspace, validateWorkspaceEdit } = require("./workspace-status");
const nativeCommands = createNativeCommands();
const agyUsage = createAgyUsage();
const providerUsage = createProviderUsage({
  // Each read starts a CLI: with the window hidden or minimized, it queries much less.
  getRefreshMs: () => (background?.isWindowActive() ? 45000 : 10 * 60000),
  onUpdate: () => pushToolsUpdate().catch(() => {}),
});
const codexMcpAuth = createMcpAuthWatcher({
  notify: (...args) => ecosystem.notifyOnce(...args),
});
const { createCliRunner } = require("./cli-runner");
const { createCliTerminals, readTerminalClipboard } = require("./cli-terminal");
const { resolveModelSelection } = require("./model-options");
const { createSessionService } = require("./session-service");
const { createHistory } = require("./history");
const { createTerminalHistory, syncTerminalTurn } = require("./terminal-history");
const { createTerminalHandover } = require("./terminal-handover");
const { createTurnWatcher } = require("./terminal-turns");
const { chatReplyNotice, terminalTurnNotice } = require("./reply-notices");
const { Worker } = require("worker_threads");
const { createRemoteAccess } = require("./remote-access");
const { createRemoteApi } = require("./remote-api");
const { createClientSync, createLiveTurns } = require("./client-sync");
const qrcode = require("qrcode-generator");
const {
  initDatabase,
  saveUserProfile,
  getUserProfile,
  saveSession,
  setSessionArchived,
  setSessionContext,
  mergeMessageEvents,
  deleteSessionFromDb,
  listConversationHistory,
  linkedNativeIds,
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
  getSecret,
  dropUnreadableCredentials,
  getNativeSession,
  lockSessionCwd,
  setNativeSession,
  dbPath,
} = require("./database");

const globalPermissions =
  require("./global-permissions").createGlobalPermissions();
const ecosystem = require("./ecosystem").createEcosystem();
app.setName?.("beagledock");
app.commandLine?.appendSwitch("class", "BeagleDock");
app.setPath?.("userData", path.join(app.getPath("appData"), "beagledock"));
let updatingCli = false;
let mainWindow;
// Phone access over the local network (off until turned on in Settings).
let remoteAccess = null;
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

// 1. Detection 100% from the operating system (no Git)
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
      reject(new Error(i18n.t("errors.localDataTimeout")));
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
      if (!received) reject(new Error(i18n.t("errors.localDataFailed")));
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
  // Quota comes from the CLIs themselves (Claude Code's /usage, Codex's app-server limits);
  // local logs only provide tokens. No reading quotas from logs or per model.
  for (const id of ["claude", "codex"])
    metrics[id] = { ...metrics[id], ...live[id] };
  metrics.antigravity = { ...metrics.antigravity, ...liveAgy };
  lastMetrics = metrics;
  return metrics;
}

// 3. Full integration with the real ai-memory binary (stripping the log line on stdout)
function parseAiMemoryJsonOutput(stdout) {
  if (!stdout) return null;
  const trimmed = stdout.trim();
  // The ai-memory binary prints an INFO line at the start of stdout before the JSON
  const lines = trimmed.split("\n");
  const cleanLines = lines.filter(
    (l) =>
      !l.includes("INFO ai_memory_cli:") && !l.includes("WARN ai_memory_cli:"),
  );
  const candidate = cleanLines.join("\n").trim();
  try {
    return JSON.parse(candidate);
  } catch (e) {
    // Fallback: look for the first '{' or '['
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

// 4. Real system skills
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

// History: BeagleDock conversations (database) first, then each CLI's terminal-only
// conversations, without repeating the ones already linked to a BeagleDock conversation.
async function getCliHistory(query = "") {
  const term = typeof query === "string" ? query.slice(0, 200) : "";
  const [own, linked] = await Promise.all([
    listConversationHistory(term),
    linkedNativeIds(),
  ]);
  const native = await runLocalJob("history", [
    { query: term, exclude: linked },
  ]).catch(() => []);
  const names = { claude: "Claude Code", codex: "Codex CLI", antigravity: "Antigravity" };
  return [
    ...own.map((item) => ({ ...item, providerName: names[item.provider] })),
    ...native,
  ];
}
function killPty(sessionId) {
  const ptyEntry = activePtySessions.get(sessionId);
  if (!ptyEntry) return;
  try {
    ptyEntry.proc?.kill();
  } catch {}
  activePtySessions.delete(sessionId);
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

// 8. Interactive PTY process manager and real prompt runs
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

const liveTurns = createLiveTurns();
function sendToRenderer(channel, payload) {
  // Emission stamp to measure the stream's delay to the screen.
  const stamped =
    channel === "cli-stream-chunk" || channel === "cli-activity-event"
      ? { ...payload, emittedAt: Date.now() }
      : payload;
  liveTurns.observe(channel, payload);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, stamped);
  // Paired phones get only the chat events (the filter lives in remote-access).
  remoteAccess?.broadcast(channel, stamped);
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
// Title and CLI of each conversation, so the tray menu lists the running ones.
const sessionInfo = new Map();
const providerNames = { claude: "Claude Code", codex: "Codex CLI", antigravity: "Antigravity" };
const approvals = require("./approvals").createApprovalBroker({
  emit: (channel, payload) => {
    sendToRenderer(channel, payload);
    if (channel === "cli-approvals") background?.onApprovalsChanged();
  },
});
// Automatic compaction limit (user setting), kept in memory for each turn.
let savedAutoCompactTokens;
getAppSettings()
  .then((saved) => {
    if (saved && savedAutoCompactTokens === undefined) savedAutoCompactTokens = saved.autoCompactTokens;
    i18n.setLocale(saved?.language);
  })
  .catch(() => {});
const { plainText } = require("./message-segments");
const cliRunner = createCliRunner({
  approvals,
  getAutoCompactTokens: () => savedAutoCompactTokens,
  onMcpAuthError: (line) => codexMcpAuth.inspect(line),
  // Background agents update the timeline after the turn: save it to the history.
  onLateEvents: (payload) => sessionService.saveLateEvents(payload),
  onAutoTurn: (payload) => {
    void sessionService.saveAutoTurn(payload);
    if (payload.discard) return;
    const names = { claude: "Claude Code", codex: "Codex CLI", antigravity: "Antigravity" };
    background.notifyTurnFinished({
      sessionId: payload.sessionId,
      title: i18n.t("notices.replied", { name: names[payload.providerId] || payload.providerId }),
      body: plainText(String(payload.ok ? payload.text : payload.error || i18n.t("session.runFailed")))
        .replace(/\s+/g, " ")
        .slice(0, 140),
    });
  },
  globalFingerprint: globalPermissions.fingerprint,
  getClaudePermissionMode: () => globalPermissions.get("claude").fields.find((f) => f.key === "mode")?.value || "default",
  resolveSelection: ({ providerId, model, effort }) =>
    resolveModelSelection(
      catalogs.localCatalogs()[providerId]?.modelOptions || [],
      model,
      effort,
    ),
  store: { getNativeSession, setNativeSession, getSessionPermission: require("./database").getSessionPermission },
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
// Terminal mode: the end of each reply (from the CLI's screen) saves the native conversation's history and
// notifies when the window is out of focus, as in the chat.
const terminalHistory = createTerminalHistory({
  readConversation: (providerId, nativeId, cwd) =>
    runLocalJob("conversation", [providerId, nativeId, { cwd }]),
  listNative: ({ exclude }) => runLocalJob("history", [{ query: "", exclude }]),
  linkedIds: linkedNativeIds,
  store: { setNativeSession, saveChatMessage, sessionExists },
  emit: sendToRenderer,
});
const terminalWatchers = new Map();
// End-of-turn history syncs still retrying (the CLI may save its reply after going idle), per conversation.
const terminalTurnSyncs = new Map();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function terminalTurnEnded(sessionId, providerId) {
  const watcher = terminalWatchers.get(sessionId);
  const revision = watcher?.getState().revision;
  const isCurrent = () => terminalWatchers.get(sessionId) === watcher && watcher?.getState().revision === revision;
  // Native history may be saved after the idle signal; retry without letting an old turn consume a new reply.
  const turnSync = syncTerminalTurn({ sessionId, history: terminalHistory, isCurrent, wait });
  terminalTurnSyncs.set(sessionId, turnSync);
  void turnSync.finally(() => {
    if (terminalTurnSyncs.get(sessionId) === turnSync) terminalTurnSyncs.delete(sessionId);
  }).catch(() => {});
  void turnSync.then((result) => {
    // A new turn or a reopened terminal must not inherit the previous turn's waiting state.
    if (!result || !isCurrent()) return;
    if (!result?.lastReply) watcher?.waitingForInput();
    background.notifyTurnFinished({ sessionId, ...terminalTurnNotice(providerId, result?.lastReply) });
  }).catch(() => {});
}
// Before a chat turn (always the case on the phone), a conversation open in the CLI's terminal is
// handed over: see electron/terminal-handover.js.
const terminalHandover = createTerminalHandover({
  isOpen: (sessionId) => cliTerminals.isOpen(sessionId),
  status: (sessionId) => terminalWatchers.get(sessionId)?.getState().status,
  pendingSync: (sessionId) => terminalTurnSyncs.get(sessionId),
  close: (sessionId) => cliTerminals.close(sessionId),
  endHistory: (sessionId) => terminalHistory.end(sessionId),
  notifyClosed: (sessionId) => sendToRenderer("cli-terminal-exit", { sessionId, exitCode: null }),
  busyError: () => i18n.t("errors.terminalBusy"),
});
function notifyChatReply(payload, result) {
  const notice = chatReplyNotice(payload?.providerId, result);
  if (notice) background.notifyTurnFinished({ sessionId: payload.sessionId, ...notice });
}
function stopWatchingTerminal(sessionId) {
  terminalWatchers.get(sessionId)?.dispose();
  terminalWatchers.delete(sessionId);
  sendToRenderer("cli-terminal-state", { sessionId, status: "idle" });
  background?.refreshMenu();
  if (terminalHistory.has(sessionId)) void terminalHistory.end(sessionId);
}
const cliTerminals = createCliTerminals({
  hooks: {
    opened: ({ sessionId, providerId, cwd, nativeId, newNativeId }) => {
      terminalWatchers.get(sessionId)?.dispose();
      terminalWatchers.set(
        sessionId,
        createTurnWatcher({
          providerId,
          onTurnEnd: () => terminalTurnEnded(sessionId, providerId),
          onStateChange: ({ status }) => {
            sendToRenderer("cli-terminal-state", { sessionId, status });
            background?.refreshMenu();
          },
        }),
      );
      void terminalHistory.begin({ sessionId, providerId, cwd, nativeId, newNativeId });
    },
    input: (sessionId, data) => terminalWatchers.get(sessionId)?.input(data),
    output: (sessionId, data) => terminalWatchers.get(sessionId)?.output(data),
    exited: stopWatchingTerminal,
    closed: stopWatchingTerminal,
  },
  pty: ptyModule,
  find: findBinary,
  env: cliEnv,
  checkCwd: validCwd,
  store: { getNativeSession, lockSessionCwd },
  beforeOpen: async (sessionId) => {
    if (updatingCli) throw new Error(i18n.t("errors.waitCliUpdate"));
    if (sessionService.activeIds().includes(sessionId))
      throw new Error(i18n.t("errors.waitReplyBeforeTerminal"));
    // The chat process stays alive between turns: stop it so only the terminal uses the conversation.
    cliRunner.kill(sessionId);
  },
  emit: sendToRenderer,
});
function shutdown() {
  void remoteAccess?.stop();
  clearInterval(refreshTimer);
  clearInterval(modelTimer);
  cliTerminals.closeAll();
  cliRunner.shutdown();
  for (const worker of localWorkers) worker.terminate();
  for (const [, entry] of activePtySessions) {
    try {
      entry.proc.kill();
    } catch {}
  }
  activePtySessions.clear();
  // Tray, power blocker and pop-ups still on screen (a critical one would outlive the app).
  background?.dispose();
}
module.exports = { shutdown };

// Test environment: no tray, confirmation or single instance.
const smokeRun = !!process.env.BEAGLEDOCK_SMOKE_ROOT;
background = createBackgroundController({
  app,
  Tray,
  Menu,
  nativeImage,
  Notification,
  powerSaveBlocker,
  dialog,
  getWindow: () => mainWindow,
  iconPath: path.join(__dirname, "../dist/brand/beagledock-logo.png"),
  // Turns running or queued in any session.
  runningCount: () => Math.max(cliRunner.busyCount(), sessionService.activeCount()) +
    [...terminalWatchers.values()].filter((w) => w.getState().status === "running").length,
  approvalsList: () => approvals.list(),
  runningSessions: () =>
    [...new Set([...sessionService.activeIds(), ...[...terminalWatchers].filter(([, w]) => w.getState().status !== "idle").map(([id]) => id)])].map((id) => ({
      id,
      title: sessionInfo.get(id)?.title,
      providerName: providerNames[sessionInfo.get(id)?.providerId],
      waiting: terminalWatchers.get(id)?.getState().status === "waiting_input",
    })),
  // The interface takes the chat to the conversation (click on the tray menu or the notification).
  openSession: (sessionId) => sendToRenderer("open-session", { sessionId }),
  bypass: smokeRun,
  onQuit: shutdown,
});
// Single instance: opening again only brings the window back; `beagledock --quit` asks the running
// instance to quit (with the same confirmation as the tray), useful without a visible tray.
const gotLock = smokeRun || app.requestSingleInstanceLock();
if (!gotLock) app.exit(0);
else if (!smokeRun) {
  app.on("second-instance", (_event, argv) =>
    argv.includes("--quit") ? background.requestQuit() : background.showWindow(),
  );
  if (process.argv.includes("--quit")) app.exit(0); // nothing running to quit
  // System shutdown (logout/power off) doesn't depend on the tray.
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
    // Opened with the system (--hidden) and with a working tray, it starts only in the tray.
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
      // Minimized or in the tray, the interface keeps getting the stream without delay.
      backgroundThrottling: false,
    },
  });
  background.attachWindow(mainWindow);
  mainWindow.once("ready-to-show", () => {
    if (process.argv.includes("--hidden") && background.trayReady() && !smokeRun) return;
    mainWindow.show();
  });
  // Interface zoom: Ctrl +/-/0 shortcuts, persisted in the settings.
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
  // http(s) links open in the default browser; the app window never navigates or opens another window.
  const openInBrowser = (url) => {
    try {
      electronShell.openExternal(parseExternalUrl(url)).catch(() => {});
    } catch {
      /* address not allowed */
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
  if (!gotLock) return; // second instance: doesn't open the database or a window
  await initDatabase();
  try {
    const dropped = await dropUnreadableCredentials(
      require("electron").safeStorage,
    );
    if (dropped.length) {
      console.warn(
        `[migration] unreadable credentials removed: ${dropped.join(", ")}`,
      );
      ecosystem.notifyOnce(
        "migration:credentials",
        "cli_update",
        i18n.t("migration.reenterKeysTitle"),
        i18n.t("migration.reenterKeysBody"),
      );
    }
  } catch (error) {
    console.warn("[migration] credential check failed:", error.message);
  }
  const registerHandler = ipcMain.handle.bind(ipcMain);
  // Every screen (this window and paired phones) runs the same handlers; what one of them changes
  // in a conversation is passed on to the others.
  const handlers = new Map();
  const emitOthers = (origin, channel, payload) => {
    if (origin !== "desktop" && mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send(channel, payload);
    remoteAccess?.broadcast(channel, payload, { except: origin });
  };
  const clientSync = createClientSync({
    emitOthers,
    activeIds: () => sessionService.activeIds(),
    liveTurns,
  });
  const handle = (channel, handler) => {
    handlers.set(channel, handler);
    registerHandler(channel, (event, ...args) => {
      if (!mainWindow || event.sender !== mainWindow.webContents)
        throw new Error("Invalid IPC sender.");
      if (
        event.senderFrame &&
        event.senderFrame !== mainWindow.webContents.mainFrame
      )
        throw new Error("Invalid IPC frame.");
      return clientSync.run("desktop", channel, args, () => handler(event, ...args));
    });
  };

  // IPC: tools, model catalogs and real quotas (OAuth + token count)
  handle("detect-tools", async () => {
    return pushToolsUpdate();
  });

  handle("get-app-version", () => app.getVersion());
  handle("get-cli-approvals", () => approvals.list());
  handle("resolve-cli-approval", (_event, id, decision, message, answers) =>
    approvals.resolve(id, decision, { message, answers }),
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
      throw new Error(i18n.t("ecosystem.invalidCli"));
    if (activePtySessions.size || sessionService.isBusy() || cliTerminals.list().some((t) => !t.exited))
      throw new Error(
        i18n.t("errors.waitRunsBeforeUpdate"),
      );
    if (updatingCli) throw new Error(i18n.t("ecosystem.updateRunning"));
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
  // IPC: real ai-memory status and commands
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
          error: i18n.t("errors.pageScopeRequired"),
        };
      try {
        const page = await aiMemoryApi.getPage(workspace, project, pagePath);
        return { ok: true, data: { ...page, workspace, project } };
      } catch (err) {
        if (err && err.status === 404)
          return { ok: false, notFound: true, error: i18n.t("memoryErrors.pageNotFound") };
        // Fallback to the CLI (HTTP server unavailable or unexpected response).
        try {
          aiMemoryApi.validName(workspace, "workspace");
          aiMemoryApi.validName(project, "project");
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
  const purgeProject = (ws, p) =>
    runAiMemoryJson(
      ["purge-project", "--workspace", ws, "--project", p, "--confirm"],
      undefined,
      120000,
    );
  const tempCleanup = memoryTempCleanup.createTempCleanup({
    api: aiMemoryApi,
    getDays: async () => (await getAppSettings())?.aiMemoryTempCleanupDays,
    purge: (ws, p) => {
      if (!memoryMaintenance.canPurgeProject(ws, p))
        return { ok: false, error: i18n.t("errors.projectNotDeletable") };
      return purgeProject(ws, p);
    },
    log: (msg) => console.log(msg),
  });
  tempCleanup.start();
  handle("ai-memory-temp-cleanup-preview", async () => {
    try {
      return { ok: true, ...(await tempCleanup.preview()) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("ai-memory-temp-cleanup-run", async (_e, opts) => {
    try {
      const result = await tempCleanup.run({ all: opts?.all === true });
      projectsCache = { at: 0, list: null };
      return result;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("ai-memory-temp-cleanup-set-days", async (_e, value) => {
    const days = memoryTempCleanup.normalizeDays(value);
    const result = await saveAppSettings({ aiMemoryTempCleanupDays: days });
    if (!result?.success) return { ok: false, error: i18n.t("errors.configSaveFailed") };
    return { ok: true, days };
  });
  handle("ai-memory-delete-page", async (_e, ws, p, pagePath, confirmProtected) => {
    try {
      aiMemoryApi.validName(ws, "workspace");
      aiMemoryApi.validName(p, "project");
      aiMemoryApi.validPagePath(pagePath);
    } catch (err) {
      return { ok: false, error: err.message };
    }
    const denied = memoryMaintenance.deleteConfirmationError(
      pagePath,
      confirmProtected,
    );
    if (denied) return { ok: false, error: i18n.t("errors.protectedPage") };
    return await runAiMemoryJson(
      ["delete-page", "--path", pagePath, "--workspace", ws, "--project", p],
      undefined,
      120000,
    );
  });
  handle("ai-memory-purge-project", async (_e, ws, p, confirmName) => {
    try {
      aiMemoryApi.validName(ws, "workspace");
      aiMemoryApi.validName(p, "project");
    } catch (err) {
      return { ok: false, error: err.message };
    }
    if (!memoryMaintenance.canPurgeProject(ws, p))
      return { ok: false, error: i18n.t("errors.projectNotDeletable") };
    if (confirmName !== `${ws}/${p}`)
      return { ok: false, error: i18n.t("errors.purgeConfirmMismatch") };
    return await purgeProject(ws, p);
  });
  handle("ai-memory-maintenance-prompt", (_e, opts) => {
    const { workspace, project, mode, maxDeletions } = opts || {};
    aiMemoryApi.validName(workspace, "workspace");
    aiMemoryApi.validName(project, "project");
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
      return { ok: false, error: i18n.t("errors.commandNotAllowed") };
    return await runAiMemoryJson(subcmdArgs, validCwd(cwd));
  });

  // IPC: skills and history
  handle("get-skills", async () => {
    return getInstalledSkills();
  });

  handle("get-history", async (_event, query) => {
    return getCliHistory(query);
  });

  // Delete permanently: the BeagleDock conversation (messages and attachments) and the CLI's native conversation.
  handle("delete-conversation", async (_event, request) => {
    try {
      const { provider, beagleSessionId, nativeId } = request || {};
      if (!["claude", "codex", "antigravity"].includes(provider))
        throw new Error(i18n.t("errors.invalidProvider"));
      if (beagleSessionId !== undefined && typeof beagleSessionId !== "string")
        throw new Error(i18n.t("errors.invalidConversation"));
      let native = typeof nativeId === "string" ? nativeId : undefined;
      if (beagleSessionId) {
        const saved = (await getSavedSessions()).find((s) => s.id === beagleSessionId);
        if (!saved) throw new Error(i18n.t("session.missing"));
        if (saved.providerId !== provider) throw new Error(i18n.t("errors.providerMismatch"));
        // The native ID comes from the saved link, never from the request.
        native = saved.nativeSessionId;
        killPty(beagleSessionId);
        cliTerminals.close(beagleSessionId);
        await sessionService.remove(beagleSessionId);
      }
      const removedFiles = native ? createHistory().remove(provider, native) : [];
      return { success: true, removedFiles: removedFiles.length };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  handle("load-full-conversation", async (_event, provider, sessionId) => {
    try {
      return await loadFullConversation(provider, sessionId);
    } catch (e) {
      return { error: e.message };
    }
  });

  // IPC: OS identity + SQLite profile
  handle("get-user-profile", async () => {
    try {
      const detected = detectUserIdentity();
      await saveUserProfile(detected);
      return detected;
    } catch (e) {
      return detectUserIdentity();
    }
  });

  // IPC: sessions and messages in SQLite
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
      killPty(sessionId);
      cliTerminals.close(sessionId);
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
      background.setPopups(appSettings?.desktopNotifications !== false);
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

  // Project list kept for a few seconds: the autocomplete queries on every keystroke.
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
      // Starting with the system touches a user file: if it fails, nothing is saved.
      if (Object.hasOwn(settingsObj || {}, "launchAtLogin")) {
        const auto = setAutostart(!!settingsObj.launchAtLogin);
        if (!auto.ok) return { success: false, error: auto.error };
      }
      const result = await saveAppSettings(settingsObj);
      if (Object.hasOwn(settingsObj || {}, "language")) {
        i18n.setLocale(result?.settings?.language);
        background?.refreshMenu?.();
      }
      if (Object.hasOwn(settingsObj || {}, "autoCompactTokens"))
        savedAutoCompactTokens = result?.settings?.autoCompactTokens;
      if (Object.hasOwn(settingsObj || {}, "runInBackground"))
        background.setRunInBackground(settingsObj.runInBackground !== false);
      if (Object.hasOwn(settingsObj || {}, "desktopNotifications"))
        background.setPopups(settingsObj.desktopNotifications !== false);
      return result;
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Voice dictation: the renderer records the microphone and sends the WAV; model and key stay here.
  const speechModels = createSpeechModels({
    dir: path.join(
      process.env.BEAGLEDOCK_DATA_DIR || path.join(os.homedir(), ".beagledock"),
      "models",
    ),
    onProgress: (progress) => sendToRenderer("dictation-model-progress", progress),
  });
  handle("transcribe-audio", async (_event, request) => {
    try {
      const result = await transcribeAudio(request, {
        getSettings: getAppSettings,
        getSecret,
        models: speechModels,
      });
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message, code: e.code };
    }
  });
  handle("dictation-status", async () => {
    const settings = await getAppSettings();
    return {
      engine: settings?.voiceDictation?.engine === "api" ? "api" : "local",
      model: speechModels.status(),
      engineAvailable: !!findLocalEngine(),
    };
  });
  handle("download-dictation-model", async () => {
    try {
      await speechModels.download();
      return { success: true, model: speechModels.status() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  handle("cancel-dictation-model-download", async () => speechModels.cancel());
  handle("remove-dictation-model", async () => {
    try {
      speechModels.remove();
      return { success: true, model: speechModels.status() };
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

  // Replies in progress, for a screen that opened or reconnected after they started.
  handle("get-live-turns", async () => clientSync.liveTurns());
  // A phone that lost the answer to its own prompt (left the app midway) asks for it again.
  handle("await-turn-result", (_event, responseMessageId) =>
    typeof responseMessageId === "string" ? clientSync.awaitTurn(responseMessageId) : null,
  );
  handle("get-chat-messages", async (_event, sessionId) => {
    try {
      return await getChatMessages(sessionId);
    } catch (e) {
      return [];
    }
  });

  // IPC: PTY and real prompt runs
  handle("pty-spawn", async (_event, { sessionId, cwd, providerId }) => {
    if (updatingCli) throw new Error(i18n.t("errors.waitCliUpdate"));
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
      return { ok: false, error: i18n.t("errors.invalidConversation") };
    const result = await cliRunner.compact(id, providerId);
    // Manual compaction happens outside a turn: save the resulting context.
    if (result.ok && result.context)
      await sessionService.setSessionContext(id, result.context).catch(() => {});
    return { ok: result.ok, error: result.error };
  });

  handle("set-session-archived", async (_event, id, archived) => {
    try {
      if (typeof id !== "string") throw new Error(i18n.t("errors.invalidConversation"));
      // Closing stops the CLI process; the conversation stays in the history.
      const result = await sessionService.setSessionArchived(id, archived === true);
      if (archived === true && result.success) {
        killPty(id);
        cliTerminals.close(id);
      }
      return result;
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
  // Queued message: take it off the queue before the CLI gets it / interrupt the current run so it goes through.
  handle("cancel-queued-prompt", (_event, request) => sessionService.cancelQueued(request));
  handle("force-queued-prompt", (_event, request) => sessionService.forceQueued(request));
  handle("answer-now-prompt", (_event, request) => sessionService.answerNow(request));
  handle("execute-cli-prompt", async (_event, payload) => {
    if (updatingCli) return { ok: false, error: i18n.t("errors.waitCliUpdate") };
    const handover = await terminalHandover.handOver(payload?.sessionId);
    if (!handover.ok) return handover;
    const result = await sessionService.execute(payload);
    notifyChatReply(payload, result);
    return result;
  });
  // Terminal mode: each CLI's own interface, resuming the native conversation.
  handle("cli-terminal-open", (_event, request) => cliTerminals.open(request));
  handle("cli-terminal-write", (_event, request) => cliTerminals.write(request));
  handle("cli-terminal-resize", (_event, request) => cliTerminals.resize(request));
  handle("cli-terminal-close", (_event, sessionId) => cliTerminals.close(sessionId));
  handle("cli-terminal-list", () => cliTerminals.list().map((item) => ({
    ...item, status: terminalWatchers.get(item.sessionId)?.getState().status || "idle",
  })));
  handle("cli-terminal-clipboard", () => readTerminalClipboard(require("electron").clipboard));

  // Conversations only (no messages): what another screen reloads after a change.
  handle("get-sessions", () => getSavedSessions());
  // Phone access: a paired phone calls the same handlers as this window, from an allowlist.
  const remoteApi = createRemoteApi({
    invoke: (channel, args, deviceId) =>
      clientSync.run(deviceId, channel, args, () =>
        handlers.get(channel)({ sender: null, remoteDevice: deviceId }, ...args),
      ),
    getWorkspaces,
    getSessions: getSavedSessions,
    messages: i18n.t,
  });
  remoteAccess = createRemoteAccess({
    dir: path.dirname(dbPath),
    api: remoteApi,
    staticDir: path.join(__dirname, "../dist"),
    storage: require("electron").safeStorage,
    messages: i18n.t,
    onChange: (status) => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send("remote-access-status", status);
    },
  });
  handle("remote-access-status", () => remoteAccess.status());
  handle("remote-access-set-enabled", (_event, enabled) => remoteAccess.setEnabled(enabled === true));
  handle("remote-access-set-port", (_event, port) => remoteAccess.setPort(port));
  handle("remote-access-start-pairing", () => {
    const pairing = remoteAccess.startPairing();
    const qr = qrcode(0, "M");
    qr.addData(pairing.url);
    qr.make();
    return { ...pairing, qrDataUrl: qr.createDataURL(6, 2) };
  });
  handle("remote-access-cancel-pairing", () => remoteAccess.cancelPairing());
  handle("remote-access-revoke", (_event, id) => remoteAccess.revokeDevice(String(id || "")));

  createWindow();
  background.start();
  void remoteAccess.start();

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
