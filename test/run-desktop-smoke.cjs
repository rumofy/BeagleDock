const fs = require("fs"),
  os = require("os"),
  path = require("path"),
  { spawnSync } = require("child_process");
if (!["linux", "win32"].includes(process.platform))
  throw new Error(
    "Desktop smoke runs on Linux and Windows; use unit tests elsewhere.",
  );
const WINDOWS = process.platform === "win32";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-desktop-smoke-"));
const bin = path.join(root, ".local", "bin");
fs.mkdirSync(bin, { recursive: true });
const skillDir = path.join(root, ".agents", "skills", "smoke-skill");
fs.mkdirSync(skillDir, { recursive: true });
fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: smoke-skill\ndescription: Desktop selection fixture\n---\n");
const fixture = fs.readFileSync(
  path.join(__dirname, "cli-fixture.cjs"),
  "utf8",
);
for (const name of ["claude", "codex", "agy"]) {
  if (WINDOWS) {
    // Windows starts scripts through a .cmd launcher, like the npm-installed CLIs.
    fs.writeFileSync(path.join(bin, `${name}.js`), fixture);
    fs.writeFileSync(path.join(bin, `${name}.cmd`), `@node "%~dp0${name}.js" %*\r\n`);
    continue;
  }
  const file = path.join(bin, name);
  fs.writeFileSync(file, "#!/usr/bin/env node\n" + fixture);
  fs.chmodSync(file, 0o755);
}
const env = {
  ...process.env,
  HOME: root,
  // os.homedir() reads USERPROFILE on Windows; the CLIs' and app's folders live under it.
  ...(WINDOWS
    ? {
        USERPROFILE: root,
        APPDATA: path.join(root, "AppData", "Roaming"),
        LOCALAPPDATA: path.join(root, "AppData", "Local"),
      }
    : {}),
  BEAGLEDOCK_DATA_DIR: path.join(root, "data"),
  CODEX_HOME: path.join(root, ".codex"),
  CLAUDE_CONFIG_DIR: path.join(root, ".claude"),
  BEAGLEDOCK_SMOKE_ROOT: root,
  PATH: bin + path.delimiter + process.env.PATH,
};
delete env.ELECTRON_RUN_AS_NODE;
// Electron refuses to start when APPDATA points to a folder that doesn't exist.
if (WINDOWS) for (const dir of [env.APPDATA, env.LOCALAPPDATA]) fs.mkdirSync(dir, { recursive: true });
// Real dictation diagnosis: reuses already downloaded models (without downloading 669 MB in the test).
if (process.env.BEAGLEDOCK_SMOKE_SPEECH_MODELS) {
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.symlinkSync(path.resolve(process.env.BEAGLEDOCK_SMOKE_SPEECH_MODELS), path.join(root, "data", "models"), WINDOWS ? "junction" : "dir");
}
// Phone access on a port the system picks, so the smoke never collides with a running BeagleDock.
fs.mkdirSync(path.join(root, "data"), { recursive: true });
fs.writeFileSync(path.join(root, "data", "remote-access.json"), JSON.stringify({ port: 0 }));
try {
  for (const stage of ["first", "restart", "projects"]) {
    const result = spawnSync(
      require("electron"),
      [path.join(__dirname, stage === "projects" ? "cli-project-smoke.cjs" : "electron-smoke.cjs"), stage],
      { env: stage === "projects" ? { ...env, BEAGLEDOCK_DATA_DIR: path.join(root, "project-data") } : env, stdio: "inherit", timeout: 115000 },
    );
    if (result.status !== 0)
      throw new Error(
        `Desktop ${stage} failed (${result.status}): ${result.error?.message || ""}`,
      );
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
