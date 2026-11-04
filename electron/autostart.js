const fs = require("fs");
const os = require("os");
const path = require("path");
const { t } = require("./i18n");

// Start with the system on Linux: a .desktop in ~/.config/autostart (Electron's setLoginItemSettings
// doesn't work on Linux). The app opens straight into the tray, without showing the window (`--hidden`).
const FILE = "beagledock.desktop";

const dir = (home, env) => path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "autostart");

// AppImage: the real executable is the file itself; packaged (.deb) it's the app binary.
function launchCommand({ env = process.env, execPath = process.execPath } = {}) {
  const target = env.APPIMAGE || execPath;
  return `"${String(target).replace(/(["\\$`])/g, "\\$1")}" --hidden`;
}

function desktopEntry(command) {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=BeagleDock",
    "Comment=Cockpit for AI CLIs",
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
  if (platform !== "linux") return { ok: false, error: t("errors.autostartLinuxOnly") };
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
    return { ok: false, error: t(enabled ? "errors.autostartEnable" : "errors.autostartDisable", { error: error.message }) };
  }
}

const isAutostart = ({ fsApi = fs, home = os.homedir(), env = process.env } = {}) =>
  fsApi.existsSync(path.join(dir(home, env), FILE));

module.exports = { setAutostart, isAutostart, desktopEntry, launchCommand };
