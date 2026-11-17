const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const load = (name) => import(pathToFileURL(path.join(__dirname, "..", "scripts", name)).href);

test("local install: the package each platform builds and a silent, per-user install", async () => {
  const { packageFor, installCommand } = await load("install-local.mjs");
  assert.equal(packageFor("linux", "1.2.3"), "release/BeagleDock-1.2.3-linux-amd64.deb");
  assert.equal(packageFor("win32", "1.2.3"), "release/BeagleDock-1.2.3-win-x64.exe");
  assert.equal(packageFor("darwin", "1.2.3"), null);
  assert.deepEqual(installCommand("linux", "release/x.deb"), { cmd: "sudo", args: ["apt", "install", "-y", "./release/x.deb"] });
  const win = installCommand("win32", "release/x.exe");
  assert.ok(win.cmd.endsWith(path.join("release", "x.exe")));
  assert.deepEqual(win.args, ["/S", "/currentuser"], "no administrator rights: installs for the current user");
});

test("update: pull, clean dependencies, build and install, in that order", async () => {
  const { updateSteps } = await load("update.mjs");
  assert.deepEqual(updateSteps().map((s) => s.name), ["pull", "dependencies", "build", "install"]);
  assert.deepEqual(updateSteps().find((s) => s.name === "pull").args, ["pull", "--ff-only"]);
  assert.deepEqual(updateSteps({ pull: false }).map((s) => s.name), ["dependencies", "build", "install"]);
  assert.ok(updateSteps().at(-1).args[0].endsWith(path.join("scripts", "install-local.mjs")));
});

test("update: the build environment drops the variable that breaks node-gyp on Windows", async () => {
  const { buildEnv } = await load("update.mjs");
  const env = buildEnv({ PATH: "x", NoDefaultCurrentDirectoryInExePath: "1", NODEFAULTCURRENTDIRECTORYINEXEPATH: "1" });
  assert.deepEqual(env, { PATH: "x" });
});
