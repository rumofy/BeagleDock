const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"),
  os = require("os"),
  path = require("path");
const {
  migrateLegacyData,
  moveDir,
  removeLegacyHooks,
} = require("../electron/migration");
const { dropUnreadableSecrets } = require("../electron/secure-settings");

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-migration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home"),
    appData = path.join(root, "appData");
  fs.mkdirSync(home);
  fs.mkdirSync(appData);
  return { home, appData };
}
const quiet = () => {};
function legacyData(home) {
  const dir = path.join(home, ".capyai");
  fs.mkdirSync(path.join(dir, "maintenance"), { recursive: true });
  fs.writeFileSync(path.join(dir, "capyai.db"), "db");
  fs.writeFileSync(path.join(dir, "capyai.db-wal"), "wal");
  fs.writeFileSync(path.join(dir, "capyai.db-shm"), "shm");
  fs.writeFileSync(path.join(dir, "ecosystem.json"), "{}");
  fs.writeFileSync(path.join(dir, "maintenance", "x.txt"), "x");
}

test("moves legacy data dir and userData and renames the database files", (t) => {
  const { home, appData } = temp(t);
  legacyData(home);
  fs.mkdirSync(path.join(appData, "capyai"));
  fs.writeFileSync(path.join(appData, "capyai", "Preferences"), "p");
  const logs = [];
  const result = migrateLegacyData({ home, appData, env: {}, log: (m) => logs.push(m) });
  assert.equal(result.data, "renamed");
  assert.equal(result.userData, "renamed");
  const dir = path.join(home, ".beagledock");
  assert.equal(fs.readFileSync(path.join(dir, "beagledock.db"), "utf8"), "db");
  assert.equal(fs.readFileSync(path.join(dir, "beagledock.db-wal"), "utf8"), "wal");
  assert.equal(fs.readFileSync(path.join(dir, "beagledock.db-shm"), "utf8"), "shm");
  assert.equal(fs.existsSync(path.join(dir, "capyai.db")), false);
  assert.equal(fs.readFileSync(path.join(dir, "maintenance", "x.txt"), "utf8"), "x");
  assert.equal(fs.existsSync(path.join(home, ".capyai")), false);
  assert.equal(fs.readFileSync(path.join(appData, "beagledock", "Preferences"), "utf8"), "p");
  assert.ok(logs.length >= 3);
});

test("is a no-op when already migrated or nothing exists, and idempotent", (t) => {
  const { home, appData } = temp(t);
  assert.deepEqual(
    migrateLegacyData({ home, appData, env: {}, log: quiet }),
    { data: "none", userData: "none", db: [] },
  );
  legacyData(home);
  migrateLegacyData({ home, appData, env: {}, log: quiet });
  const again = migrateLegacyData({ home, appData, env: {}, log: quiet });
  assert.equal(again.data, "none");
  assert.equal(fs.readFileSync(path.join(home, ".beagledock", "beagledock.db"), "utf8"), "db");
});

test("never overwrites when both old and new directories exist", (t) => {
  const { home, appData } = temp(t);
  legacyData(home);
  fs.mkdirSync(path.join(home, ".beagledock"));
  fs.writeFileSync(path.join(home, ".beagledock", "beagledock.db"), "new");
  fs.mkdirSync(path.join(appData, "capyai"));
  fs.mkdirSync(path.join(appData, "beagledock"));
  const result = migrateLegacyData({ home, appData, env: {}, log: quiet });
  assert.equal(result.data, "kept-both");
  assert.equal(result.userData, "kept-both");
  assert.equal(fs.readFileSync(path.join(home, ".beagledock", "beagledock.db"), "utf8"), "new");
  assert.equal(fs.readFileSync(path.join(home, ".capyai", "capyai.db"), "utf8"), "db");
  assert.ok(fs.existsSync(path.join(appData, "capyai")));
});

test("BEAGLEDOCK_DATA_DIR skips moving the home directory", (t) => {
  const { home, appData } = temp(t);
  legacyData(home);
  const custom = path.join(home, "custom");
  const result = migrateLegacyData({ home, appData, env: { BEAGLEDOCK_DATA_DIR: custom }, log: quiet });
  assert.equal(result.data, null);
  assert.ok(fs.existsSync(path.join(home, ".capyai")));
  assert.equal(fs.existsSync(custom), false);
});

test("falls back to copy, verify and remove on EXDEV", (t) => {
  const { home } = temp(t);
  legacyData(home);
  const from = path.join(home, ".capyai"),
    to = path.join(home, ".beagledock");
  const exdev = { ...fs, renameSync() { throw Object.assign(new Error("x"), { code: "EXDEV" }); } };
  assert.equal(moveDir(from, to, { fsImpl: exdev }), "copied");
  assert.equal(fs.existsSync(from), false);
  assert.equal(fs.readFileSync(path.join(to, "maintenance", "x.txt"), "utf8"), "x");
});

test("removes only legacy hook ids", () => {
  const hooks = { mine: 1, "capyai-permissions": 1, "bleagledock-permissions": 1, "beagledock-permissions": 1 };
  assert.deepEqual(removeLegacyHooks(hooks).sort(), ["bleagledock-permissions", "capyai-permissions"]);
  assert.deepEqual(Object.keys(hooks).sort(), ["beagledock-permissions", "mine"]);
});

test("drops credentials the vault cannot decrypt and keeps readable ones", () => {
  const storage = {
    isEncryptionAvailable: () => true,
    decryptString(buffer) {
      if (buffer.toString() === "bad") throw new Error("decrypt");
      return "ok";
    },
  };
  const enc = (v) => ({ encrypted: 1, ciphertext: Buffer.from(v).toString("base64") });
  const { settings, dropped } = dropUnreadableSecrets(
    { theme: "dark", openRouterApiKey: enc("bad"), openaiApiKey: enc("good") },
    storage,
  );
  assert.deepEqual(dropped, ["openRouterApiKey"]);
  assert.equal(settings.openRouterApiKey, undefined);
  assert.ok(settings.openaiApiKey);
  assert.equal(settings.theme, "dark");
  assert.deepEqual(
    dropUnreadableSecrets({ openaiApiKey: enc("bad") }, { isEncryptionAvailable: () => false }).dropped,
    [],
  );
});
