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

function describeState({ running = 0, waiting = 0, sessions = [] } = {}) {
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
    sessions,
  };
}

// Selo de estado no canto do ícone da bandeja: âmbar rodando, vermelho aguardando permissão.
// `bitmap` é BGRA (o formato do nativeImage no Linux); ocioso fica sem selo.
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
      // Contorno branco de 1 px e miolo colorido, para o selo aparecer em qualquer fundo de painel.
      const [r, g, b] = distance > radius - 0.5 ? [255, 255, 255] : color;
      out[offset] = b;
      out[offset + 1] = g;
      out[offset + 2] = r;
      out[offset + 3] = 255;
    }
  return out;
}

const SESSION_LIMIT = 8;
// Itens do menu para as sessões em andamento, com a que aguarda permissão primeiro.
function sessionMenuItems(sessions, open) {
  const ordered = [...sessions].sort((a, b) => Number(!!b.waiting) - Number(!!a.waiting));
  const items = ordered.slice(0, SESSION_LIMIT).map((s) => ({
    label: `${s.waiting ? "⚠ " : "● "}${String(s.title || "Conversa").slice(0, 48)}${s.providerName ? ` · ${s.providerName}` : ""}`,
    click: () => open(s.id),
  }));
  if (ordered.length > SESSION_LIMIT)
    items.push({ label: `… e mais ${ordered.length - SESSION_LIMIT}`, enabled: false });
  return items;
}

// Fechar nunca encerra o app. Sem bandeja funcional (alguns desktops Linux não a exibem),
// minimiza em vez de esconder, para a janela não ficar inalcançável.
function closeAction({ quitting, trayReady, runInBackground = true }) {
  if (quitting) return "allow";
  // Com o segundo plano desligado, fechar a janela é pedir para sair (com confirmação se houver sessão).
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
  // Sessões em andamento para o menu: [{ id, title, providerName }].
  runningSessions = () => [],
  // Avisa a interface para abrir uma conversa (clique no menu ou na notificação).
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
  // Traz a janela e leva a interface até a conversa.
  const showSession = (sessionId) => {
    showWindow();
    if (sessionId) openSession(sessionId);
  };

  // Ícone por estado, gerado do ícone do app com o selo; guardado para não redesenhar.
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
    const approvals = approvalsList();
    const waitingIds = new Set(approvals.map((a) => a.sessionId));
    const sessions = runningSessions().map((s) => ({ ...s, waiting: waitingIds.has(s.id) }));
    const state = describeState({
      running: runningCount(),
      waiting: approvals.length,
      sessions,
    });
    // Enquanto há sessão rodando, o sistema não suspende o app (a tela pode apagar).
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
        { label: "Abrir BeagleDock", click: showWindow },
        { type: "separator" },
        { label: state.summary, enabled: false },
        ...items,
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
      note.on("click", () => showSession(approval.sessionId));
      note.show();
    }
  }

  return {
    start() {
      try {
        const image = nativeImage.createFromPath(iconPath);
        // Sem imagem (ex.: dist/ não gerado) a bandeja ficaria invisível: não conta como pronta.
        if (image.isEmpty()) throw new Error("ícone da bandeja ausente");
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
    // Preferência "manter na bandeja ao fechar a janela".
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
