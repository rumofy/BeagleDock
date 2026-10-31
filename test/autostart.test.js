const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { setAutostart, isAutostart, desktopEntry, launchCommand } = require("../electron/autostart");

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-autostart-"));

test("iniciar com o sistema: cria e remove o .desktop, abrindo já na bandeja", () => {
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
  assert.deepEqual(setAutostart(true, opts), { ok: true }, "ativar de novo é idempotente");
  assert.deepEqual(setAutostart(false, opts), { ok: true });
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(setAutostart(false, opts), { ok: true }, "desativar sem arquivo não é erro");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("iniciar com o sistema: respeita XDG_CONFIG_HOME e o AppImage", () => {
  const dir = home();
  const opts = { home: "/nao-usado", env: { XDG_CONFIG_HOME: dir, APPIMAGE: "/Apps/Beagle Dock.AppImage" }, execPath: "/tmp/.mount/beagledock", platform: "linux" };
  assert.deepEqual(setAutostart(true, opts), { ok: true });
  const text = fs.readFileSync(path.join(dir, "autostart", "beagledock.desktop"), "utf8");
  assert.match(text, /^Exec="\/Apps\/Beagle Dock\.AppImage" --hidden$/m, "usa o caminho do AppImage, com espaço entre aspas");
  assert.equal(launchCommand({ env: {}, execPath: '/p/com"aspas' }), '"/p/com\\"aspas" --hidden');
  assert.match(desktopEntry("x"), /Exec=x\n/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("iniciar com o sistema: fora do Linux e com falha de disco devolve erro claro", () => {
  assert.match(setAutostart(true, { platform: "win32" }).error, /só está disponível no Linux/);
  const blocker = path.join(home(), "arquivo");
  fs.writeFileSync(blocker, "x");
  const failed = setAutostart(true, { home: blocker, env: {}, platform: "linux", execPath: "/x" });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /Não foi possível ativar/);
});
