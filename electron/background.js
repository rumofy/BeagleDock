const { t, tn } = require("./i18n");
// Background: closing the window sends the app to the tray and the sessions keep running.
// Only the tray's "Quit" item closes the app (with a confirmation if a session is running).

// Codex reports the protocol method (e.g. item/commandExecution/requestApproval).
function friendlyTool(tool) {
  const name = String(tool || "");
  if (/commandExecution\/requestApproval$/.test(name)) return t("tray.toolCommand");
  if (/fileChange\/requestApproval$/.test(name)) return t("tray.toolFiles");
  if (/permissions\/requestApproval$/.test(name)) return t("tray.toolPermission");
  if (/requestApproval$/.test(name)) return t("tray.toolAction");
  return name || t("tray.toolGeneric");
}

function describeState({ running = 0, waiting = 0, sessions = [] } = {}) {
  const parts = [];
  if (running > 0)
    parts.push(tn("tray.running", running));
  if (waiting > 0)
    parts.push(
      tn("tray.waiting", waiting),
    );
  const status = waiting > 0 ? "waiting" : running > 0 ? "running" : "idle";
  return {
    status,
    summary: parts.length ? parts.join(" · ") : t("tray.idle"),
    tooltip: parts.length ? `BeagleDock · ${parts.join(" · ")}` : "BeagleDock",
    sessions,
  };
}

// State badge in the corner of the tray icon: amber running, red waiting for permission.
// `bitmap` is BGRA (nativeImage's format on Linux); idle has no badge.
const BADGES = { running: [245, 158, 11], waiting: [225, 29, 72] };
function drawBadge(bitmap, size, status) {
  const color = BADGES[status];
  if (!color) return bitmap;
  const out = Buffer.from(bitmap);
  const radius = Math.max(3, Math.round(size * 0.24));
  const cx = size - radius - 1;
  const cy = size - radius - 1;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance > radius + 1) continue;
      const offset = (y * size + x) * 4;
      // 1 px white outline and a colored core, so the badge shows on any panel background.
      const [r, g, b] = distance > radius - 0.5 ? [255, 255, 255] : color;
      out[offset] = b;
      out[offset + 1] = g;
      out[offset + 2] = r;
      out[offset + 3] = 255;
    }
  return out;
}

const SESSION_LIMIT = 8;
// Menu items for the sessions in progress, the one waiting for permission first.
function sessionMenuItems(sessions, open) {
  const ordered = [...sessions].sort((a, b) => Number(!!b.waiting) - Number(!!a.waiting));
  const items = ordered.slice(0, SESSION_LIMIT).map((s) => ({
    label: `${s.waiting ? "⚠ " : "● "}${String(s.title || "Conversa").slice(0, 48)}${s.providerName ? ` · ${s.providerName}` : ""}`,
    click: () => open(s.id),
  }));
  if (ordered.length > SESSION_LIMIT)
    items.push({ label: t("tray.more", { count: ordered.length - SESSION_LIMIT }), enabled: false });
  return items;
}

// Closing never quits the app. Without a working tray (some Linux desktops don't show it),
// it minimizes instead of hiding, so the window doesn't become unreachable.
function closeAction({ quitting, trayReady, runInBackground = true }) {
  if (quitting) return "allow";
  // With the background off, closing the window means asking to quit (with confirmation if a session is running).
  if (!runInBackground) return "quit";
  return trayReady ? "hide" : "minimize";
}

function quitAction({ quitting, running, bypass }) {
  if (quitting || bypass) return "allow";
  return "request";
}

