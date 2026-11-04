const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-plan-state-"));
process.env.BEAGLEDOCK_DATA_DIR = root;
const store = require("../electron/database");
after(async () => {
  await new Promise((resolve, reject) => store.db.close((error) => error ? reject(error) : resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});

for (const providerId of ["claude", "codex", "antigravity"]) {
  test(`${providerId}: plan remembers the prior permission in SQLite and normal saves don't overwrite it`, async () => {
    for (const permission of ["inherit", "ask", "edits", "full"]) {
      const session = { id: `${providerId}-${permission}`, providerId, title: "Plan test", cwd: root, permission };
      await store.saveSession(session);
      await store.saveSession({ ...session, permission: "plan" });
      await store.saveSession({ ...session, permission: "plan", title: "Renamed while planning" });
      const saved = (await store.getSavedSessions()).find((s) => s.id === session.id);
      assert.equal(saved.permission, "plan");
      assert.equal(saved.permissionBeforePlan, permission);
      assert.equal((await store.getSessionPermission(session.id)).permissionBeforePlan, permission);
      await store.saveSession({ ...saved, permission });
      assert.equal((await store.getSessionPermission(session.id)).permissionBeforePlan, undefined);
    }
  });
}
