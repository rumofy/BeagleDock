const fs = require("fs");
const path = require("path");
const { findBinary, spawnCli } = require("./platform");

const EDITORS = ["code", "code-insiders", "codium"];

// O alvo vem de texto da IA: só abre o que existe e está dentro do projeto da conversa.
function resolveInsideProject(cwd, target) {
  const root = fs.realpathSync(cwd);
  const wanted = path.resolve(root, String(target || "."));
  let real;
  try {
    real = fs.realpathSync(wanted);
  } catch {
    throw new Error("Arquivo não encontrado no projeto.");
  }
  const relative = path.relative(root, real);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("O arquivo está fora do projeto desta conversa.");
  return { root, real, isDirectory: fs.statSync(real).isDirectory() };
}

const position = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 1_000_000 ? n : undefined;
};

function buildArgs({ root, real, isDirectory }, line, column) {
  if (isDirectory) return [real];
  const l = position(line);
  const c = position(column);
  const spec = l ? `${real}:${l}${c ? `:${c}` : ""}` : real;
  return [root, "--goto", spec];
}

async function openInEditor(
  { cwd, target, line, column },
  { find = findBinary, spawn = spawnCli, fsApi = fs } = {},
) {
  const resolved = resolveInsideProject(cwd, target);
  const editor = EDITORS.find((name) => find(name));
  if (!editor)
    throw new Error(
      "VS Code não encontrado. Instale-o e deixe o comando `code` no PATH.",
    );
  const args = buildArgs(resolved, line, column);
  await new Promise((resolve, reject) => {
    const child = spawn(find(editor), args, {
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
  return { ok: true, editor };
}

module.exports = { openInEditor, resolveInsideProject, buildArgs, EDITORS };
