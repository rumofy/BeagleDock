const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

// sessionDefaults importa modelSelection: os dois são transpilados e ligados por um require local.
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

test("chat novo: sem a opção ligada ou sem escolha guardada, usa o padrão da CLI", () => {
  const saved = { claude: { model: "fixture-large", effort: "medium", permission: "full" } };
  assert.equal(rememberedChoice(false, saved, "claude", options), null);
  assert.equal(rememberedChoice(undefined, saved, "claude", options), null);
  assert.equal(rememberedChoice(true, saved, "codex", options), null);
  assert.equal(rememberedChoice(true, undefined, "claude", options), null);
});

test("chat novo: repete modelo, nível e acesso total da última conversa da mesma CLI", () => {
  const saved = { claude: { model: "fixture-large", effort: "medium", permission: "full" } };
  assert.deepEqual(plain(rememberedChoice(true, saved, "claude", options)), {
    model: "fixture-large",
    effort: "medium",
    permission: "full",
  });
});

test("chat novo: modelo fora do catálogo volta ao padrão da CLI e mantém a permissão", () => {
  const saved = { codex: { model: "removed-model", effort: "high", permission: "edits" } };
  assert.deepEqual(plain(rememberedChoice(true, saved, "codex", options)), {
    model: "",
    effort: "",
    permission: "edits",
  });
});

test("chat novo: nível que o modelo não aceita é descartado e permissão inválida vira a global", () => {
  const saved = { antigravity: { model: "fixture-small", effort: "high", permission: "bogus" } };
  assert.deepEqual(plain(rememberedChoice(true, saved, "antigravity", options)), {
    model: "fixture-small",
    effort: "",
    permission: "inherit",
  });
});

test("guardar a escolha de uma CLI não apaga a das outras", () => {
  const first = recordChoice(undefined, "claude", { model: "a", effort: "low", permission: "ask" });
  const second = recordChoice(first, "codex", { model: "b", effort: "", permission: "full" });
  const third = recordChoice(second, "claude", { model: "c", effort: "high", permission: "full" });
  assert.deepEqual(plain(third), {
    claude: { model: "c", effort: "high", permission: "full" },
    codex: { model: "b", effort: "", permission: "full" },
  });
  assert.deepEqual(plain(first), { claude: { model: "a", effort: "low", permission: "ask" } });
});
