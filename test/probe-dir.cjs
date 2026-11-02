// Pasta temporária para testes com CLI real (Claude Code, Codex, Antigravity).
// O `.ai-memory.toml` faz as sessões caírem no projeto único `beagledock-probes` em vez de
// criar um projeto novo no ai-memory para cada pasta.
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
