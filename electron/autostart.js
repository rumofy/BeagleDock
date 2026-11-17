const fs = require("fs");
const os = require("os");
const path = require("path");
const { t } = require("./i18n");

// Start with the system. On Linux: a .desktop in ~/.config/autostart (Electron's setLoginItemSettings
// doesn't work there). On Windows and macOS: the user's login items through Electron (`loginItems`
// is Electron's `app`), which needs no administrator rights. Either way the app opens straight into
// the tray, without showing the window (`--hidden`).
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

// Login item for Windows/macOS. Unpackaged (`electron .`), the executable is Electron itself and
// needs the app folder as its first argument, or it would open an empty Electron at login.
function loginItemOptions({ execPath = process.execPath, appPath, packaged = true } = {}) {
  return { path: execPath, args: packaged || !appPath ? ["--hidden"] : [appPath, "--hidden"] };
}

function setAutostart(
  enabled,
  {
    fsApi = fs,
    home = os.homedir(),
    env = process.env,
    execPath = process.execPath,
    platform = process.platform,
    loginItems,
    appPath,
    packaged,
  } = {},
) {
  if (platform === "win32" || platform === "darwin") {
    if (!loginItems?.setLoginItemSettings) return { ok: false, error: t("errors.autostartUnsupported") };
    try {
      loginItems.setLoginItemSettings({ openAtLogin: !!enabled, ...loginItemOptions({ execPath, appPath, packaged }) });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: t(enabled ? "errors.autostartEnable" : "errors.autostartDisable", { error: error.message }) };
    }
  }
  if (platform !== "linux") return { ok: false, error: t("errors.autostartUnsupported") };
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

function isAutostart({
  fsApi = fs,
  home = os.homedir(),
  env = process.env,
  platform = process.platform,
  loginItems,
  execPath = process.execPath,
  appPath,
  packaged,
} = {}) {
  if (platform === "win32" || platform === "darwin") {
    try {
      return !!loginItems?.getLoginItemSettings?.(loginItemOptions({ execPath, appPath, packaged }))?.openAtLogin;
    } catch {
      return false;
    }
  }
  return fsApi.existsSync(path.join(dir(home, env), FILE));
}

module.exports = { setAutostart, isAutostart, desktopEntry, launchCommand, loginItemOptions };
