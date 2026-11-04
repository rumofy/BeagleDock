const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm"),
  ts = require("typescript");
const {
  metadataModels,
  parseAgyRows,
  agyModels,
  resolveModelSelection,
} = require("../electron/model-options");
const compiled = ts.transpileModule(
  fs.readFileSync("src/lib/modelSelection.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;
const context = { exports: {} };
vm.runInNewContext(compiled, context);
const { modelSelection } = context.exports;
const rows =
  "fixture-orbit-economy\tFixture Orbit (Economy)\nfixture-orbit-standard\tFixture Orbit (Standard)\nfixture-orbit-research\tFixture Orbit (Research)\nfixture-solo-agile\tFixture Solo (Agile)";
test("AGY groups models and extracts arbitrary advertised effort names without a bundled list", () => {
  const options = agyModels(parseAgyRows(rows), "Fixture Orbit (Standard)");
  assert.equal(options.length, 2);
  assert.equal(options[0].id, "fixture-orbit");
  assert.equal(options[0].label, "Fixture Orbit");
  assert.deepEqual(
    options[0].efforts.map((e) => e.id),
    ["economy", "standard", "research"],
  );
  assert.equal(options[0].defaultEffort, "standard");
  assert.deepEqual(
    resolveModelSelection(options, "fixture-orbit", "research"),
    { model: "fixture-orbit-research", effort: "" },
  );
  assert.deepEqual(
    resolveModelSelection(options, "Fixture Orbit (Standard)", ""),
    { model: "fixture-orbit-standard", effort: "" },
  );
  const legacy = modelSelection(options, "fixture-orbit-research", "medium");
  assert.equal(legacy.model, "fixture-orbit");
  assert.equal(legacy.effort, "research");
});
test("Claude and Codex levels come from per-model catalogue metadata, including future levels", () => {
  const claude = metadataModels(
    [
      {
        id: "claude-fixture",
        name: "Claude Fixture",
        thinking: { effort_options: [{ id: "future", name: "Future level" }] },
      },
    ],
    "claude",
  );
  assert.deepEqual(
    claude[0].efforts.map((e) => e.id),
    ["future"],
  );
  assert.equal(claude[0].efforts[0].label, "Future level");
  const codex = metadataModels(
    [
      {
        slug: "codex-fixture",
        supported_reasoning_levels: [
          { effort: "ultra", description: "Advertised by CLI" },
        ],
        default_reasoning_level: "ultra",
      },
    ],
    "codex",
  );
  assert.deepEqual(
    codex[0].efforts.map((e) => e.id),
    ["ultra"],
  );
  assert.deepEqual(resolveModelSelection(codex, "codex-fixture", "ultra"), {
    model: "codex-fixture",
    effort: "ultra",
  });
  assert.deepEqual(resolveModelSelection(codex, "codex-fixture", ""), {
    model: "codex-fixture",
    effort: "",
  });
});
test("models without capability metadata offer no invented levels", () => {
  const options = metadataModels([{ id: "unknown-capabilities" }], "claude");
  assert.deepEqual(options[0].efforts, []);
  assert.equal(
    modelSelection(options, "unknown-capabilities", "medium").effort,
    "",
  );
  assert.throws(
    () => resolveModelSelection(options, "unknown-capabilities", "medium"),
    /level/,
  );
  assert.deepEqual(resolveModelSelection([], "configured-model", ""), {
    model: "configured-model",
    effort: "",
  });
  assert.throws(
    () => resolveModelSelection([], "configured-model", "medium"),
    /hasn't reported/,
  );
});
test("a refreshed catalogue replaces removed levels and adds new model capabilities", () => {
  const initial = agyModels(parseAgyRows(rows));
  const refreshed = agyModels(
    parseAgyRows("fixture-orbit-instant\tFixture Orbit (Instant)"),
  );
  assert.equal(
    modelSelection(initial, "fixture-orbit", "research").effort,
    "research",
  );
  assert.equal(
    modelSelection(refreshed, "fixture-orbit", "research").effort,
    "instant",
  );
  assert.throws(
    () => resolveModelSelection(refreshed, "fixture-orbit", "research"),
    /level/,
  );
  assert.equal(refreshed[0].efforts.length, 1);
});
test("plain model ids without advertised effort labels are not split by guessed suffixes", () => {
  const options = agyModels(
    parseAgyRows("fixture-model-pro\tFixture Model Pro"),
  );
  assert.equal(options[0].id, "fixture-model-pro");
  assert.deepEqual(options[0].efforts, []);
});
