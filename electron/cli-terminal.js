// Modo terminal: a CLI roda com a própria interface (TUI) num pty, sem o protocolo estruturado do
// chat. Quem escolhe este modo fica com tudo da CLI (digitação, anexos, plano, aprovações e
// histórico dela); o BeagleDock só abre o processo na conversa certa e repassa teclas e tela.
const PROVIDERS = new Set(["claude", "codex", "antigravity"]);
// Saída guardada por terminal para redesenhar a tela quando a visão é remontada (troca de conversa
// ou painel com vários terminais). O TUI redesenha tudo ao redimensionar, então o fim basta.
const REPLAY_LIMIT = 512 * 1024;

/** Argumentos que abrem a interface da CLI, retomando a conversa nativa quando ela já existe. */
function terminalArgs(providerId, nativeId) {
  if (!PROVIDERS.has(providerId)) throw new Error("CLI desconhecida.");
  if (!nativeId) return [];
  // Nunca começa com "-": viraria uma opção da CLI em vez do id da conversa.
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_-]{7,159}$/.test(nativeId)) throw new Error("ID nativo inválido.");
  if (providerId === "codex") return ["resume", nativeId];
  if (providerId === "claude") return ["--resume", nativeId];
  return ["--conversation", nativeId];
}

// Marcas da sessão do Claude Code que abriu o BeagleDock (ex.: `npm run dev` dentro dele). Herdadas,
// a CLI do terminal se acha filha daquela sessão e desliga o salvamento da conversa (verificado no
// Claude Code 2.1.317: "Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker").
const INHERITED_SESSION_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_PID",
];

function terminalEnv(base) {
  const env = { ...base, TERM: "xterm-256color", COLORTERM: "truecolor" };
  // O chat desliga as cores; a interface da CLI precisa delas.
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  for (const name of INHERITED_SESSION_VARS) delete env[name];
  return env;
}

