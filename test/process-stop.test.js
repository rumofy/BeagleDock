const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"),
  os = require("os"),
  path = require("path");
const { spawnCli, terminateCli } = require("../electron/platform");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
test("stopping a CLI stops its descendant command without terminating another process group", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bleagle-process-stop-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const leaf =
    "const fs=require('fs');setInterval(()=>fs.appendFileSync(process.argv[1],'x'),20);";
  const parent =
    "const {spawn}=require('child_process');const fs=require('fs');const c=spawn(process.execPath,['-e'," +
    JSON.stringify(leaf) +
    ",process.argv[1]],{stdio:'ignore'});fs.writeFileSync(process.argv[1]+'.pid',String(c.pid));setInterval(()=>{},1000);";
  const firstFile = path.join(root, "first"),
    otherFile = path.join(root, "other");
  const first = spawnCli(process.execPath, ["-e", parent, firstFile], {
      stdio: "ignore",
      detached: process.platform !== "win32",
    }),
    other = spawnCli(process.execPath, ["-e", leaf, otherFile], {
      stdio: "ignore",
      detached: process.platform !== "win32",
    });
  t.after(() => {
    terminateCli(first);
    terminateCli(other);
  });
  for (
    let i = 0;
    i < 150 && (!fs.existsSync(firstFile) || !fs.existsSync(otherFile));
    i++
  )
    await wait(20);
  assert.ok(fs.existsSync(firstFile));
  assert.ok(fs.existsSync(otherFile));
  terminateCli(first);
  await wait(250);
  const size = fs.statSync(firstFile).size,
    otherSize = fs.statSync(otherFile).size;
  await wait(200);
  assert.equal(fs.statSync(firstFile).size, size);
  assert.ok(fs.statSync(otherFile).size > otherSize);
});
