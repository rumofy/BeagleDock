const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createBackgroundController,
  describeState,
  closeAction,
  quitAction,
  friendlyTool,
} = require("../electron/background");

test("estado da bandeja resume sessões rodando e aprovações pendentes", () => {
  assert.deepEqual(describeState(), {
    status: "idle",
    summary: "Nenhuma sessão em execução",
    tooltip: "BeagleDock",
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
  const state = { running, approvals, quitCalls: 0, hidden: 0, minimized: 0, shown: 0, notes: [], blocker: { started: 0, stopped: 0 }, tooltip: "", menu: null, dialogs: 0 };
  class Tray {
    constructor() {
      if (trayFails) throw new Error("sem bandeja");
      state.tray = this;
    }
    on() {}
    setToolTip(t) { state.tooltip = t; }
    setContextMenu(m) { state.menu = m; }
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
    on() {}
    show() {}
  }
  const controller = createBackgroundController({
    app: { quit: () => state.quitCalls++ },
    Tray,
    Menu: { buildFromTemplate: (t) => t },
    Notification,
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => emptyIcon, resize: () => ({ isEmpty: () => false }) }),
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
