const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describeDirectory, startDirectory, pickDirectory } = require("../electron/folder-picker");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-picker-"));

test("describes the folder: name, git and ai-memory", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, ".git"));
  fs.writeFileSync(path.join(dir, ".ai-memory.toml"), "");
  assert.deepEqual(describeDirectory(dir), { path: dir, name: path.basename(dir), hasAIMemory: true, isGitRepo: true });
  const plain = tmp();
  assert.equal(describeDirectory(plain).isGitRepo, false);
  assert.equal(describeDirectory(plain).hasAIMemory, false);
});

test("a file or missing path doesn't become a workspace", () => {
  const dir = tmp();
  const file = path.join(dir, "a.txt");
  fs.writeFileSync(file, "x");
  assert.throws(() => describeDirectory(file), /folder/);
  assert.throws(() => describeDirectory(path.join(dir, "nada")));
});

test("the picker starts at the typed folder, if it exists, or at home", () => {
  const dir = tmp();
  assert.equal(startDirectory(dir), dir);
  assert.equal(startDirectory("/nao/existe", fs, "/home/x"), "/home/x");
  assert.equal(startDirectory(undefined, fs, "/home/x"), "/home/x");
});

test("cancelling the picker returns no path; choosing returns the folder's data", async () => {
  const dir = tmp();
  const calls = [];
  const dialog = (result) => ({ showOpenDialog: async (win, opts) => (calls.push(opts), result) });
  assert.deepEqual(await pickDirectory({ dialog: dialog({ canceled: true, filePaths: [] }) }), { canceled: true });
  const picked = await pickDirectory({ dialog: dialog({ canceled: false, filePaths: [dir] }), defaultPath: dir });
  assert.equal(picked.canceled, false);
  assert.equal(picked.path, dir);
  assert.deepEqual(calls[1].properties, ["openDirectory", "createDirectory"]);
  assert.equal(calls[1].defaultPath, dir);
});
