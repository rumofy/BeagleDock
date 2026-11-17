// Installs the package built by `npm run build` on this machine, upgrading in place.
// Linux: the .deb through apt (asks for sudo). Windows: the NSIS installer, silently and for the
// current user only (no administrator rights), into %LOCALAPPDATA%\Programs\BeagleDock.
// Conversations and settings live in ~/.beagledock and are kept across upgrades.
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

/** The package `npm run build` writes for this platform (see build.artifactName). */
export function packageFor(platform, ver = version) {
  if (platform === "linux") return `release/BeagleDock-${ver}-linux-amd64.deb`;
  if (platform === "win32") return `release/BeagleDock-${ver}-win-x64.exe`;
  return null;
}

/** Command that installs (or upgrades) that package without questions. */
export function installCommand(platform, rel) {
  if (platform === "linux") return { cmd: "sudo", args: ["apt", "install", "-y", `./${rel}`] };
  // /S: silent; /currentuser: per-user install, which never asks for elevation.
  if (platform === "win32") return { cmd: path.join(root, rel), args: ["/S", "/currentuser"] };
  return null;
}

function main() {
  const rel = packageFor(process.platform);
  if (!rel) {
    console.error(`Local installation isn't available on ${process.platform}.`);
    return 1;
  }
  if (!existsSync(path.join(root, rel))) {
    console.error(`Package not found: ${rel}\nRun \`npm run build\` to build it.`);
    return 1;
  }
  const { cmd, args } = installCommand(process.platform, rel);
  console.log(`Installing ${rel}…`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`The installer failed (${r.status ?? r.error?.message}).`);
    return r.status || 1;
  }
  if (process.platform === "win32") {
    const dir = path.join(process.env.LOCALAPPDATA || "", "Programs", "BeagleDock");
    console.log(`BeagleDock ${version} installed in ${dir} (Start menu: BeagleDock).`);
  } else {
    console.log(`BeagleDock ${version} installed (command: beagledock).`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
