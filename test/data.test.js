const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { readLocalMetrics } = require("../electron/telemetry");
const { createCatalogs, parseAgyModels } = require("../electron/catalogs");
const { createHistory } = require("../electron/history");
const {
  protectSettings,
  publicSettings,
} = require("../electron/secure-settings");
const { binaryDirs, shellSpec, findBinary } = require("../electron/platform");
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-test-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}
function write(home, name, value) {
  const file = path.join(home, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof value === "string" ? value : JSON.stringify(value),
  );
  return file;
}
const lines = (values) => values.map((v) => JSON.stringify(v)).join("\n");
test("usage uses real records, deduplicates streaming, aggregates Codex sessions and excludes old events", (t) => {
  const home = fixture(t),
    now = Date.now(),
    recent = new Date(now - 1000).toISOString(),
    old = new Date(now - 8 * 86400000).toISOString();
  write(
    home,
    ".claude/projects/proj/session-a.jsonl",
    lines([
      {
        timestamp: old,
        message: { id: "old", usage: { input_tokens: 999999 } },
      },
      {
        timestamp: recent,
        message: {
          id: "response",
          usage: {
            input_tokens: 10,
            output_tokens: 1,
            cache_read_input_tokens: 20,
          },
        },
      },
      {
        timestamp: recent,
        message: {
          id: "response",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 20,
          },
        },
      },
    ]),
  );
  for (const [id, multiplier] of [
    ["a", 1],
    ["b", 2],
  ])
    write(
      home,
      `.codex/sessions/session-${id}.jsonl`,
      lines([
        { type: "session_meta", payload: { id } },
        {
          timestamp: old,
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 100,
                output_tokens: 10,
                total_tokens: 110,
              },
            },
          },
        },
        {
          timestamp: recent,
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 100 + multiplier * 10,
                output_tokens: 10 + multiplier * 2,
                total_tokens: 110 + multiplier * 12,
              },
            },
            rate_limits: {
              primary: {
                used_percent: 37,
                resets_at: Math.floor(now / 1000) + 3600,
              },
              secondary: { used_percent: 45 },
            },
          },
        },
      ]),
    );
  write(
    home,
    ".gemini/antigravity-cli/brain/native-id-123/.system_generated/logs/transcript.jsonl",
    lines([
      {
        type: "PLANNER_RESPONSE",
        step_index: 1,
        created_at: recent,
        input_tokens: 7,
        output_tokens: 3,
        cache_read_tokens: 2,
      },
      {
        type: "USER_INPUT",
        step_index: 2,
        created_at: recent,
        content: "prompt",
      },
    ]),
  );
  const metrics = readLocalMetrics({ home, env: {}, now });
  assert.equal(metrics.claude.totalTokens, 35);
  assert.equal(metrics.claude.window5hPercent, null);
  assert.equal(metrics.codex.totalTokens, 36);
  assert.equal(metrics.codex.window5hPercent, 37);
  assert.equal(metrics.codex.stale, false);
  assert.equal(metrics.antigravity.totalTokens, 10);
  assert.equal(metrics.antigravity.weeklyPercent, null);
});
test("missing metrics remain unknown instead of zero; expired quota is not reused", (t) => {
  const home = fixture(t),
    now = Date.now();
  let metrics = readLocalMetrics({ home, env: {}, now });
  for (const value of Object.values(metrics)) {
    assert.equal(value.totalTokens, null);
    assert.equal(value.window5hPercent, null);
  }
  write(
    home,
    ".codex/sessions/expired.jsonl",
    lines([
      {
        timestamp: new Date(now - 60000).toISOString(),
        payload: {
          type: "token_count",
          rate_limits: {
            primary: {
              used_percent: 95,
              resets_at: Math.floor(now / 1000) - 1,
            },
          },
        },
      },
    ]),
  );
  metrics = readLocalMetrics({ home, env: {}, now });
  assert.equal(metrics.codex.window5hPercent, null);
  assert.equal(metrics.codex.stale, true);
});
test("catalogs use machine caches and TOML; empty catalogs stay empty; MCP is configured not connected", async (t) => {
  const home = fixture(t);
  const catalogs = createCatalogs({ home, env: {}, find: () => null });
  assert.deepEqual(catalogs.localCatalogs().claude.models, []);
  write(home, ".claude/cache/model-catalog/catalog.json", {
    catalog: { config: { models: [{ id: "claude-from-disk" }] } },
  });
  write(home, ".codex/models_cache.json", {
    models: [{ slug: "codex-from-disk" }],
  });
  write(
    home,
    ".codex/config.toml",
    'model = "custom-model"\n[mcp_servers."custom.name"]\ncommand = "node"\nargs = ["private-argument"]\n',
  );
  const local = catalogs.localCatalogs();
  assert.deepEqual(local.claude.models, ["claude-from-disk"]);
  assert.deepEqual(local.codex.models, ["codex-from-disk", "custom-model"]);
  assert.equal(local.codex.mcps[0].name, "custom.name");
  assert.equal(local.codex.mcps[0].status, "idle");
  assert.doesNotMatch(JSON.stringify(local.codex.mcps), /private-argument/);
  assert.equal((await catalogs.detect()).codex.version, null);
  assert.deepEqual(
    parseAgyModels(
      "MODEL ID\nagy-model-one\tAvailable\nagy-model-two\tAvailable\n",
    ),
    ["agy-model-one", "agy-model-two"],
  );
});
test("failed catalog refresh preserves data and marks its error", async (t) => {
  const home = fixture(t);
  let fail = false;
  const catalogs = createCatalogs({
    home,
    env: {},
    find: (n) => (n === "agy" ? "agy" : null),
    exec: async () => {
      if (fail) throw new Error("offline");
      return { stdout: "agy-real-model\tavailable\n" };
    },
  });
  await catalogs.refreshAgy(true);
  fail = true;
  await catalogs.refreshAgy(true);
  const result = catalogs.localCatalogs().antigravity;
  assert.deepEqual(result.models, ["agy-real-model"]);
  assert.equal(result.modelsError, "offline");
  assert.ok(result.modelsUpdatedAt);
});
test("all three histories preserve original cwd, native id, and reject traversal", (t) => {
  const home = fixture(t);
  const cwd = path.join(home, "project");
  write(
    home,
    ".claude/history.jsonl",
    lines([
      {
        sessionId: "claude-id-123",
        project: cwd,
        display: "first",
        timestamp: Date.now(),
      },
    ]),
  );
  write(
    home,
    ".claude/projects/project/claude-id-123.jsonl",
    lines([
      { cwd, type: "user", timestamp: "now", message: { content: "hello" } },
      {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "answer" }],
          model: "chosen-model",
        },
      },
    ]),
  );
  write(
    home,
    ".codex/sessions/rollout-codex-id-123.jsonl",
    lines([
      { type: "session_meta", payload: { id: "codex-id-123", cwd } },
      { type: "event_msg", payload: { type: "user_message", message: "hello codex" } },
      {
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "answer" }],
        },
      },
    ]),
  );
  write(
    home,
    ".gemini/antigravity-cli/history.jsonl",
    lines([
      {
        conversationId: "agy-id-123",
        workspace: cwd,
        display: "hello",
        timestamp: Date.now(),
      },
    ]),
  );
  write(
    home,
    ".gemini/antigravity-cli/brain/agy-id-123/.system_generated/logs/transcript.jsonl",
    lines([
      { type: "USER_INPUT", content: "hello" },
      { type: "PLANNER_RESPONSE", content: "answer" },
    ]),
  );
  const reader = createHistory({ home, env: {} });
  assert.equal(reader.history().length, 3);
  for (const [provider, id] of [
    ["claude", "claude-id-123"],
    ["codex", "codex-id-123"],
    ["antigravity", "agy-id-123"],
  ]) {
    const result = reader.conversation(provider, id);
    assert.equal(result.cwd, cwd);
    assert.equal(result.nativeSessionId, id);
    assert.ok(result.messages.length);
  }
  assert.throws(() => reader.conversation("claude", "../../secret"));
});
test("secrets are encrypted, never returned to renderer, and unavailable/basic-text vaults fail closed", () => {
  const vault = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "test",
    encryptString: (value) =>
      Buffer.from("encrypted:" + Buffer.from(value).toString("base64")),
  };
  const stored = protectSettings(
    { theme: "dark", openaiApiKey: "private-value" },
    {},
    vault,
  );
  assert.doesNotMatch(JSON.stringify(stored), /private-value/);
  assert.equal(stored.openaiApiKey.encrypted, 1);
  assert.equal(publicSettings(stored).openaiApiKey, undefined);
  assert.equal(publicSettings(stored).configuredSecrets.openaiApiKey, true);
  assert.deepEqual(
    protectSettings({ theme: "system" }, stored, vault).openaiApiKey,
    stored.openaiApiKey,
  );
  assert.equal(
    protectSettings({ openaiApiKey: "" }, stored, vault).openaiApiKey,
    undefined,
  );
  assert.throws(
    () => protectSettings({ openaiApiKey: "private-value" }, {}, undefined),
    /keyring/,
  );
  assert.throws(
    () =>
      protectSettings(
        { openaiApiKey: "private-value" },
        {},
        { ...vault, getSelectedStorageBackend: () => "basic_text" },
      ),
    /keyring/,
  );
  assert.equal(
    protectSettings({}, { openaiApiKey: "legacy-value" }, vault).openaiApiKey
      .encrypted,
    1,
  );
});
test("database persists native links across processes and initializes before first save", (t) => {
  const home = fixture(t);
  const database = path.resolve("electron/database.js");
  const env = { ...process.env, BEAGLEDOCK_DATA_DIR: home };
  const first = `const db=require(${JSON.stringify(database)});(async()=>{await db.saveSession({id:'app-session',providerId:'claude',cwd:'/project',title:'saved'});await db.setNativeSession('app-session','claude','native-id-123','/project');await new Promise((r,j)=>db.db.close(e=>e?j(e):r()));})().catch(e=>{console.error(e.message);process.exit(1)});`;
  execFileSync(process.execPath, ["-e", first], { env });
  const second = `const db=require(${JSON.stringify(database)});(async()=>{const sessions=await db.getSavedSessions();console.log(JSON.stringify(sessions));await new Promise((r,j)=>db.db.close(e=>e?j(e):r()));})().catch(e=>{console.error(e.message);process.exit(1)});`;
  const result = JSON.parse(
    execFileSync(process.execPath, ["-e", second], { env, encoding: "utf8" }),
  );
  assert.equal(result[0].nativeSessionId, "native-id-123");
  assert.equal(result[0].status, "idle");
});
test("database keeps the prompt cache state of a conversation across restarts", (t) => {
  const home = fixture(t);
  const database = path.resolve("electron/database.js");
  const env = { ...process.env, BEAGLEDOCK_DATA_DIR: home };
  const context = { used: 15406, window: 1000000, windowKnown: true, source: "claude", updatedAt: 2000, lastCallAt: 1500, cacheTtlMs: 3600000, model: "opus", cache: { read: 9014, write: 6390 } };
  const first = `const db=require(${JSON.stringify(database)});(async()=>{await db.saveSession({id:'cache-session',providerId:'claude',cwd:'/project',title:'saved'});await db.setSessionContext('cache-session',${JSON.stringify(context)});await new Promise((r,j)=>db.db.close(e=>e?j(e):r()));})().catch(e=>{console.error(e.message);process.exit(1)});`;
  execFileSync(process.execPath, ["-e", first], { env });
  const second = `const db=require(${JSON.stringify(database)});(async()=>{const sessions=await db.getSavedSessions();console.log(JSON.stringify(sessions));await new Promise((r,j)=>db.db.close(e=>e?j(e):r()));})().catch(e=>{console.error(e.message);process.exit(1)});`;
  const [saved] = JSON.parse(execFileSync(process.execPath, ["-e", second], { env, encoding: "utf8" }));
  assert.equal(saved.context.lastCallAt, 1500);
  assert.equal(saved.context.cacheTtlMs, 3600000);
  assert.equal(saved.context.model, "opus", "the cache's model survives so a switch can be flagged after reopening");
  assert.deepEqual(saved.context.cache, { read: 9014, write: 6390 });
});
test("platform discovery includes macOS Homebrew and Windows npm; shells use platform arguments", (t) => {
  const home = fixture(t);
  const bin = write(home, ".local/bin/claude", "#!/bin/sh\n");
  fs.chmodSync(bin, 0o755);
  assert.equal(findBinary("claude", { home, env: {}, platform: "linux" }), bin);
  assert.ok(binaryDirs("darwin", {}, home).includes("/opt/homebrew/bin"));
  assert.ok(
    binaryDirs(
      "win32",
      { APPDATA: "C:\\Users\\dev\\AppData\\Roaming" },
      "C:\\Users\\dev",
    ).includes("C:\\Users\\dev\\AppData\\Roaming\\npm"),
  );
  assert.deepEqual(
    shellSpec("win32", { COMSPEC: "C:\\Windows\\System32\\cmd.exe" }).args,
    [],
  );
  assert.equal(shellSpec("darwin", {}).bin, "/bin/zsh");
  assert.deepEqual(shellSpec("linux", {}).args, ["-l"]);
});

