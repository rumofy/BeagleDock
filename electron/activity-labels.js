const { redact } = require("./redact");
const { t } = require("./i18n");

// Activity labels shown live in the chat. They only describe what the CLI actually emitted;
// unknown types return null instead of making up a state.
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

// Commands that hold their output until the end: the shell only shows something when they finish.
const BUFFERING = /\|\s*(tail|head|sort|wc|tac|uniq)\b/;
function bufferingNote(command) {
  const match = String(command ?? "").match(BUFFERING);
  return match
    ? t("activity.bufferingNote", { tool: match[1] })
    : null;
}

const AGENT_TOOLS = {
  wait: "activity.agentWait",
  sendMessage: "activity.agentMessage",
  sendInput: "activity.agentInput",
  followupTask: "activity.agentTask",
  closeAgent: "activity.agentClose",
  listAgents: "activity.agentList",
  interruptAgent: "activity.agentInterrupt",
  resumeAgent: "activity.agentResume",
};

function codexItemActivity(item) {
  switch (item?.type) {
    case "reasoning":
      return { kind: "reasoning", title: t("activity.reasoning"), activity: t("activity.reasoningNow") };
    case "commandExecution":
      return {
        kind: "command",
        title: t("activity.command"),
        activity: t("activity.commandNow"),
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
        title: t("activity.fileEdit"),
        activity: t("activity.fileEditNow"),
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
        title: t("activity.webSearch"),
        activity: t("activity.webSearchNow"),
        detail: oneLine(item.query),
      };
    case "plan":
      return { kind: "plan", title: t("activity.plan"), activity: t("activity.planNow") };
    case "collabAgentToolCall":
      if (!["spawnAgent", "spawn_agent"].includes(item.tool))
        return {
          kind: "tool",
          title: (AGENT_TOOLS[item.tool] ? t(AGENT_TOOLS[item.tool]) : null) || t("activity.agentOp", { op: item.tool || t("activity.operation") }),
          activity: t("activity.coordinating"),
          detail: oneLine(item.prompt),
        };
      return {
        kind: "agent",
        title: t("activity.agent", { name: item.tool || "" }).trim(),
        activity: t("activity.agent", { name: item.tool || "" }).trim(),
        detail: oneLine(item.prompt),
      };
    case "subAgentActivity":
      return { kind: "agent", title: t("activity.subagent"), activity: t("activity.subagentNow") };
    case "contextCompaction":
      return { kind: "compaction", title: t("activity.compaction"), activity: t("activity.compactionNow") };
    default:
      return null;
  }
}

function claudeToolActivity(block) {
  const input = block?.input || {};
  const name = block?.name || "";
  // The plan Claude Code proposes when leaving plan mode: shown in full in the conversation (and
  // kept in the history), not just as a step name.
  if (name === "ExitPlanMode" && typeof input.plan === "string" && input.plan.trim())
    return {
      kind: "plan",
      title: t("activity.proposedPlan"),
      activity: t("activity.proposedPlanNow"),
      detail: "",
      text: input.plan,
      proposal: true,
      note: null,
    };
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
      ? t("activity.agent", { name: input.subagent_type || "" }).trim()
      : name,
    activity: t("activity.tool", { name: block?.name || "" }).trim(),
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

// Reasoning relay window: the text grows with every token; the label only needs the end.
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
