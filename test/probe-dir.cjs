// Temporary folder for tests with a real CLI (Claude Code, Codex, Antigravity).
// Its `.ai-memory.toml` makes the sessions land in the single `beagledock-probes` project instead of
// creating a new ai-memory project for every folder.
// Uso no terminal: `cd "$(node test/probe-dir.cjs issue58)"`.
const fs = require("fs");
const os = require("os");
const path = require("path");

const PROBE_MARKER = 'workspace = "default"\nproject = "beagledock-probes"\n';

function makeProbeDir(name = "probe") {
  const safe = String(name).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40) || "probe";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `beagledock-${safe}-`));
  fs.writeFileSync(path.join(dir, ".ai-memory.toml"), PROBE_MARKER);
  return dir;
}

module.exports = { PROBE_MARKER, makeProbeDir };

if (require.main === module) process.stdout.write(makeProbeDir(process.argv[2]) + "\n");
