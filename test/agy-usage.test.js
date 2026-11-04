const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const { parseUsageReport, createAgyUsage } = require("../electron/agy-usage");
const ts = require("typescript");
const compiled = ts.transpileModule(
  fs.readFileSync(path.resolve("src/lib/agyQuota.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;
const moduleContext = { exports: {} };
vm.runInNewContext(compiled, moduleContext);
const { quotaForGeminiModels } = moduleContext.exports;
const now = Date.parse("2026-10-30T20:00:00Z"),
  reset = new Date(now + 3600000).toISOString();
const report = (groups) =>
  JSON.stringify({
    status: "SUCCESS",
    num_turns: 0,
    command: { name: "usage", data: { groups } },
  });
const groups = [
  {
    name: "Gemini Models",
    buckets: [
      {
        id: "gemini-5h",
        window: "5h",
        remaining_fraction: 0.8,
        reset_time: reset,
      },
      {
        id: "gemini-weekly",
        window: "weekly",
        remaining_fraction: 0.9,
        reset_time: reset,
      },
    ],
  },
  {
    name: "Claude and GPT models",
    buckets: [
      { id: "3p-5h", window: "5h", remaining_fraction: 0.4, reset_time: reset },
      {
        id: "3p-weekly",
        window: "weekly",
        remaining_fraction: 0.5,
        reset_time: reset,
      },
    ],
  },
  {
    name: "Gemini 4 Argon",
    buckets: [
      {
        id: "gemini-argon-wtu-weekly",
        window: "weekly",
        remaining_fraction: 0.1,
        reset_time: reset,
      },
    ],
  },
];
test("AGY /usage percentages come from remaining fractions and retain each pool/window", () => {
  const value = parseUsageReport(report(groups), now);
  assert.equal(value.groups.length, 3);
  assert.equal(value.window5hPercent, 60);
  assert.equal(value.weeklyPercent, 90);
  assert.equal(value.groups[2].window5hPercent, null);
  assert.equal(value.updatedAt, new Date(now).toISOString());
  assert.equal(value.stale, false);
});
test("unknown, disabled, invalid and expired buckets never become fabricated usage", () => {
  const value = parseUsageReport(
    report([
      {
        name: "pool",
        buckets: [
          { window: "5h", remaining_fraction: 0 },
          { window: "weekly", remaining_fraction: 1 },
          { window: "5h", remaining_fraction: 0, disabled: true },
        ],
      },
    ]),
    now,
  );
  assert.equal(value.window5hPercent, 100);
  assert.equal(value.weeklyPercent, 0);
  for (const bucket of [
    { window: "5h" },
    { window: "5h", remaining_fraction: null },
    { window: "5h", remaining_fraction: "0.5" },
    { window: "5h", remaining_fraction: -1 },
    { window: "5h", remaining_fraction: 2 },
    {
      window: "5h",
      remaining_fraction: 0.1,
      reset_time: new Date(now - 1).toISOString(),
    },
    { window: "5h", remaining_fraction: 0.1, disabled: true },
  ])
    assert.throws(
      () =>
        parseUsageReport(report([{ name: "pool", buckets: [bucket] }]), now),
      /known/,
    );
  assert.throws(
    () =>
      parseUsageReport(
        JSON.stringify({ status: "SUCCESS", response: "not a usage command" }),
        now,
      ),
    /report/,
  );
});
test("visible AGY summary uses Gemini Models even when other pools have higher usage", () => {
  const value = parseUsageReport(report(groups), now);
  const summary = quotaForGeminiModels(value);
  assert.equal(summary.window5hPercent, 20);
  assert.equal(summary.weeklyPercent, 10);
  assert.equal(summary.groupLabel, "Gemini Models");
  assert.equal(summary.groups.length, 3);
  const missing = quotaForGeminiModels({
    ...value,
    groups: value.groups.filter((group) => group.name !== "Gemini Models"),
  });
  assert.equal(missing.window5hPercent, null);
  assert.equal(missing.weeklyPercent, null);
});

test("AGY usage polling is coalesced, cached, has bounded execution and never sends a model prompt", async () => {
  let time = now,
    calls = [];
  const reader = createAgyUsage({
    now: () => time,
    find: () => "/fixture/agy",
    exec: async (bin, args, options) => {
      calls.push({ args, options });
      return {
        stdout: args[0] === "--version" ? "agy 1.4.12" : report(groups),
      };
    },
  });
  const [a, b] = await Promise.all([reader.get(), reader.get()]);
  assert.equal(a.groups.length, 3);
  assert.equal(b.groups.length, 3);
  assert.equal(calls.length, 2);
  await reader.get();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args, ["-p", "/usage", "--output-format", "json"]);
  assert.equal(calls[1].options.timeout, 20000);
  assert.equal(calls[1].options.env.AGY_CLI_DISABLE_AUTO_UPDATE, "true");
  time += 45001;
  await reader.get();
  assert.equal(calls.length, 4);
});
test("old AGY versions never receive /usage as a possible model prompt", async () => {
  const calls = [];
  const reader = createAgyUsage({
    now: () => now,
    find: () => "/fixture",
    exec: async (bin, args) => {
      calls.push(args);
      return { stdout: "agy 1.1.10" };
    },
  });
  const value = await reader.get();
  assert.equal(calls.length, 1);
  assert.equal(value.window5hPercent, null);
  assert.match(value.quotaError, /Update/);
});
test("failed refresh keeps timestamp and marks old readings stale; expired windows become unknown", async () => {
  let time = now,
    fail = false;
  const reader = createAgyUsage({
    now: () => time,
    find: () => "/fixture",
    exec: async (bin, args) => {
      if (args[0] === "--version") return { stdout: "agy 1.4.12" };
      if (fail) throw new Error("must not expose stderr");
      return { stdout: report(groups) };
    },
  });
  const first = await reader.get();
  fail = true;
  time += 45001;
  const stale = await reader.get();
  assert.equal(stale.stale, true);
  assert.equal(stale.updatedAt, first.updatedAt);
  assert.equal(stale.window5hPercent, 60);
  assert.doesNotMatch(stale.quotaError, /stderr/);
  time = now + 3600001;
  const expired = await reader.get();
  assert.equal(expired.window5hPercent, null);
  assert.equal(expired.weeklyPercent, null);
});
