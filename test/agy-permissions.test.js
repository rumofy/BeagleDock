const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const {
  agyPermissionSettings,
  readInheritedPermissions,
} = require("../electron/agy-permissions");
const { buildArgs } = require("../electron/cli-runner");
function settingsFromArgs(permission, inherited) {
  const args = buildArgs({
    providerId: "antigravity",
    permission,
    agySettings: agyPermissionSettings(permission, inherited),
  });
  return { args, settings: JSON.parse(args[args.indexOf("--settings") + 1]) };
}
test("AGY per-session policies override global automatic approval and retain explicit restrictions", () => {
  const inherited = {
    deny: ["read_file(private/)"],
    ask: ["write_file(config/)"],
  };
  for (const permission of ["plan", "ask", "edits"]) {
    const { args, settings } = settingsFromArgs(permission, inherited);
    assert.equal(settings.toolPermission, "request-review");
    assert.equal(settings.allowNonWorkspaceAccess, false);
    assert.deepEqual(settings.permissions.allow, []);
    for (const rule of [
      "command(*)",
      "mcp(*)",
      "read_url(*)",
      "execute_url(*)",
    ])
      assert.ok(settings.permissions.deny.includes(rule));
    assert.ok(settings.permissions.deny.includes("read_file(private/)"));
    assert.ok(settings.permissions.ask.includes("write_file(config/)"));
    assert.equal(
      settings.permissions.deny.includes("write_file(*)"),
      permission !== "edits",
    );
    assert.equal(args.includes("--dangerously-skip-permissions"), false);
  }
  const full = settingsFromArgs("full", inherited);
  assert.equal(full.settings.toolPermission, "always-proceed");
  assert.equal(full.settings.allowNonWorkspaceAccess, true);
  assert.equal(full.settings.enableTerminalSandbox, false);
  assert.deepEqual(full.settings.permissions.deny, inherited.deny);
  assert.ok(full.args.includes("--dangerously-skip-permissions"));
  assert.equal(full.args.includes("auto"), false);
});
test("reading global rules never writes settings or imports unrelated values/grants", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "capyai-policy-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, ".gemini", "antigravity-cli", "settings.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const content = JSON.stringify({
    toolPermission: "always-proceed",
    model: "private-model-name",
    permissions: {
      allow: ["command(*)", "write_file(*)"],
      deny: ["read_file(private/)"],
      ask: ["write_file(config/)"],
    },
  });
  fs.writeFileSync(file, content);
  const inherited = readInheritedPermissions({ home, env: {} });
  const policy = agyPermissionSettings("edits", inherited);
  assert.equal(fs.readFileSync(file, "utf8"), content);
  assert.deepEqual(policy.permissions.allow, []);
  assert.doesNotMatch(JSON.stringify(policy), /private-model-name/);
  assert.ok(policy.permissions.deny.includes("command(*)"));
  fs.writeFileSync(file, "{invalid");
  assert.throws(
    () => readInheritedPermissions({ home, env: {} }),
    /política global/,
  );
});
