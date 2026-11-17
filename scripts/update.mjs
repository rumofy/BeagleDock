// Updates the installed BeagleDock from this checkout in one step, without uninstalling:
// pulls the current branch (fast-forward only), reinstalls the dependencies, builds the package
// and installs it over the previous version. Conversations and settings in ~/.beagledock stay.
//
//   npm run update             # pull + build + install
//   npm run update -- --no-pull  # build and install what is already checked out
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS = process.platform === "win32";

/** Environment for the build: node-gyp scripts call .bat files from their own folder, which
 * `NoDefaultCurrentDirectoryInExePath` (set by some shells and agents on Windows) forbids. */
export function buildEnv(env = process.env) {
  const out = { ...env };
  for (const key of Object.keys(out)) if (key.toLowerCase() === "nodefaultcurrentdirectoryinexepath") delete out[key];
  return out;
}

/** The steps, in order; `pull` is skipped with --no-pull. */
export function updateSteps({ pull = true } = {}) {
  return [
    ...(pull ? [{ name: "pull", cmd: "git", args: ["pull", "--ff-only"] }] : []),
    { name: "dependencies", cmd: "npm", args: ["ci"] },
    { name: "build", cmd: "npm", args: ["run", "build"] },
    { name: "install", cmd: process.execPath, args: [path.join(root, "scripts", "install-local.mjs")] },
  ];
}

function run({ cmd, args }) {
  // npm is a .cmd script on Windows, which only starts through the shell.
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: buildEnv(), shell: WINDOWS && cmd === "npm" });
  return r.status ?? 1;
}

function hasUpstream() {
  return spawnSync("git", ["rev-parse", "--abbrev-ref", "@{u}"], { cwd: root, stdio: "ignore" }).status === 0;
}

function dirtyTree() {
  const r = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() !== "";
}

function main() {
  let pull = !process.argv.includes("--no-pull");
  if (pull && !hasUpstream()) {
    console.log("This branch doesn't track a remote branch: building what is checked out, without pulling.");
    pull = false;
  }
  if (pull && dirtyTree()) {
    console.error("There are uncommitted changes in this checkout: commit or stash them, or run `npm run update -- --no-pull`.");
    return 1;
  }
  for (const step of updateSteps({ pull })) {
    console.log(`\n== ${step.name}`);
    const status = run(step);
    if (status !== 0) {
      console.error(`Update stopped at "${step.name}" (exit ${status}). The installed version wasn't changed.`);
      return status;
    }
  }
  console.log("\nBeagleDock is up to date.");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
