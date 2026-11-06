const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createBackgroundController,
  describeState,
  closeAction,
  drawBadge,
  sessionMenuItems,
  quitAction,
  friendlyTool,
} = require("../electron/background");

test("the tray state sums up running sessions and pending approvals", () => {
  assert.deepEqual(describeState(), {
    status: "idle",
    summary: "No session running",
    tooltip: "BeagleDock",
    sessions: [],
  });
  assert.equal(describeState({ running: 1 }).summary, "1 session running");
  assert.equal(describeState({ running: 3 }).summary, "3 sessions running");
  const waiting = describeState({ running: 2, waiting: 1 });
  assert.equal(waiting.status, "waiting");
  assert.equal(waiting.tooltip, "BeagleDock · 2 sessions running · 1 waiting for permission");
});

test("closing the window never quits the app; without a working tray it minimizes", () => {
  assert.equal(closeAction({ quitting: false, trayReady: true }), "hide");
  assert.equal(closeAction({ quitting: false, trayReady: false }), "minimize");
  assert.equal(closeAction({ quitting: true, trayReady: true }), "allow");
  assert.equal(quitAction({ quitting: false, bypass: false }), "request");
  assert.equal(quitAction({ quitting: true, bypass: false }), "allow");
  assert.equal(quitAction({ quitting: false, bypass: true }), "allow");
});

function harness({ emptyIcon = false, running = 0, approvals = [], confirmChoice = 1, bypass = false, trayFails = false, focused = false } = {}) {
  const state = { running, approvals, quitCalls: 0, hidden: 0, minimized: 0, shown: 0, notes: [], blocker: { started: 0, stopped: 0 }, tooltip: "", menu: null, dialogs: 0, images: [], opened: [], clicks: [] };
  class Tray {
    constructor() {
      if (trayFails) throw new Error("no tray");
      state.tray = this;
    }
    on() {}
    setToolTip(t) { state.tooltip = t; }
    setContextMenu(m) { state.menu = m; }
    setImage(image) { state.images.push(image); }
    destroy() {}
  }
  const win = {
    handlers: {},
    isDestroyed: () => false,
    isMinimized: () => false,
    isVisible: () => true,
    isFocused: () => focused,
    restore() {},
    show() { state.shown++; },
    focus() {},
    hide() { state.hidden++; },
    minimize() { state.minimized++; },
    on(name, cb) { this.handlers[name] = cb; },
  };
  const controller = createBackgroundController({
    app: { quit: () => state.quitCalls++ },
    Tray,
    Menu: { buildFromTemplate: (t) => t },
    nativeImage: {
      createFromPath: () => ({
        isEmpty: () => emptyIcon,
        resize: ({ width }) => ({ isEmpty: () => false, plain: true, toBitmap: () => Buffer.alloc(width * width * 4, 7) }),
      }),
      createFromBitmap: (bitmap, { width }) => ({ isEmpty: () => false, bitmap, width }),
    },
    powerSaveBlocker: {
      start: () => (state.blocker.started++, 7),
      stop: () => state.blocker.stopped++,
    },
    dialog: { showMessageBoxSync: () => (state.dialogs++, confirmChoice) },
    getWindow: () => win,
    iconPath: "x.png",
    runningCount: () => state.running,
    approvalsList: () => state.approvals,
    runningSessions: () => state.sessions || [],
    openSession: (id) => state.opened.push(id),
    bypass,
    onQuit: () => {
      state.shutdown = true;
      state.shutdownCalls = (state.shutdownCalls || 0) + 1;
    },
  });
  return { controller, state, win };
}
const close = (win) => {
  let prevented = false;
  win.handlers.close({ preventDefault: () => (prevented = true) });
  return prevented;
};

test("closing the window hides it in the tray and keeps the sessions", () => {
  const { controller, state, win } = harness({ running: 2 });
  assert.equal(controller.start(), true);
  controller.attachWindow(win);
  assert.equal(close(win), true);
  assert.equal(state.hidden, 1);
  assert.equal(state.quitCalls, 0);
  assert.equal(state.shutdown, undefined, "no CLI was stopped");
});

