const fs = require("fs"),
  os = require("os"),
  path = require("path"),
  { spawnSync } = require("child_process");
if (process.platform !== "linux")
  throw new Error(
    "Desktop smoke currently runs on Linux; use unit tests elsewhere.",
  );
const root = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-desktop-smoke-"));
const bin = path.join(root, ".local", "bin");
fs.mkdirSync(bin, { recursive: true });
const fixture = fs.readFileSync(
  path.join(__dirname, "cli-fixture.cjs"),
  "utf8",
);
for (const name of ["claude", "codex", "agy"]) {
  const file = path.join(bin, name);
  fs.writeFileSync(file, "#!/usr/bin/env node\n" + fixture);
  fs.chmodSync(file, 0o755);
}
const env = {
  ...process.env,
  HOME: root,
  BEAGLEDOCK_DATA_DIR: path.join(root, "data"),
  CODEX_HOME: path.join(root, ".codex"),
  CLAUDE_CONFIG_DIR: path.join(root, ".claude"),
  BEAGLEDOCK_SMOKE_ROOT: root,
  PATH: bin + path.delimiter + process.env.PATH,
};
delete env.ELECTRON_RUN_AS_NODE;
try {
  for (const stage of ["first", "restart"]) {
    const result = spawnSync(
      require("electron"),
      [path.join(__dirname, "electron-smoke.cjs"), stage],
      { env, stdio: "inherit", timeout: 50000 },
    );
    if (result.status !== 0)
      throw new Error(
        `Desktop ${stage} failed (${result.status}): ${result.error?.message || ""}`,
      );
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
