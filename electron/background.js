// Segundo plano: fechar a janela leva o app para a bandeja e as sessões continuam rodando.
// Só o item "Sair" da bandeja encerra o app (com confirmação se houver sessão em execução).

// O Codex informa o método do protocolo (ex.: item/commandExecution/requestApproval).
function friendlyTool(tool) {
  const name = String(tool || "");
  if (/commandExecution\/requestApproval$/.test(name)) return "executar um comando";
  if (/fileChange\/requestApproval$/.test(name)) return "editar arquivos";
  if (/permissions\/requestApproval$/.test(name)) return "uma permissão adicional";
  if (/requestApproval$/.test(name)) return "uma ação";
  return name || "uma ferramenta";
}

function describeState({ running = 0, waiting = 0 } = {}) {
  const parts = [];
  if (running > 0)
    parts.push(`${running} ${running === 1 ? "sessão rodando" : "sessões rodando"}`);
  if (waiting > 0)
    parts.push(
      `${waiting} ${waiting === 1 ? "aguardando permissão" : "aguardando permissão"}`,
    );
  const status = waiting > 0 ? "waiting" : running > 0 ? "running" : "idle";
  return {
    status,
    summary: parts.length ? parts.join(" · ") : "Nenhuma sessão em execução",
    tooltip: parts.length ? `BeagleDock · ${parts.join(" · ")}` : "BeagleDock",
  };
}

// Fechar nunca encerra o app. Sem bandeja funcional (alguns desktops Linux não a exibem),
// minimiza em vez de esconder, para a janela não ficar inalcançável.
function closeAction({ quitting, trayReady }) {
  if (quitting) return "allow";
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

  function confirmQuit() {
    const running = runningCount();
    if (!running || bypass) return true;
    const win = getWindow();
    const choice = dialog.showMessageBoxSync(
      win && !win.isDestroyed() ? win : undefined,
      {
        type: "warning",
        buttons: ["Continuar rodando", "Sair e interromper"],
        defaultId: 0,
        cancelId: 0,
        title: "Sair do BeagleDock",
        message: `${running} ${running === 1 ? "sessão está" : "sessões estão"} em execução.`,
        detail:
          "Sair interrompe as CLIs em andamento. As conversas continuam salvas.",
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
    const state = describeState({
      running: runningCount(),
      waiting: approvalsList().length,
    });
    // Enquanto há sessão rodando, o sistema não suspende o app (a tela pode apagar).
    if (state.status !== "idle" && blockerId === null)
      blockerId = powerSaveBlocker.start("prevent-app-suspension");
    if (state.status === "idle" && blockerId !== null) {
      powerSaveBlocker.stop(blockerId);
      blockerId = null;
    }
    const key = `${state.status}|${state.summary}`;
    if (!tray || (!force && key === lastKey)) return state;
    lastKey = key;
    tray.setToolTip(state.tooltip);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Abrir BeagleDock", click: showWindow },
        { type: "separator" },
        { label: state.summary, enabled: false },
        { type: "separator" },
        { label: "Sair", click: requestQuit },
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
        title: "BeagleDock · permissão pendente",
        body: `${approval.providerId} quer ${/^(executar|editar|uma)/.test(friendlyTool(approval.tool)) ? friendlyTool(approval.tool) : `usar ${friendlyTool(approval.tool)}`}`,
      });
      note.on("click", showWindow);
      note.show();
    }
  }

  return {
    start() {
      try {
        const image = nativeImage.createFromPath(iconPath);
        // Sem imagem (ex.: dist/ não gerado) a bandeja ficaria invisível: não conta como pronta.
        if (image.isEmpty()) throw new Error("ícone da bandeja ausente");
        tray = new Tray(image.resize({ width: 22, height: 22 }));
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
        const action = closeAction({ quitting, trayReady: !!tray });
        if (action === "allow") return;
        event.preventDefault();
        if (action === "hide") win.hide();
        else win.minimize();
      });
    },
    // before-quit: só segue se o encerramento veio da bandeja (ou do sistema/ambiente de teste).
    // Sem bandeja funcional não há "Sair" para usar: o app se comporta como um app comum, com
    // confirmação se houver sessão rodando.
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
    // Resposta espontânea da CLI: avisa só se a janela não está à frente.
    notifyTurnFinished({ title, body }) {
      const win = getWindow();
      const visible = win && !win.isDestroyed() && win.isVisible() && win.isFocused();
      if (visible || !Notification.isSupported()) return;
      const note = new Notification({ title, body });
      note.on("click", showWindow);
      note.show();
    },
    showWindow,
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
  quitAction,
  friendlyTool,
};
