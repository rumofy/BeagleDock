const { redact } = require("./redact");

// Rótulos de atividade exibidos ao vivo no chat. Só descrevem o que a CLI realmente emitiu;
// tipos desconhecidos retornam null em vez de inventar um estado.
const oneLine = (value, max = 140) => {
  const text = redact(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
};
const argsSummary = (args) => {
  if (args == null) return "";
  if (typeof args === "string") return oneLine(args);
  try {
    return oneLine(JSON.stringify(args));
  } catch {
    return "";
  }
};

// Comandos que guardam a saída até o fim: o shell só mostra algo quando terminam.
const BUFFERING = /\|\s*(tail|head|sort|wc|tac|uniq)\b/;
function bufferingNote(command) {
  const match = String(command ?? "").match(BUFFERING);
  return match
    ? `a saída só aparece quando o comando termina (| ${match[1]} guarda tudo até o fim)`
    : null;
}

function codexItemActivity(item) {
  switch (item?.type) {
    case "reasoning":
      return { kind: "reasoning", title: "Raciocínio", activity: "Raciocinando…" };
    case "commandExecution":
      return {
        kind: "command",
        title: "Comando",
        activity: "Executando comando…",
        detail: oneLine(item.command),
        note: bufferingNote(item.command),
      };
    case "mcpToolCall":
      return {
        kind: "mcp",
        title: `MCP ${[item.server, item.tool].filter(Boolean).join("/")}`,
        activity: `MCP ${[item.server, item.tool].filter(Boolean).join("/")}`,
        detail: argsSummary(item.arguments),
      };
    case "dynamicToolCall":
      return {
        kind: "tool",
        title: `Ferramenta ${item.tool || ""}`.trim(),
        activity: `Ferramenta ${item.tool || ""}`.trim(),
        detail: argsSummary(item.arguments),
      };
    case "fileChange":
      return {
        kind: "file",
        title: "Edição de arquivos",
        activity: "Editando arquivos…",
        detail: oneLine(
          (Array.isArray(item.changes) ? item.changes : [])
            .map((c) => c?.path)
            .filter(Boolean)
            .slice(0, 3)
            .join(", "),
        ),
      };
    case "webSearch":
      return {
        kind: "web",
        title: "Pesquisa na web",
        activity: "Pesquisando na web…",
        detail: oneLine(item.query),
      };
    case "plan":
      return { kind: "plan", title: "Plano", activity: "Atualizando o plano…" };
    case "collabAgentToolCall":
      if (!["spawnAgent", "spawn_agent"].includes(item.tool))
        return {
          kind: "tool",
          title: ({ wait: "Aguardando agente", sendMessage: "Mensagem ao agente", sendInput: "Instrução ao agente", followupTask: "Nova tarefa do agente", closeAgent: "Encerrando agente", listAgents: "Consultando agentes", interruptAgent: "Interrompendo agente", resumeAgent: "Retomando agente" })[item.tool] || `Agente: ${item.tool || "operação"}`,
          activity: "Coordenando agentes…",
          detail: oneLine(item.prompt),
        };
      return {
        kind: "agent",
        title: `Agente ${item.tool || ""}`.trim(),
        activity: `Agente ${item.tool || ""}`.trim(),
        detail: oneLine(item.prompt),
      };
    case "subAgentActivity":
      return { kind: "agent", title: "Subagente", activity: "Subagente em atividade" };
    case "contextCompaction":
      return { kind: "compaction", title: "Compactação de contexto", activity: "Compactando o contexto…" };
    default:
      return null;
  }
}

function claudeToolActivity(block) {
  const input = block?.input || {};
  const name = block?.name || "";
  return {
    kind: /^(bash|shell)$/i.test(name)
      ? "command"
      : /^(task|agent)$/i.test(name)
        ? "agent"
        : /^(write|edit|multiedit|notebookedit)$/i.test(name)
          ? "file"
          : /^(websearch|webfetch)$/i.test(name)
            ? "web"
            : /^mcp__/.test(name)
              ? "mcp"
              : "tool",
    title: /^(task|agent)$/i.test(name)
      ? `Agente ${input.subagent_type || ""}`.trim()
      : name,
    activity: `Ferramenta ${block?.name || ""}`.trim(),
    note: /^(bash|shell)$/i.test(name) ? bufferingNote(input.command) : null,
    detail: oneLine(
      input.command ||
        input.file_path ||
        input.path ||
        input.pattern ||
        input.query ||
        input.description ||
        input.url ||
        "",
    ),
  };
}

// Janela de repasse do raciocínio: o texto cresce a cada token; o rótulo só precisa do final.
function reasoningTail(text, max = 160) {
  const clean = redact(String(text || "")).replace(/\s+/g, " ").trim();
  return clean.length > max ? "…" + clean.slice(-max + 1) : clean;
}

module.exports = {
  codexItemActivity,
  claudeToolActivity,
  bufferingNote,
  reasoningTail,
  oneLine,
};
