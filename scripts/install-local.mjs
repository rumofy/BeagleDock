import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const rel = `release/BeagleDock-${version}-linux-amd64.deb`;

if (!existsSync(path.join(root, rel))) {
  console.error(`Package not found: ${rel}\nRun \`npm run build\` to build it.`);
  process.exit(1);
}
const r = spawnSync("sudo", ["apt", "install", `./${rel}`], { cwd: root, stdio: "inherit" });
process.exit(r.status ?? 1);
