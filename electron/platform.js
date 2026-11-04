const fs = require("fs");
const os = require("os");
const path = require("path");
const crossSpawn = require("cross-spawn");
const { t } = require("./i18n");

function binaryDirs(
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
) {
  const p = platform === "win32" ? path.win32 : path;
  const dirs =
    platform === "win32"
      ? [
          p.join(env.APPDATA || p.join(home, "AppData", "Roaming"), "npm"),
          p.join(
            env.LOCALAPPDATA || p.join(home, "AppData", "Local"),
            "Microsoft",
            "WinGet",
            "Links",
          ),
          p.join(home, ".local", "bin"),
          p.join(home, ".cargo", "bin"),
        ]
      : [
          p.join(home, ".local", "bin"),
          p.join(home, ".cargo", "bin"),
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
          "/bin",
        ];
  return [
    ...new Set(
      [
        ...(env.PATH || env.Path || "").split(platform === "win32" ? ";" : ":"),
        ...dirs,
      ].filter(Boolean),
    ),
  ];
}
function findBinary(
  name,
  { platform = process.platform, env = process.env, home = os.homedir() } = {},
) {
  if (!/^[a-z0-9-]+$/i.test(name)) return null;
  const p = platform === "win32" ? path.win32 : path;
  const extensions = platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of binaryDirs(platform, env, home)) {
    for (const ext of extensions) {
      const candidate = p.join(dir, name + ext);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        fs.accessSync(
          candidate,
          platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
        );
        return candidate;
      } catch {}
    }
  }
  return null;
}
function cliEnv() {
  return {
    ...process.env,
    PATH: binaryDirs().join(path.delimiter),
    FORCE_COLOR: "0",
  };
}
function spawnCli(bin, args, options = {}) {
  return crossSpawn(bin, args, {
    windowsHide: true,
    ...options,
    env: { ...cliEnv(), ...options.env },
  });
}
function execCli(bin, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnCli(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "",
      stderr = "",
      bytes = 0;
    let settled = false;
    const done = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    };
    const timer = setTimeout(() => {
      child.kill();
      done(new Error(t("errors.cliQueryTimeout")));
    }, options.timeout || 10000);
    for (const [stream, append] of [
      [child.stdout, (c) => (stdout += c)],
      [child.stderr, (c) => (stderr += c)],
    ]) {
      stream.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > (options.maxBuffer || 10 * 1024 * 1024)) {
          child.kill();
          done(new Error(t("errors.cliOutputLimit")));
        } else append(chunk.toString());
      });
    }
    child.on("error", done);
    child.on("close", (code) =>
      done(
        code === 0
          ? null
          : new Error(stderr.trim() || t("errors.cliExited", { code })),
      ),
    );
  });
}
function shellSpec(platform = process.platform, env = process.env) {
  if (platform === "win32")
    return {
      bin: env.ComSpec || env.COMSPEC || "cmd.exe",
      args: [],
      fallbackArgs: [],
    };
  const bin = env.SHELL || (platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  return { bin, args: ["-l"], fallbackArgs: ["-i"] };
}
function validCwd(cwd) {
  const target = cwd || os.homedir();
  if (!path.isAbsolute(target) || !fs.statSync(target).isDirectory())
    throw new Error(t("errors.pickWorkdir"));
  return target;
}
// Terminate only the process tree created for this CLI invocation.
function terminateCli(child) {
  if (!child) return;
  if (!child.spawnfile || !Number.isInteger(child.pid) || child.pid <= 0) {
    try {
      child.kill();
    } catch {}
    return;
  }
  if (process.platform === "win32") {
    const taskkill = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "taskkill.exe",
    );
    const killer = crossSpawn(
      taskkill,
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, stdio: "ignore" },
    );
    killer.on("error", () => {
      try {
        child.kill();
      } catch {}
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill();
    } catch {}
    return;
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }, 1000);
  timer.unref();
}
module.exports = {
  binaryDirs,
  findBinary,
  spawnCli,
  terminateCli,
  execCli,
  shellSpec,
  validCwd,
  cliEnv,
};