function createCliTerminals({
  pty,
  find,
  env = () => process.env,
  checkCwd,
  store,
  // Chamado antes de abrir: recusa se a conversa tem turno rodando no chat e encerra o processo
  // ocioso dele, para as duas formas nunca escreverem na mesma conversa ao mesmo tempo.
  beforeOpen = async () => {},
  emit = () => {},
}) {
  const terminals = new Map();

  function binary(providerId) {
    return providerId === "antigravity" ? find("agy") || find("antigravity") : find(providerId);
  }

  function info(id, entry) {
    return {
      sessionId: id,
      providerId: entry.providerId,
      cwd: entry.cwd,
      pid: entry.pid,
      resumed: entry.resumed,
      exited: entry.exited,
      exitCode: entry.exitCode,
      // Total de caracteres emitidos: a visão descarta eventos já contidos no `replay`.
      end: entry.total,
    };
  }

  // Duas visões abrindo ao mesmo tempo (a grade e a conversa, ou o efeito duplo do React em
  // desenvolvimento) esperam a mesma abertura: nunca dois processos para a mesma conversa.
  const opening = new Map();
  function open(request = {}) {
    const id = request.sessionId;
    if (opening.has(id)) return opening.get(id).then((r) => (r.ok ? reopen(id, r) : r));
    const pending = start(request).finally(() => opening.delete(id));
    if (typeof id === "string") opening.set(id, pending);
    return pending;
  }
  function reopen(id, result) {
    const entry = terminals.get(id);
    return entry ? { ok: true, ...info(id, entry), replay: entry.replay } : result;
  }

  async function start({ sessionId, providerId, cwd, cols, rows } = {}) {
    if (typeof sessionId !== "string" || !sessionId) return { ok: false, error: "Conversa inválida." };
    if (!PROVIDERS.has(providerId)) return { ok: false, error: "CLI desconhecida." };
    const existing = terminals.get(sessionId);
    if (existing && !existing.exited)
      return { ok: true, ...info(sessionId, existing), replay: existing.replay };
    if (!pty) return { ok: false, error: "Terminal indisponível nesta instalação (node-pty não carregou)." };
    try {
      const target = checkCwd(cwd);
      const bin = binary(providerId);
      if (!bin) return { ok: false, error: `CLI ${providerId} não encontrada.` };
      const link = await store.getNativeSession(sessionId, providerId);
      if (link && link.cwd !== target)
        return { ok: false, error: "Esta conversa pertence a outro diretório." };
      await beforeOpen(sessionId);
      const args = terminalArgs(providerId, link?.nativeId);
      const proc = pty.spawn(bin, args, {
        name: "xterm-256color",
        cols: cols > 0 ? Math.min(cols, 1000) : 100,
        rows: rows > 0 ? Math.min(rows, 500) : 30,
        cwd: target,
        env: terminalEnv(env()),
      });
      const entry = {
        proc,
        pid: proc.pid,
        providerId,
        cwd: target,
        resumed: !!link?.nativeId,
        replay: "",
        total: 0,
        exited: false,
        exitCode: null,
      };
      proc.onData((data) => {
        // Processo antigo (fechado ou substituído) não escreve na tela do atual.
        if (terminals.get(sessionId) !== entry) return;
        entry.replay = (entry.replay + data).slice(-REPLAY_LIMIT);
        entry.total += data.length;
        emit("cli-terminal-data", { sessionId, data, end: entry.total });
      });
      proc.onExit(({ exitCode }) => {
        entry.exited = true;
        entry.exitCode = exitCode;
        if (terminals.get(sessionId) === entry) emit("cli-terminal-exit", { sessionId, exitCode });
      });
      terminals.set(sessionId, entry);
      return { ok: true, ...info(sessionId, entry), replay: "" };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  function write({ sessionId, data } = {}) {
    const entry = terminals.get(sessionId);
    if (!entry || entry.exited || typeof data !== "string") return { ok: false };
    entry.proc.write(data);
    return { ok: true };
  }

  function resize({ sessionId, cols, rows } = {}) {
    const entry = terminals.get(sessionId);
    if (!entry || entry.exited || !(cols > 0) || !(rows > 0)) return { ok: false };
    try {
      entry.proc.resize(Math.min(cols, 1000), Math.min(rows, 500));
    } catch {}
    return { ok: true };
  }

  function close(sessionId) {
    const entry = terminals.get(sessionId);
    if (!entry) return { ok: true };
    terminals.delete(sessionId);
    if (!entry.exited)
      try {
        entry.proc.kill();
      } catch {}
    return { ok: true };
  }

  return {
    open,
    write,
    resize,
    close,
    isOpen: (sessionId) => {
      const entry = terminals.get(sessionId);
      return !!entry && !entry.exited;
    },
    list: () => [...terminals].map(([id, entry]) => info(id, entry)),
    closeAll: () => {
      for (const id of [...terminals.keys()]) close(id);
    },
  };
}

// Formatos de imagem que a CLI sabe ler da área de transferência.
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/**
 * O que o Ctrl+V do terminal faz: com imagem, manda o Ctrl+V cru para a própria CLI ler a área de
 * transferência e anexar; com texto, cola. A API do Electron é assíncrona (`has` e `readText`
 * devolvem Promise; no Electron 45 não existem mais `availableFormats` nem `readImage`): com a
 * versão síncrona, o Ctrl+V falhava em silêncio e nenhuma imagem chegava à CLI.
 */
async function readTerminalClipboard(clipboard) {
  const has = async (type) => {
    try {
      return !!(await clipboard.has(type));
    } catch {
      return false;
    }
  };
  // Uma consulta por vez: várias ao mesmo tempo travam a área de transferência do Electron no X11
  // (verificado no Electron 45). PNG primeiro, que é o formato mais comum de captura de tela.
  let image = false;
  for (const type of IMAGE_TYPES) if ((image = await has(type))) break;
  let text = "";
  if (!image)
    try {
      text = await clipboard.readText();
    } catch {}
  return { image, text: typeof text === "string" ? text : "" };
}

module.exports = { createCliTerminals, terminalArgs, terminalEnv, readTerminalClipboard };
