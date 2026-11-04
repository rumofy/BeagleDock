const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"),
  os = require("os"),
  path = require("path");
const { parse } = require("smol-toml");
const { createGlobalPermissions } = require("../electron/global-permissions");
const {
  createEcosystem,
  newer,
  updateCommand,
} = require("../electron/ecosystem");
const { buildArgs } = require("../electron/cli-runner");
function temp(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-settings-test-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
test("native global permission edits preserve unrelated settings, rules and TOML tables without returning secrets", (t) => {
  const home = temp(t),
    service = createGlobalPermissions({ home, env: {} });
  const agy = path.join(home, ".gemini/antigravity-cli/settings.json");
  const original = {
    model: "example",
    toolPermission: "always-proceed",
    permissions: { deny: ["command(private)"], allow: ["read_file(*)"] },
    secret: "sensitive",
  };
  write(agy, JSON.stringify(original));
  const read = service.get("antigravity");
  assert.doesNotMatch(JSON.stringify(read), /sensitive|command\(private\)/);
  assert.equal(fs.readFileSync(agy, "utf8"), JSON.stringify(original));
  service.save("antigravity", { toolPermission: "request-review" });
  assert.deepEqual(JSON.parse(fs.readFileSync(agy, "utf8")), {
    ...original,
    toolPermission: "request-review",
  });
  assert.throws(
    () => service.save("antigravity", { permissions: { allow: ["*"] } }),
    /Invalid/,
  );
  const codex = path.join(home, ".codex/config.toml");
  const content =
    '# keep comment\nmodel = "example"\nsandbox_mode = "workspace-write"\n[profiles.review]\nsandbox_mode = "read-only"\n[mcp_servers.example]\ncommand = "example"\n';
  write(codex, content);
  service.save("codex", {
    sandbox_mode: "read-only",
    approval_policy: "never",
  });
  const saved = fs.readFileSync(codex, "utf8");
  assert.match(saved, /# keep comment/);
  assert.deepEqual(
    { ...parse(saved) },
    {
      ...parse(content),
      sandbox_mode: "read-only",
      approval_policy: "never",
    },
  );
  const claude = path.join(home, ".claude/settings.json");
  write(
    claude,
    JSON.stringify({
      permissions: { deny: ["Bash(private)"], defaultMode: "acceptEdits" },
      plugins: ["example"],
    }),
  );
  service.save("claude", { mode: "plan" });
  assert.deepEqual(JSON.parse(fs.readFileSync(claude)), {
    permissions: { deny: ["Bash(private)"], defaultMode: "plan" },
    plugins: ["example"],
  });
  const before = service.fingerprint("claude");
  service.save("claude", { mode: "dontAsk" });
  assert.notEqual(before, service.fingerprint("claude"));
  write(agy, "{invalid");
  assert.match(service.get("antigravity").error, /Invalid/);
  assert.throws(() =>
    service.save("antigravity", { toolPermission: "strict" }),
  );
  assert.equal(fs.readFileSync(agy, "utf8"), "{invalid");
});
test("inherit omits overrides for every CLI; advanced TOML tables are never rewritten as scalars", (t) => {
  for (const providerId of ["claude", "codex", "antigravity"]) {
    const args = buildArgs({ providerId, permission: "inherit" });
    for (const flag of [
      "--settings",
      "--permission-mode",
      "--mode",
      "--dangerously-skip-permissions",
    ])
      assert.ok(!args.includes(flag));
    assert.ok(
      !args.some(
        (a) =>
          a.startsWith("sandbox_mode=") || a.startsWith("approval_policy="),
      ),
    );
  }
  const home = temp(t),
    svc = createGlobalPermissions({ home, env: {} }),
    file = path.join(home, ".codex/config.toml");
  const text = "[approval_policy.granular]\nrules = true\n";
  write(file, text);
  assert.throws(
    () => svc.save("codex", { approval_policy: "never" }),
    /advanced table/,
  );
  assert.equal(fs.readFileSync(file, "utf8"), text);
});
test("release checks persist deduplicated notices, model additions and read state; failed checks preserve known releases", async (t) => {
  const home = temp(t),
    file = path.join(home, "ecosystem.json");
  let requests = 0,
    fail = false;
  const service = createEcosystem({
    file,
    request: async (url) => {
      requests++;
      if (fail) throw new Error("offline");
      return url.includes("manifests")
        ? { version: "2.0.0" }
        : { tag_name: url.includes("codex") ? "rust-v2.0.0" : "v2.0.0" };
    },
  });
  const base = {
    claude: { installed: true, version: "1.0.0", models: ["example-a"] },
    codex: { installed: false, models: [] },
    antigravity: { installed: true, version: "1.0.0", models: [] },
  };
  service.observe(base);
  assert.equal(service.get().notifications.length, 0);
  await service.check();
  service.observe(base);
  assert.ok(service.get().notifications.some((n) => /2.0.0/.test(n.title)));
  const changed = {
    ...base,
    claude: { ...base.claude, models: ["example-a", "example-b"] },
    codex: { installed: true, version: "2.0.0", models: [] },
  };
  service.observe(changed);
  const count = service.get().notifications.length;
  service.observe(changed);
  assert.equal(service.get().notifications.length, count);
  assert.ok(
    service
      .get()
      .notifications.some(
        (n) => n.category === "new_model" && n.description === "example-b",
      ),
  );
  assert.ok(
    service.get().notifications.some((n) => n.title === "Codex CLI detected"),
  );
  await service.check();
  assert.equal(requests, 3);
  service.markRead();
  assert.ok(service.get().notifications.every((n) => !n.isNew));
  const reloaded = createEcosystem({ file });
  assert.equal(reloaded.get().notifications.length, count);
  assert.ok(reloaded.get().notifications.every((n) => !n.isNew));
  fail = true;
  await service.check(true);
  assert.equal(service.get().releases.claude.version, "2.0.0");
  assert.match(service.get().releases.claude.error, /check/);
});
test("fixed native updaters are bounded and serialized, reject arbitrary providers, report failure and verify installed version", async (t) => {
  const home = temp(t);
  const calls = [];
  let release;
  const pending = new Promise((r) => (release = r));
  const svc = createEcosystem({
    file: path.join(home, "state"),
    find: (n) => "/fixture/" + n,
    exec: async (bin, args, options) => {
      calls.push({ bin, args, options });
      if (args[0] === "update") await pending;
      return { stdout: "agy 2.0.0" };
    },
  });
  const run = svc.update("antigravity");
  await assert.rejects(svc.update("antigravity"), /already running/);
  release();
  assert.deepEqual(await run, { ok: true, version: "2.0.0" });
  assert.deepEqual(calls[0].args, ["update"]);
  assert.equal(calls[0].options.timeout, 180000);
  assert.deepEqual(calls[1].args, ["--version"]);
  await assert.rejects(svc.update("unknown"), /Invalid/);
  const failed = createEcosystem({
    file: path.join(home, "state2"),
    find: (n) => "/fixture/" + n,
    exec: async () => {
      throw new Error("private credential output");
    },
  });
  assert.doesNotMatch(
    JSON.stringify(await failed.update("claude")),
    /private credential/,
  );
  assert.throws(
    () => updateCommand("codex", "/unknown/codex", () => null),
    /Unrecognized/,
  );
  assert.equal(newer("1.10.0", "1.9.0"), true);
  assert.equal(newer("1.0.0-beta", "1.0.0"), false);
});

test("Codex npm updates keep the detected prefix, including Windows npm shims", (t) => {
  const root = temp(t),
    prefix = path.join(root, "installation"),
    real = path.join(prefix, "lib/node_modules/@openai/codex/bin/codex.js");
  write(real, "fixture");
  const command = updateCommand("codex", real, () => "/fixture/npm");
  assert.deepEqual(command.args, [
    "install",
    "--global",
    "--prefix",
    fs.realpathSync(prefix),
    "@openai/codex@latest",
  ]);
  const windowsPrefix = path.join(root, "windows-npm"),
    shim = path.join(windowsPrefix, "codex.cmd");
  write(shim, "fixture");
  write(
    path.join(windowsPrefix, "node_modules/@openai/codex/package.json"),
    JSON.stringify({ name: "@openai/codex" }),
  );
  const windows = updateCommand("codex", shim, () => "/fixture/npm.cmd");
  assert.deepEqual(windows.args, [
    "install",
    "--global",
    "--prefix",
    fs.realpathSync(windowsPrefix),
    "@openai/codex@latest",
  ]);
});
test("new-model notices show synchronized names and IDs, enrich old aliases, and do not mistake an alias for a release", (t) => {
  const home = temp(t),
    file = path.join(home, "models-notices.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      seen: {
        claude: {
          installed: true,
          version: "1.0.0",
          models: ["claude-example-1"],
        },
      },
      notifications: [
        {
          id: "models:claude:example",
          category: "new_model",
          description: "example",
        },
      ],
      releases: {},
    }),
  );
  const service = createEcosystem({ file });
  service.observe({
    claude: {
      installed: true,
      version: "1.0.0",
      models: ["claude-example-1", "example"],
      modelOptions: [
        { id: "claude-example-1", label: "Example 1", aliases: ["Example"] },
      ],
    },
  });
  assert.equal(service.get().notifications.length, 1);
  assert.deepEqual(service.get().notifications[0].models, [
    { id: "claude-example-1", label: "Example 1" },
  ]);
  service.observe({
    claude: {
      installed: true,
      version: "1.0.0",
      models: ["claude-example-1", "claude-example-2"],
      modelOptions: [
        { id: "claude-example-1", label: "Example 1", aliases: [] },
        { id: "claude-example-2", label: "Example 2", aliases: [] },
      ],
    },
  });
  assert.equal(service.get().notifications[0].description, "Example 2");
  assert.deepEqual(service.get().notifications[0].models, [
    { id: "claude-example-2", label: "Example 2" },
  ]);
});