test("without an available tray the window is minimized, not hidden", () => {
  const { controller, state, win } = harness({ trayFails: true });
  assert.equal(controller.start(), false);
  controller.attachWindow(win);
  assert.equal(close(win), true);
  assert.equal(state.minimized, 1);
  assert.equal(state.hidden, 0);
});

test("system quit shortcuts are blocked; only the tray quits", () => {
  const { controller, state, win } = harness({ running: 1 });
  controller.start();
  controller.attachWindow(win);
  let prevented = false;
  controller.beforeQuit({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, true, "Ctrl+Q doesn't quit");
  assert.equal(state.shutdown, undefined);
  assert.ok(state.shown >= 1, "brings the window back");
});

test("Quit in the tray asks for confirmation with a running session and honors a refusal", () => {
  const declined = harness({ running: 2, confirmChoice: 0 });
  declined.controller.start();
  declined.state.menu.find((i) => i.label === "Quit").click();
  assert.equal(declined.state.dialogs, 1);
  assert.equal(declined.state.quitCalls, 0);

  const accepted = harness({ running: 2, confirmChoice: 1 });
  accepted.controller.start();
  accepted.controller.attachWindow(accepted.win);
  accepted.state.menu.find((i) => i.label === "Quit").click();
  assert.equal(accepted.state.quitCalls, 1);
  // Already authorized by the tray: the window and before-quit let it through.
  assert.equal(close(accepted.win), false);
  let prevented = false;
  accepted.controller.beforeQuit({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, false);
  assert.equal(accepted.state.shutdown, true);
});

test("Quit without a running session asks nothing", () => {
  const { controller, state } = harness({ running: 0 });
  controller.start();
  state.menu.find((i) => i.label === "Quit").click();
  assert.equal(state.dialogs, 0);
  assert.equal(state.quitCalls, 1);
});

test("the system doesn't suspend the app while a session is running", () => {
  const { controller, state } = harness({ running: 1 });
  controller.start();
  controller.refresh();
  assert.equal(state.blocker.started, 1, "a single blocker, not duplicated");
  state.running = 0;
  controller.refresh();
  assert.equal(state.blocker.stopped, 1);
  assert.match(state.tooltip, /^BeagleDock$/);
});

test("a pending permission is listed in the tray menu once and flags the window", () => {
  const { controller, state, win } = harness({ approvals: [{ id: "a1", sessionId: "s1", providerId: "codex", tool: "Bash" }], focused: false });
  const flashes = [];
  win.flashFrame = (on) => flashes.push(on);
  state.sessions = [{ id: "s1", title: "Fix build" }];
  controller.start();
  controller.onApprovalsChanged();
  controller.onApprovalsChanged();
  assert.deepEqual(flashes, [true], "flags the window a single time");
  const item = state.menu.find((i) => i.label?.startsWith("⚠"));
  assert.match(item.label, /Fix build · codex wants: Bash/);
  item.click();
  assert.deepEqual(state.opened, ["s1"]);
  assert.equal(state.images.at(-1).width, 22, "red badge icon is drawn");
});

test("a window in front is not flagged for a permission", () => {
  const { controller, win } = harness({ approvals: [{ id: "a1", sessionId: "s1", providerId: "codex", tool: "Bash" }], focused: true });
  const flashes = [];
  win.flashFrame = (on) => flashes.push(on);
  controller.start();
  controller.onApprovalsChanged();
  assert.deepEqual(flashes, []);
});

test("a reply with the window out of focus waits in the tray until it is opened or cleared", () => {
  const { controller, state, win } = harness({ focused: false });
  controller.start();
  controller.attachWindow(win);
  controller.notifyTurnFinished({ sessionId: "s1", title: "Claude Code replied", body: "All done" });
  controller.notifyTurnFinished({ sessionId: "s2", title: "Codex CLI replied", body: "Fixed" });
  assert.match(state.tooltip, /2 unread replies/);
  const items = state.menu.filter((i) => i.label?.startsWith("✉"));
  assert.equal(items.length, 2);
  items.find((i) => /Claude Code/.test(i.label)).click();
  assert.deepEqual(state.opened, ["s1"]);
  assert.match(state.tooltip, /1 unread reply/);
  state.menu.find((i) => i.label === "Clear notifications").click();
  assert.equal(state.tooltip, "BeagleDock");
  assert.equal(state.menu.some((i) => i.label?.startsWith("✉")), false);
});

test("a reply is not queued when the window is in front, and focusing clears the queue", () => {
  const front = harness({ focused: true });
  front.controller.start();
  front.controller.notifyTurnFinished({ sessionId: "s1", title: "T", body: "B" });
  assert.equal(front.state.tooltip, "BeagleDock");

  const back = harness({ focused: false });
  back.controller.start();
  back.controller.attachWindow(back.win);
  back.controller.notifyTurnFinished({ sessionId: "s1", title: "T", body: "B" });
  back.win.handlers.focus();
  assert.equal(back.state.tooltip, "BeagleDock");
});

test("the test environment (bypass) lets the app quit normally", () => {
  const { controller, state, win } = harness({ running: 3, bypass: true });
  controller.start();
  controller.attachWindow(win);
  let prevented = false;
  controller.beforeQuit({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, false);
  assert.equal(close(win), false, "the window closes during the quit");
  assert.equal(state.shutdown, true);
});

test("a missing icon counts as an unavailable tray and the app becomes a regular app", () => {
  const { controller, state, win } = harness({ emptyIcon: true, running: 2, confirmChoice: 0 });
  assert.equal(controller.start(), false);
  controller.attachWindow(win);
  assert.equal(close(win), true);
  assert.equal(state.minimized, 1, "fechar minimiza");
  // Without a tray there's no "Quit": Ctrl+Q works, but with a confirmation because a session is running.
  let prevented = false;
  controller.beforeQuit({ preventDefault: () => (prevented = true) });
  assert.equal(state.dialogs, 1);
  assert.equal(prevented, true, "recusou: continua rodando");
  assert.equal(state.shutdown, undefined);
});

test("without a tray and without a running session, quitting is immediate", () => {
  const { controller, state } = harness({ emptyIcon: true, running: 0 });
  controller.start();
  let prevented = false;
  controller.beforeQuit({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, false);
  assert.equal(state.shutdown, true);
  assert.equal(state.dialogs, 0);
});

test("stopping the CLIs runs only once, even with several before-quit", () => {
  const { controller, state } = harness({ running: 0, bypass: true });
  controller.start();
  controller.beforeQuit({ preventDefault() {} });
  controller.beforeQuit({ preventDefault() {} });
  controller.allowQuit();
  controller.beforeQuit({ preventDefault() {} });
  assert.equal(state.shutdownCalls, 1);
});

test("friendly action name in Codex notifications", () => {
  assert.equal(friendlyTool("item/commandExecution/requestApproval"), "run a command");
  assert.equal(friendlyTool("item/fileChange/requestApproval"), "edit files");
  assert.equal(friendlyTool("item/permissions/requestApproval"), "an additional permission");
  assert.equal(friendlyTool("item/outra/requestApproval"), "an action");
  assert.equal(friendlyTool("Bash"), "Bash");
  const h = harness({ approvals: [{ id: "x", providerId: "codex", tool: "item/commandExecution/requestApproval" }], focused: false });
  h.controller.start();
  h.controller.onApprovalsChanged();
  assert.match(h.state.menu.find((i) => i.label?.startsWith("⚠")).label, /codex wants: run a command/);
});

test("active window = visible and not minimized", () => {
  const { controller, win } = harness();
  controller.start();
  assert.equal(controller.isWindowActive(), true);
  win.isMinimized = () => true;
  assert.equal(controller.isWindowActive(), false);
  win.isMinimized = () => false;
  win.isVisible = () => false;
  assert.equal(controller.isWindowActive(), false);
});

test("background off: closing the window asks to quit, with the usual confirmation", () => {
  assert.equal(closeAction({ quitting: false, trayReady: true, runInBackground: false }), "quit");
  assert.equal(closeAction({ quitting: false, trayReady: false, runInBackground: false }), "quit");
  assert.equal(closeAction({ quitting: true, trayReady: true, runInBackground: false }), "allow");
  assert.equal(closeAction({ quitting: false, trayReady: true }), "hide", "the default is still the tray");
  const { controller, state, win } = harness({ running: 2, confirmChoice: 0 });
  controller.start();
  controller.attachWindow(win);
  controller.setRunInBackground(false);
  assert.equal(close(win), true);
  assert.equal(state.dialogs, 1, "a session is running: it asks first");
  assert.equal(state.quitCalls, 0, "recusou: segue rodando");
  assert.equal(state.hidden, 0);
  controller.setRunInBackground(true);
  close(win);
  assert.equal(state.hidden, 1, "turned on again, it hides again");
});

test("icon badge: amber running, red waiting, idle untouched (BGRA)", () => {
  const size = 22;
  const base = Buffer.alloc(size * size * 4, 7);
  assert.equal(drawBadge(base, size, "idle"), base, "idle draws nothing");
  const px = (buf, x, y) => [...buf.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];
  const running = drawBadge(base, size, "running");
  const waiting = drawBadge(base, size, "waiting");
  const radius = Math.max(3, Math.round(size * 0.24));
  const c = size - radius - 1;
  assert.deepEqual(px(running, c, c), [11, 158, 245, 255], "amber core in BGRA");
  assert.deepEqual(px(waiting, c, c), [72, 29, 225, 255], "red core in BGRA");
  assert.deepEqual(px(running, 0, 0), [7, 7, 7, 7], "outside the badge the icon doesn't change");
  assert.deepEqual(px(base, c, c), [7, 7, 7, 7], "the original image isn't changed");
  assert.notDeepEqual(running, waiting);
});

test("the tray swaps the icon with the state and lists the conversations in progress", () => {
  const { controller, state } = harness({ running: 1 });
  state.sessions = [{ id: "s1", title: "Migrar pagamentos", providerName: "Codex CLI" }];
  controller.start();
  assert.equal(state.images.at(-1).bitmap.length, 22 * 22 * 4);
  const runningIcon = state.images.at(-1);
  const labels = state.menu.map((i) => i.label);
  assert.ok(labels.includes("● Migrar pagamentos · Codex CLI"));
  state.menu.find((i) => i.label?.startsWith("● ")).click();
  assert.deepEqual(state.opened, ["s1"], "clicking the conversation takes the interface to it");
  state.approvals = [{ id: "a1", sessionId: "s1", providerId: "codex", tool: "x" }];
  controller.refresh();
  assert.notEqual(state.images.at(-1), runningIcon, "waiting for permission has another icon");
  assert.ok(state.menu.map((i) => i.label).includes("⚠ Migrar pagamentos · Codex CLI"));
  state.running = 0; state.approvals = []; state.sessions = [];
  controller.refresh();
  assert.equal(state.images.at(-1).plain, true, "idle goes back to the icon without a badge");
});

test("menu items: the one waiting for permission comes first and the list has a limit", () => {
  const opened = [];
  const sessions = Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, title: `Conversation ${i}`, waiting: i === 9 }));
  const items = sessionMenuItems(sessions, (id) => opened.push(id));
  assert.equal(items.length, 9);
  assert.match(items[0].label, /^⚠ Conversation 9/);
  assert.equal(items.at(-1).label, "… and 3 more");
  assert.equal(items.at(-1).enabled, false);
  items[1].click();
  assert.deepEqual(opened, ["s0"]);
});

test("clicking a tray notice brings the window and opens the source conversation", () => {
  const h = harness({ running: 1 });
  h.controller.start();
  h.controller.notifyTurnFinished({ title: "Codex replied", body: "ok", sessionId: "s7" });
  h.state.approvals = [{ id: "a9", sessionId: "s3", providerId: "claude", tool: "Bash" }];
  h.controller.onApprovalsChanged();
  h.state.menu.find((i) => i.label?.startsWith("✉")).click();
  h.state.menu.find((i) => i.label?.startsWith("⚠")).click();
  assert.deepEqual(h.state.opened, ["s7", "s3"]);
  assert.ok(h.state.shown >= 2, "the window shows up again");
});