test("model capabilities refresh from changed CLI cache contents without retaining removed levels", (t) => {
  const home = fixture(t);
  write(home, ".codex/models_cache.json", {
    models: [
      {
        slug: "sync-model",
        supported_reasoning_levels: [
          { effort: "first", description: "First catalogue" },
        ],
      },
    ],
  });
  write(home, ".claude/cache/model-catalog/current.json", {
    catalog: {
      config: {
        models: [
          {
            id: "claude-sync",
            thinking: {
              effort_options: [{ id: "adaptive", name: "Adaptive" }],
            },
          },
        ],
      },
    },
  });
  const catalogs = createCatalogs({ home, env: {}, find: () => null });
  assert.deepEqual(
    catalogs.localCatalogs().codex.modelOptions[0].efforts.map((e) => e.id),
    ["first"],
  );
  assert.deepEqual(
    catalogs.localCatalogs().claude.modelOptions[0].efforts.map((e) => e.id),
    ["adaptive"],
  );
  write(home, ".codex/models_cache.json", {
    models: [
      {
        slug: "sync-model",
        supported_reasoning_levels: [{ effort: "replacement" }],
      },
    ],
  });
  const refreshed = catalogs.localCatalogs();
  assert.deepEqual(
    refreshed.codex.modelOptions[0].efforts.map((e) => e.id),
    ["replacement"],
  );
});
test("AGY: a conversation opened in the CLI's interface (history.jsonl without ID) is found through the brain folder", (t) => {
  const home = fixture(t);
  const cwd = path.join(home, "project");
  const at = Date.parse("2026-11-04T00:15:11Z");
  write(
    home,
    ".gemini/antigravity-cli/history.jsonl",
    lines([
      // Real AGY 1.4.12 format in the interface: only text, time and folder.
      { display: "diga só GIRASSOL", timestamp: at + 400, workspace: cwd },
      { display: "outra pergunta sem conversa", timestamp: at + 900, workspace: cwd },
    ]),
  );
  const wrapped = (text) =>
    `<USER_REQUEST>\n${text}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-11-03T21:15:11-03:00.\n</ADDITIONAL_METADATA>`;
  write(
    home,
    ".gemini/antigravity-cli/brain/agy-tui-0001/.system_generated/logs/transcript.jsonl",
    lines([
      { type: "USER_INPUT", created_at: "2026-11-04T00:15:11Z", content: wrapped("diga só GIRASSOL") },
      { type: "SYSTEM_MESSAGE", created_at: "2026-11-04T00:15:11Z", content: "hook" },
      { type: "PLANNER_RESPONSE", created_at: "2026-11-04T00:15:14Z", content: "GIRASSOL" },
    ]),
  );
  write(
    home,
    ".gemini/antigravity-cli/brain/agy-tui-velha/.system_generated/logs/transcript.jsonl",
    lines([{ type: "USER_INPUT", created_at: "2026-10-01T00:00:00Z", content: wrapped("diga só GIRASSOL") }]),
  );
  const reader = createHistory({ home, env: {} });
  const items = reader.history().filter((h) => h.provider === "antigravity");
  assert.deepEqual(items.map((h) => [h.sessionId, h.project]), [["agy-tui-0001", cwd]], "the one from another date doesn't match");
  const result = reader.conversation("antigravity", "agy-tui-0001");
  assert.equal(result.cwd, cwd);
  assert.deepEqual(result.messages.map((m) => [m.sender, m.text]), [
    ["user", "diga só GIRASSOL"],
    ["antigravity", "GIRASSOL"],
  ]);
});
