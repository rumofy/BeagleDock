const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require("typescript");
const out = ts.transpileModule(fs.readFileSync(path.resolve("src/lib/drafts.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const ctx = { exports: {}, JSON, Object, Array, Math };
vm.runInNewContext(out, ctx);
const { loadDrafts, updateDraft, DRAFTS_KEY } = ctx.exports;
const plain = (v) => JSON.parse(JSON.stringify(v));
const memory = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), data };
};

test("a draft is kept per conversation and disappears when the text becomes empty", () => {
  const storage = memory();
  let drafts = updateDraft({}, "a", "olá", storage);
  drafts = updateDraft(drafts, "b", "outro", storage);
  assert.deepEqual(plain(drafts), { a: "olá", b: "outro" });
  assert.deepEqual(plain(loadDrafts(storage)), { a: "olá", b: "outro" });
  drafts = updateDraft(drafts, "a", "   ", storage);
  assert.deepEqual(plain(loadDrafts(storage)), { b: "outro" });
});

test("missing, blocked or corrupted storage doesn't break the chat", () => {
  assert.deepEqual(plain(loadDrafts(undefined)), {});
  assert.deepEqual(plain(loadDrafts({ getItem: () => "{lixo", setItem() {} })), {});
  assert.deepEqual(plain(loadDrafts({ getItem: () => "[1,2]", setItem() {} })), {});
  const blocked = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  assert.deepEqual(plain(updateDraft({}, "a", "texto", blocked)), { a: "texto" });
});

test("limits count and size and drops the oldest", () => {
  const storage = memory();
  let drafts = {};
  for (let i = 0; i < 70; i++) drafts = updateDraft(drafts, `s${i}`, "x", storage);
  const ids = Object.keys(drafts);
  assert.equal(ids.length, 60);
  assert.equal(ids[0], "s10");
  assert.equal(updateDraft({}, "big", "y".repeat(30000), storage).big.length, 20000);
  assert.ok(storage.data.has(DRAFTS_KEY));
});

test("without a given storage it doesn't save on every key; saving is a separate call", () => {
  const { saveDrafts } = ctx.exports;
  let writes = 0;
  const storage = { getItem: () => null, setItem: () => writes++ };
  let drafts = updateDraft({}, "a", "olá");
  drafts = updateDraft(drafts, "a", "olá mundo");
  assert.equal(writes, 0);
  saveDrafts(drafts, storage);
  assert.equal(writes, 1);
  assert.doesNotThrow(() => saveDrafts(drafts, { getItem: () => null, setItem: () => { throw new Error("cota"); } }));
  assert.doesNotThrow(() => saveDrafts(drafts, undefined));
});
