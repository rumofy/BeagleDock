// Modo terminal: o que acontece na interface da CLI também vai para o histórico do BeagleDock. A
// tela do terminal não serve de fonte (cores, cursor, redesenhos); a fonte é o arquivo da conversa
// que a própria CLI grava (o mesmo que o histórico Ctrl+H já importa). Ao fim de cada resposta, ao
// fechar o terminal e quando a CLI sai, as mensagens novas desse arquivo viram mensagens da conversa.
//
// Só entra o que surgiu depois de o terminal abrir: o que já estava no arquivo veio do chat e já
// está no banco. Conversa nova aberta direto no terminal ainda não tem ID nativo: o Claude Code
// recebe um (`--session-id`); no Codex e no AGY, a conversa criada é achada pela pasta e pela hora.

const dbTime = (ms) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");
const PROVIDER_NAMES = { claude: "Claude Code", codex: "Codex CLI", antigravity: "Antigravity" };
// Folga entre abrir o terminal e a CLI gravar o começo da conversa (relógios, arredondamento).
const DISCOVERY_SLACK_MS = 5000;

function createTerminalHistory({
  // (providerId, nativeId, cwd) => { messages: [{ id, sender, text, modelBadge, timestamp }] }
  readConversation,
  // ({ exclude }) => [{ provider, sessionId, project, timestampMs }] (conversas só da CLI)
  listNative,
  // () => ["provider:nativeId", ...] (já ligadas a conversas do BeagleDock)
  linkedIds = async () => [],
  store,
  emit = () => {},
  now = Date.now,
}) {
  const entries = new Map();

  async function read(providerId, nativeId, cwd) {
    try {
      const conversation = await readConversation(providerId, nativeId, cwd);
      return Array.isArray(conversation?.messages) ? conversation.messages : null;
    } catch {
      return null;
    }
  }

  /** O terminal da conversa abriu: guarda o que já existia para não importar de novo. */
  async function begin({ sessionId, providerId, cwd, nativeId, newNativeId }) {
    const entry = {
      providerId,
      cwd,
      openedAt: now(),
      nativeId: nativeId || null,
      // Claude Code: o ID escolhido na abertura só vale quando a CLI gravar a conversa.
      newNativeId: nativeId ? null : newNativeId || null,
      baseline: new Set(),
      saved: new Set(),
      chain: Promise.resolve(),
    };
    entries.set(sessionId, entry);
    // Uma sincronização pedida antes de o retrato inicial ficar pronto espera por ele: sem isso, o
    // que veio do chat seria importado de novo.
    entry.chain = (async () => {
      if (!entry.nativeId) return;
      const messages = await read(providerId, entry.nativeId, cwd);
      for (const m of messages || []) entry.baseline.add(m.id);
    })().catch(() => {});
    await entry.chain;
    return entry;
  }

  async function findNativeId(sessionId, entry) {
    if (entry.nativeId) return entry.nativeId;
    let found = null;
    if (entry.newNativeId) {
      if (await read(entry.providerId, entry.newNativeId, entry.cwd)) found = entry.newNativeId;
    } else {
      const exclude = await linkedIds().catch(() => []);
      const items = (await listNative({ exclude }).catch(() => [])) || [];
      found =
        items
          .filter(
            (item) =>
              item.provider === entry.providerId &&
              item.project === entry.cwd &&
              Number.isFinite(item.timestampMs) &&
              item.timestampMs >= entry.openedAt - DISCOVERY_SLACK_MS,
          )
          .sort((a, b) => b.timestampMs - a.timestampMs)[0]?.sessionId || null;
    }
    if (!found) return null;
    // Liga a conversa nativa à do BeagleDock: o chat continua a mesma conversa depois.
    await store.setNativeSession(sessionId, entry.providerId, found, entry.cwd);
    entry.nativeId = found;
    return found;
  }

  async function run(sessionId) {
    const entry = entries.get(sessionId);
    if (!entry) return { added: 0 };
    if (store.sessionExists && !(await store.sessionExists(sessionId))) return { added: 0 };
    const nativeId = await findNativeId(sessionId, entry).catch(() => null);
    if (!nativeId) return { added: 0 };
    const messages = (await read(entry.providerId, nativeId, entry.cwd)) || [];
    const fresh = messages.filter((m) => !entry.baseline.has(m.id) && !entry.saved.has(m.id));
    let lastReply = "";
    for (const m of fresh) {
      const parsed = Date.parse(m.timestamp);
      const at = Number.isFinite(parsed) ? parsed : now();
      const user = m.sender === "user";
      await store.saveChatMessage({
        id: `term-${m.id}`,
        sessionId,
        provider: entry.providerId,
        sender: user ? "user" : entry.providerId,
        senderName: user ? "Você" : PROVIDER_NAMES[entry.providerId] || entry.providerId,
        text: String(m.text || ""),
        modelBadge: user ? undefined : m.modelBadge || undefined,
        timestamp: new Date(at).toISOString(),
        createdAt: dbTime(at),
      });
      entry.saved.add(m.id);
      if (!user && m.text) lastReply = String(m.text);
    }
    if (fresh.length) emit("cli-terminal-history", { sessionId, added: fresh.length });
    return { added: fresh.length, lastReply, nativeId };
  }

  /** Grava as mensagens novas da conversa nativa; uma sincronização por vez em cada conversa. */
  function sync(sessionId) {
    const entry = entries.get(sessionId);
    if (!entry) return Promise.resolve({ added: 0 });
    const next = entry.chain.then(() => run(sessionId));
    entry.chain = next.catch(() => {});
    return next.catch(() => ({ added: 0 }));
  }

  /** O terminal fechou ou a CLI saiu: a última sincronização e o fim do acompanhamento. */
  async function end(sessionId) {
    const entry = entries.get(sessionId);
    const result = await sync(sessionId);
    // Reaberto enquanto sincronizava: o acompanhamento novo continua.
    if (entries.get(sessionId) === entry) entries.delete(sessionId);
    return result;
  }

  return { begin, sync, end, has: (sessionId) => entries.has(sessionId) };
}

module.exports = { createTerminalHistory };
