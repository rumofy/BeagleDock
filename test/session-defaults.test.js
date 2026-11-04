const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

// sessionDefaults imports modelSelection: both are transpiled and linked by a local require.
function load(file, modules = {}) {
  const out = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const ctx = { exports: {}, require: (name) => modules[name] };
  vm.runInNewContext(out, ctx);
  return ctx.exports;
}
const selection = load("src/lib/modelSelection.ts");
const { rememberedChoice, recordChoice } = load("src/lib/sessionDefaults.ts", {
  "./modelSelection": selection,
});

const effort = (id) => ({ id, label: id });
const options = [
  { id: "fixture-large", label: "Fixture Large", aliases: [], efforts: [effort("low"), effort("medium"), effort("high")], requiresEffort: false },
  { id: "fixture-small", label: "Fixture Small", aliases: [], efforts: [], requiresEffort: false },
];
const plain = (value) => JSON.parse(JSON.stringify(value));

test("new chat: without the option on or without a saved choice, uses the CLI default", () => {
  const saved = { claude: { model: "fixture-large", effort: "medium", permission: "full" } };
  assert.equal(rememberedChoice(false, saved, "claude", options), null);
  assert.equal(rememberedChoice(undefined, saved, "claude", options), null);
  assert.equal(rememberedChoice(true, saved, "codex", options), null);
  assert.equal(rememberedChoice(true, undefined, "claude", options), null);
});

test("new chat: repeats model, level and full access of the last conversation of the same CLI", () => {
  const saved = { claude: { model: "fixture-large", effort: "medium", permission: "full" } };
  assert.deepEqual(plain(rememberedChoice(true, saved, "claude", options)), {
    model: "fixture-large",
    effort: "medium",
    permission: "full",
  });
});

test("new chat: a model outside the catalog goes back to the CLI default and keeps the permission", () => {
  const saved = { codex: { model: "removed-model", effort: "high", permission: "edits" } };
  assert.deepEqual(plain(rememberedChoice(true, saved, "codex", options)), {
    model: "",
    effort: "",
    permission: "edits",
  });
});

test("new chat: a level the model doesn't accept is dropped and an invalid permission becomes the global one", () => {
  const saved = { antigravity: { model: "fixture-small", effort: "high", permission: "bogus" } };
  assert.deepEqual(plain(rememberedChoice(true, saved, "antigravity", options)), {
    model: "fixture-small",
    effort: "",
    permission: "inherit",
  });
});

test("saving one CLI's choice doesn't erase the others'", () => {
  const first = recordChoice(undefined, "claude", { model: "a", effort: "low", permission: "ask" });
  const second = recordChoice(first, "codex", { model: "b", effort: "", permission: "full" });
  const third = recordChoice(second, "claude", { model: "c", effort: "high", permission: "full" });
  assert.deepEqual(plain(third), {
    claude: { model: "c", effort: "high", permission: "full" },
    codex: { model: "b", effort: "", permission: "full" },
  });
  assert.deepEqual(plain(first), { claude: { model: "a", effort: "low", permission: "ask" } });
});
