const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { setAutostart, isAutostart, desktopEntry, launchCommand, loginItemOptions } = require("../electron/autostart");

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-autostart-"));

test("start with the system: creates and removes the .desktop, opening straight into the tray", () => {
  const dir = home();
  const opts = { home: dir, env: {}, execPath: "/opt/BeagleDock/beagledock", platform: "linux" };
  assert.equal(isAutostart(opts), false);
  assert.deepEqual(setAutostart(true, opts), { ok: true });
  const file = path.join(dir, ".config", "autostart", "beagledock.desktop");
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /^\[Desktop Entry\]/);
  assert.match(text, /^Exec="\/opt\/BeagleDock\/beagledock" --hidden$/m);
  assert.match(text, /^Name=BeagleDock$/m);
  assert.equal(isAutostart(opts), true);
  assert.deepEqual(setAutostart(true, opts), { ok: true }, "turning it on again is idempotent");
  assert.deepEqual(setAutostart(false, opts), { ok: true });
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(setAutostart(false, opts), { ok: true }, "turning it off without a file isn't an error");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("start with the system: honors XDG_CONFIG_HOME and the AppImage", () => {
  const dir = home();
  const opts = { home: "/nao-usado", env: { XDG_CONFIG_HOME: dir, APPIMAGE: "/Apps/Beagle Dock.AppImage" }, execPath: "/tmp/.mount/beagledock", platform: "linux" };
  assert.deepEqual(setAutostart(true, opts), { ok: true });
  const text = fs.readFileSync(path.join(dir, "autostart", "beagledock.desktop"), "utf8");
  assert.match(text, /^Exec="\/Apps\/Beagle Dock\.AppImage" --hidden$/m, "uses the AppImage path, quoted because of the space");
  assert.equal(launchCommand({ env: {}, execPath: '/p/com"aspas' }), '"/p/com\\"aspas" --hidden');
  assert.match(desktopEntry("x"), /Exec=x\n/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("start with the system on Windows/macOS: the user's login item, opening into the tray", () => {
  for (const platform of ["win32", "darwin"]) {
    const calls = [];
    let open = false;
    const loginItems = {
      setLoginItemSettings: (o) => {
        calls.push(o);
        open = o.openAtLogin;
      },
      getLoginItemSettings: () => ({ openAtLogin: open }),
    };
    const opts = { platform, loginItems, execPath: "C:\BeagleDock\BeagleDock.exe", packaged: true };
    assert.equal(isAutostart(opts), false);
    assert.deepEqual(setAutostart(true, opts), { ok: true });
    assert.deepEqual(calls[0], { openAtLogin: true, path: "C:\BeagleDock\BeagleDock.exe", args: ["--hidden"] });
    assert.equal(isAutostart(opts), true);
    assert.deepEqual(setAutostart(false, opts), { ok: true });
    assert.equal(calls[1].openAtLogin, false);
    assert.equal(isAutostart(opts), false);
  }
  assert.deepEqual(loginItemOptions({ execPath: "electron.exe", appPath: "C:\dev\BeagleDock", packaged: false }), {
    path: "electron.exe",
    args: ["C:\dev\BeagleDock", "--hidden"],
  }, "in development Electron gets the app folder, or it would open empty at login");
  const failing = { setLoginItemSettings: () => { throw new Error("denied"); } };
  assert.match(setAutostart(true, { platform: "win32", loginItems: failing }).error, /Couldn't turn on.*denied/);
});

test("start with the system: an unsupported system and a disk failure return a clear error", () => {
  assert.match(setAutostart(true, { platform: "win32" }).error, /isn't available/);
  assert.match(setAutostart(true, { platform: "freebsd" }).error, /isn't available/);
  const blocker = path.join(home(), "arquivo");
  fs.writeFileSync(blocker, "x");
  const failed = setAutostart(true, { home: blocker, env: {}, platform: "linux", execPath: "/x" });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /Couldn't turn on/);
});
