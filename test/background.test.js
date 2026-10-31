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

test("estado da bandeja resume sessões rodando e aprovações pendentes", () => {
  assert.deepEqual(describeState(), {
    status: "idle",
    summary: "Nenhuma sessão em execução",
    tooltip: "BeagleDock",
    sessions: [],
  });
  assert.equal(describeState({ running: 1 }).summary, "1 sessão rodando");
  assert.equal(describeState({ running: 3 }).summary, "3 sessões rodando");
  const waiting = describeState({ running: 2, waiting: 1 });
  assert.equal(waiting.status, "waiting");
  assert.equal(waiting.tooltip, "BeagleDock · 2 sessões rodando · 1 aguardando permissão");
});

test("fechar a janela nunca encerra o app; sem bandeja funcional minimiza", () => {
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
      if (trayFails) throw new Error("sem bandeja");
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
  class Notification {
    static isSupported() { return true; }
    constructor(opts) { state.notes.push(opts); }
    on(name, cb) { if (name === "click") state.clicks.push(cb); }
    show() {}
  }
  const controller = createBackgroundController({
    app: { quit: () => state.quitCalls++ },
    Tray,
    Menu: { buildFromTemplate: (t) => t },
    Notification,
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

test("fechar a janela esconde na bandeja e mantém as sessões", () => {
  const { controller, state, win } = harness({ running: 2 });
  assert.equal(controller.start(), true);
  controller.attachWindow(win);
  assert.equal(close(win), true);
  assert.equal(state.hidden, 1);
  assert.equal(state.quitCalls, 0);
  assert.equal(state.shutdown, undefined, "nenhuma CLI foi encerrada");
});

test("sem bandeja disponível a janela é minimizada, não escondida", () => {
  const { controller, state, win } = harness({ trayFails: true });
  assert.equal(controller.start(), false);
  controller.attachWindow(win);
  assert.equal(close(win), true);
  assert.equal(state.minimized, 1);
  assert.equal(state.hidden, 0);
});

test("atalhos de sair do sistema são barrados; só a bandeja encerra", () => {
  const { controller, state, win } = harness({ running: 1 });
  controller.start();
  controller.attachWindow(win);
  let prevented = false;
  controller.beforeQuit({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, true, "Ctrl+Q não encerra");
  assert.equal(state.shutdown, undefined);
  assert.ok(state.shown >= 1, "traz a janela de volta");
});

test("Sair na bandeja pede confirmação com sessão rodando e respeita a recusa", () => {
  const declined = harness({ running: 2, confirmChoice: 0 });
  declined.controller.start();
  declined.state.menu.find((i) => i.label === "Sair").click();
  assert.equal(declined.state.dialogs, 1);
  assert.equal(declined.state.quitCalls, 0);

  const accepted = harness({ running: 2, confirmChoice: 1 });
  accepted.controller.start();
  accepted.controller.attachWindow(accepted.win);
  accepted.state.menu.find((i) => i.label === "Sair").click();
  assert.equal(accepted.state.quitCalls, 1);
  // Já autorizado pela bandeja: a janela e o before-quit deixam passar.
  assert.equal(close(accepted.win), false);
  let prevented = false;
  accepted.controller.beforeQuit({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, false);
  assert.equal(accepted.state.shutdown, true);
});

test("Sair sem sessão rodando não pergunta nada", () => {
  const { controller, state } = harness({ running: 0 });
  controller.start();
  state.menu.find((i) => i.label === "Sair").click();
  assert.equal(state.dialogs, 0);
  assert.equal(state.quitCalls, 1);
});

test("o sistema não suspende o app enquanto há sessão rodando", () => {
  const { controller, state } = harness({ running: 1 });
  controller.start();
  controller.refresh();
  assert.equal(state.blocker.started, 1, "um bloqueio só, sem duplicar");
  state.running = 0;
  controller.refresh();
  assert.equal(state.blocker.stopped, 1);
  assert.match(state.tooltip, /^BeagleDock$/);
});

test("notifica permissão pendente só com a janela fora de foco e uma vez por pedido", () => {
  const hidden = harness({ approvals: [{ id: "a1", providerId: "codex", tool: "Bash" }], focused: false });
  hidden.controller.start();
  hidden.controller.onApprovalsChanged();
  hidden.controller.onApprovalsChanged();
  assert.equal(hidden.state.notes.length, 1);
  assert.match(hidden.state.notes[0].body, /codex quer usar Bash/);

  const focused = harness({ approvals: [{ id: "a1", providerId: "codex", tool: "Bash" }], focused: true });
  focused.controller.start();
  focused.controller.onApprovalsChanged();
  assert.equal(focused.state.notes.length, 0);
});

test("ambiente de teste (bypass) deixa o app encerrar normalmente", () => {
  const { controller, state, win } = harness({ running: 3, bypass: true });
  controller.start();
  controller.attachWindow(win);
  let prevented = false;
  controller.beforeQuit({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, false);
  assert.equal(close(win), false, "janela fecha durante a saída");
  assert.equal(state.shutdown, true);
});

test("ícone ausente conta como bandeja indisponível e o app vira um app comum", () => {
  const { controller, state, win } = harness({ emptyIcon: true, running: 2, confirmChoice: 0 });
  assert.equal(controller.start(), false);
  controller.attachWindow(win);
  assert.equal(close(win), true);
  assert.equal(state.minimized, 1, "fechar minimiza");
  // Sem bandeja não há "Sair": Ctrl+Q funciona, mas com confirmação por haver sessão rodando.
  let prevented = false;
  controller.beforeQuit({ preventDefault: () => (prevented = true) });
  assert.equal(state.dialogs, 1);
  assert.equal(prevented, true, "recusou: continua rodando");
  assert.equal(state.shutdown, undefined);
});

test("sem bandeja e sem sessão rodando, sair é imediato", () => {
  const { controller, state } = harness({ emptyIcon: true, running: 0 });
  controller.start();
  let prevented = false;
  controller.beforeQuit({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, false);
  assert.equal(state.shutdown, true);
  assert.equal(state.dialogs, 0);
});

test("o encerramento das CLIs roda uma única vez, mesmo com vários before-quit", () => {
  const { controller, state } = harness({ running: 0, bypass: true });
  controller.start();
  controller.beforeQuit({ preventDefault() {} });
  controller.beforeQuit({ preventDefault() {} });
  controller.allowQuit();
  controller.beforeQuit({ preventDefault() {} });
  assert.equal(state.shutdownCalls, 1);
});

test("nome amigável da ação nas notificações do Codex", () => {
  assert.equal(friendlyTool("item/commandExecution/requestApproval"), "executar um comando");
  assert.equal(friendlyTool("item/fileChange/requestApproval"), "editar arquivos");
  assert.equal(friendlyTool("item/permissions/requestApproval"), "uma permissão adicional");
  assert.equal(friendlyTool("item/outra/requestApproval"), "uma ação");
  assert.equal(friendlyTool("Bash"), "Bash");
  const h = harness({ approvals: [{ id: "x", providerId: "codex", tool: "item/commandExecution/requestApproval" }], focused: false });
  h.controller.start();
  h.controller.onApprovalsChanged();
  assert.equal(h.state.notes[0].body, "codex quer executar um comando");
});

test("janela ativa = visível e não minimizada", () => {
  const { controller, win } = harness();
  controller.start();
  assert.equal(controller.isWindowActive(), true);
  win.isMinimized = () => true;
  assert.equal(controller.isWindowActive(), false);
  win.isMinimized = () => false;
  win.isVisible = () => false;
  assert.equal(controller.isWindowActive(), false);
});

test("segundo plano desligado: fechar a janela pede para sair, com a confirmação de sempre", () => {
  assert.equal(closeAction({ quitting: false, trayReady: true, runInBackground: false }), "quit");
  assert.equal(closeAction({ quitting: false, trayReady: false, runInBackground: false }), "quit");
  assert.equal(closeAction({ quitting: true, trayReady: true, runInBackground: false }), "allow");
  assert.equal(closeAction({ quitting: false, trayReady: true }), "hide", "o padrão continua sendo a bandeja");
  const { controller, state, win } = harness({ running: 2, confirmChoice: 0 });
  controller.start();
  controller.attachWindow(win);
  controller.setRunInBackground(false);
  assert.equal(close(win), true);
  assert.equal(state.dialogs, 1, "há sessão rodando: pergunta antes");
  assert.equal(state.quitCalls, 0, "recusou: segue rodando");
  assert.equal(state.hidden, 0);
  controller.setRunInBackground(true);
  close(win);
  assert.equal(state.hidden, 1, "ligado de novo, volta a esconder");
});

test("selo do ícone: âmbar rodando, vermelho aguardando, ocioso intacto (BGRA)", () => {
  const size = 22;
  const base = Buffer.alloc(size * size * 4, 7);
  assert.equal(drawBadge(base, size, "idle"), base, "ocioso não desenha nada");
  const px = (buf, x, y) => [...buf.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];
  const running = drawBadge(base, size, "running");
  const waiting = drawBadge(base, size, "waiting");
  const radius = Math.max(3, Math.round(size * 0.24));
  const c = size - radius - 1;
  assert.deepEqual(px(running, c, c), [11, 158, 245, 255], "miolo âmbar em BGRA");
  assert.deepEqual(px(waiting, c, c), [72, 29, 225, 255], "miolo vermelho em BGRA");
  assert.deepEqual(px(running, 0, 0), [7, 7, 7, 7], "fora do selo o ícone não muda");
  assert.deepEqual(px(base, c, c), [7, 7, 7, 7], "a imagem original não é alterada");
  assert.notDeepEqual(running, waiting);
});

test("a bandeja troca o ícone com o estado e lista as conversas em andamento", () => {
  const { controller, state } = harness({ running: 1 });
  state.sessions = [{ id: "s1", title: "Migrar pagamentos", providerName: "Codex CLI" }];
  controller.start();
  assert.equal(state.images.at(-1).bitmap.length, 22 * 22 * 4);
  const runningIcon = state.images.at(-1);
  const labels = state.menu.map((i) => i.label);
  assert.ok(labels.includes("● Migrar pagamentos · Codex CLI"));
  state.menu.find((i) => i.label?.startsWith("● ")).click();
  assert.deepEqual(state.opened, ["s1"], "clicar na conversa leva a interface até ela");
  state.approvals = [{ id: "a1", sessionId: "s1", providerId: "codex", tool: "x" }];
  controller.refresh();
  assert.notEqual(state.images.at(-1), runningIcon, "aguardando permissão tem outro ícone");
  assert.ok(state.menu.map((i) => i.label).includes("⚠ Migrar pagamentos · Codex CLI"));
  state.running = 0; state.approvals = []; state.sessions = [];
  controller.refresh();
  assert.equal(state.images.at(-1).plain, true, "ocioso volta ao ícone sem selo");
});

test("itens do menu: a que aguarda permissão vem primeiro e a lista tem limite", () => {
  const opened = [];
  const sessions = Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, title: `Conversa ${i}`, waiting: i === 9 }));
  const items = sessionMenuItems(sessions, (id) => opened.push(id));
  assert.equal(items.length, 9);
  assert.match(items[0].label, /^⚠ Conversa 9/);
  assert.equal(items.at(-1).label, "… e mais 3");
  assert.equal(items.at(-1).enabled, false);
  items[1].click();
  assert.deepEqual(opened, ["s0"]);
});

test("clicar na notificação traz a janela e abre a conversa de origem", () => {
  const h = harness({ running: 1 });
  h.controller.start();
  h.controller.notifyTurnFinished({ title: "Codex respondeu", body: "ok", sessionId: "s7" });
  h.state.approvals = [{ id: "a9", sessionId: "s3", providerId: "claude", tool: "Bash" }];
  h.controller.onApprovalsChanged();
  assert.equal(h.state.notes.length, 2);
  h.state.clicks[0]();
  h.state.clicks[1]();
  assert.deepEqual(h.state.opened, ["s7", "s3"]);
  assert.ok(h.state.shown >= 2, "a janela volta a aparecer");
});