function createBackgroundController({
  app,
  Tray,
  Menu,
  Notification,
  nativeImage,
  powerSaveBlocker,
  dialog,
  getWindow,
  iconPath,
  runningCount,
  approvalsList,
  // Sessions in progress for the menu: [{ id, title, providerName }].
  runningSessions = () => [],
  // Tells the interface to open a conversation (click on the menu or the notification).
  openSession = () => {},
  bypass = false,
  onQuit = () => {},
  intervalMs = 2000,
}) {
  let tray = null;
  let quitting = false;
  let blockerId = null;
  let timer = null;
  let lastKey = "";
  let shutDown = false;
  let runInBackground = true;
  const iconCache = new Map();
  const runShutdown = () => {
    if (shutDown) return;
    shutDown = true;
    onQuit();
  };
  const seenApprovals = new Set();

  const showWindow = () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };
  // Brings the window up and takes the interface to the conversation.
  const showSession = (sessionId) => {
    showWindow();
    if (sessionId) openSession(sessionId);
  };

  // Icon per state, generated from the app icon with the badge; cached so it isn't redrawn.
  function iconFor(status) {
    if (!baseImage) return null;
    if (!iconCache.has(status)) {
      const size = 22;
      const resized = baseImage.resize({ width: size, height: size });
      iconCache.set(
        status,
        BADGES[status]
          ? nativeImage.createFromBitmap(drawBadge(resized.toBitmap(), size, status), { width: size, height: size })
          : resized,
      );
    }
    return iconCache.get(status);
  }
  let baseImage = null;

  function confirmQuit() {
    const running = runningCount();
    if (!running || bypass) return true;
    const win = getWindow();
    const choice = dialog.showMessageBoxSync(
      win && !win.isDestroyed() ? win : undefined,
      {
        type: "warning",
        buttons: [t("tray.keepRunning"), t("tray.quitAndStop")],
        defaultId: 0,
        cancelId: 0,
        title: t("tray.quitTitle"),
        message: tn("tray.quitMessage", running),
        detail:
          t("tray.quitDetail"),
      },
    );
    return choice === 1;
  }
  function requestQuit() {
    if (!confirmQuit()) return;
    quitting = true;
    app.quit();
  }

  function refresh(force = false) {
    const approvals = approvalsList();
    const waitingIds = new Set(approvals.map((a) => a.sessionId));
    const sessions = runningSessions().map((s) => ({ ...s, waiting: waitingIds.has(s.id) }));
    const state = describeState({
      running: runningCount(),
      waiting: approvals.length,
      sessions,
    });
    // While a session is running, the system doesn't suspend the app (the screen may turn off).
    if (state.status !== "idle" && blockerId === null)
      blockerId = powerSaveBlocker.start("prevent-app-suspension");
    if (state.status === "idle" && blockerId !== null) {
      powerSaveBlocker.stop(blockerId);
      blockerId = null;
    }
    const key = `${state.status}|${state.summary}|${sessions.map((s) => `${s.id}:${s.title}:${s.waiting}`).join(",")}`;
    if (!tray || (!force && key === lastKey)) return state;
    lastKey = key;
    tray.setToolTip(state.tooltip);
    const icon = iconFor(state.status);
    if (icon) tray.setImage(icon);
    const items = sessionMenuItems(sessions, showSession);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: t("tray.open"), click: showWindow },
        { type: "separator" },
        { label: state.summary, enabled: false },
        ...items,
        { type: "separator" },
        { label: t("tray.quit"), click: requestQuit },
      ]),
    );
    return state;
  }

  function notifyNewApprovals() {
    const win = getWindow();
    const visible = win && !win.isDestroyed() && win.isVisible() && win.isFocused();
    const current = approvalsList();
    const ids = new Set(current.map((a) => a.id));
    for (const id of [...seenApprovals]) if (!ids.has(id)) seenApprovals.delete(id);
    for (const approval of current) {
      if (seenApprovals.has(approval.id)) continue;
      seenApprovals.add(approval.id);
      if (visible || !Notification.isSupported()) continue;
      const note = new Notification({
        title: t("tray.approvalTitle"),
        body: t("tray.approvalBody", { provider: approval.providerId, tool: friendlyTool(approval.tool) }),
      });
      note.on("click", () => showSession(approval.sessionId));
      note.show();
    }
  }

  return {
    start() {
      try {
        const image = nativeImage.createFromPath(iconPath);
        // Without an image (e.g. dist/ not built) the tray would be invisible: it doesn't count as ready.
        if (image.isEmpty()) throw new Error("tray icon missing");
        baseImage = image;
        tray = new Tray(iconFor("idle"));
        tray.on("click", showWindow);
      } catch {
        tray = null;
      }
      refresh(true);
      timer = setInterval(() => refresh(), intervalMs);
      timer.unref?.();
      return !!tray;
    },
    trayReady: () => !!tray,
    attachWindow(win) {
      win.on("close", (event) => {
        const action = closeAction({ quitting, trayReady: !!tray, runInBackground });
        if (action === "allow") return;
        event.preventDefault();
        if (action === "hide") win.hide();
        else if (action === "quit") requestQuit();
        else win.minimize();
      });
    },
    // before-quit: only goes on if the quit came from the tray (or from the system/test environment).
    // Without a working tray there's no "Quit" to use: the app behaves like a regular app, with
    // confirmation if a session is running.
    beforeQuit(event) {
      if (quitAction({ quitting, bypass }) === "allow") {
        quitting = true;
        runShutdown();
        return;
      }
      if (!tray) {
        if (confirmQuit()) {
          quitting = true;
          runShutdown();
        } else event.preventDefault();
        return;
      }
      event.preventDefault();
      showWindow();
    },
    allowQuit() {
      quitting = true;
    },
    requestQuit,
    isWindowActive() {
      const win = getWindow();
      return !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
    },
    onApprovalsChanged: notifyNewApprovals,
    // Spontaneous CLI reply: notify only if the window isn't in front.
    notifyTurnFinished({ title, body, sessionId }) {
      const win = getWindow();
      const visible = win && !win.isDestroyed() && win.isVisible() && win.isFocused();
      if (visible || !Notification.isSupported()) return;
      const note = new Notification({ title, body });
      note.on("click", () => showSession(sessionId));
      note.show();
    },
    showWindow,
    showSession,
    // "Keep in the tray when closing the window" preference.
    // The interface language changed: rebuild the tray menu and tooltip in the new language.
    refreshMenu() {
      refresh(true);
    },
    setRunInBackground(value) {
      runInBackground = value !== false;
    },
    getRunInBackground: () => runInBackground,
    refresh,
    dispose() {
      clearInterval(timer);
      if (blockerId !== null) powerSaveBlocker.stop(blockerId);
      tray?.destroy();
    },
  };
}

module.exports = {
  createBackgroundController,
  describeState,
  closeAction,
  drawBadge,
  sessionMenuItems,
  quitAction,
  friendlyTool,
};
