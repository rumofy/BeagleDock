const fs = require("fs");
const os = require("os");
const path = require("path");

// Iniciar com o sistema no Linux: um .desktop em ~/.config/autostart (o setLoginItemSettings do Electron
// não funciona no Linux). O app abre já na bandeja, sem mostrar a janela (`--hidden`).
const FILE = "beagledock.desktop";

const dir = (home, env) => path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "autostart");

// AppImage: o executável de verdade é o próprio arquivo; empacotado (.deb) é o binário do app.
function launchCommand({ env = process.env, execPath = process.execPath } = {}) {
  const target = env.APPIMAGE || execPath;
  return `"${String(target).replace(/(["\\$`])/g, "\\$1")}" --hidden`;
}

function desktopEntry(command) {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=BeagleDock",
    "Comment=Cockpit para CLIs de IA",
    `Exec=${command}`,
    "X-GNOME-Autostart-enabled=true",
    "Terminal=false",
    "",
  ].join("\n");
}

function setAutostart(
  enabled,
  { fsApi = fs, home = os.homedir(), env = process.env, execPath = process.execPath, platform = process.platform } = {},
) {
  if (platform !== "linux") return { ok: false, error: "Iniciar com o sistema só está disponível no Linux." };
  const file = path.join(dir(home, env), FILE);
  try {
    if (enabled) {
      fsApi.mkdirSync(path.dirname(file), { recursive: true });
      fsApi.writeFileSync(file, desktopEntry(launchCommand({ env, execPath })), { mode: 0o644 });
    } else {
      fsApi.rmSync(file, { force: true });
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Não foi possível ${enabled ? "ativar" : "desativar"} o início com o sistema: ${error.message}` };
  }
}

const isAutostart = ({ fsApi = fs, home = os.homedir(), env = process.env } = {}) =>
  fsApi.existsSync(path.join(dir(home, env), FILE));

module.exports = { setAutostart, isAutostart, desktopEntry, launchCommand };
