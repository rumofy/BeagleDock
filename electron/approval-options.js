// Approval options of each CLI, in its native vocabulary. Only offers what the CLI can do:
// Claude Code (permission_suggestions), Codex (app-server decisions) and AGY (allow/deny).
const { oneLine } = require("./activity-labels");
const { t } = require("./i18n");

const ALLOW_ONCE = { id: "allow", get label() { return t("approval.allowOnce"); }, kind: "allow" };
// The note next to a denial only exists where the CLI receives it (Claude Code, in the denial's `message`).
// In Codex and AGY a denial is just yes/no, so the interface doesn't offer the field.
const DENY = { id: "deny", get label() { return t("approval.deny"); }, kind: "deny" };
const DENY_WITH_NOTE = { id: "deny", get label() { return t("approval.deny"); }, kind: "deny", allowsMessage: true };

const SCOPE = {
  session: "approval.scope.session",
  localSettings: "approval.scope.localSettings",
  projectSettings: "approval.scope.projectSettings",
  userSettings: "approval.scope.userSettings",
  cliArg: "approval.scope.cliArg",
};
const MODE = {
  acceptEdits: "approval.mode.acceptEdits",
  plan: "approval.mode.plan",
  default: "approval.mode.default",
  bypassPermissions: "approval.mode.bypassPermissions",
  dontAsk: "approval.mode.dontAsk",
};

function describeClaudeSuggestion(s) {
  const scope = SCOPE[s?.destination] ? t(SCOPE[s.destination]) : "";
  if (s?.type === "addRules" && s.behavior === "allow" && Array.isArray(s.rules) && s.rules.length) {
    const rules = s.rules
      .map((r) => (r?.ruleContent ? `${r.toolName}(${oneLine(r.ruleContent, 80)})` : String(r?.toolName || "")))
      .filter(Boolean)
      .join(", ");
    return rules
      ? { label: t("approval.allowAlways", { rules, scope }).trim(), persistent: s.destination !== "session", danger: s.destination === "userSettings" }
      : null;
  }
  if (s?.type === "addDirectories" && Array.isArray(s.directories) && s.directories.length)
    return {
      label: t("approval.allowAccess", { dirs: s.directories.map((d) => oneLine(d, 80)).join(", "), scope }).trim(),
      persistent: s.destination !== "session",
    };
  if (s?.type === "setMode" && MODE[s.mode])
    return {
      label: `${t(MODE[s.mode])} ${scope}`.trim(),
      persistent: s.destination !== "session",
      danger: s.mode === "bypassPermissions" || s.destination === "userSettings",
    };
  return null; // unknown type: don't offer what we don't know how to apply
}

// Plan approval (Claude Code's ExitPlanMode): approving leaves plan mode and runs right away. The target
// mode (accept edits or full access) is decided by the runner when it answers.
const APPROVE_PLAN = { id: "approve-plan", get label() { return t("approval.approvePlan"); }, kind: "allow" };
const KEEP_PLANNING = { id: "deny", get label() { return t("approval.keepPlanning"); }, kind: "deny", allowsMessage: true };

// What a Claude Code can_use_tool request asks for: "plan" (approve the plan and leave plan mode),
// "question" (AskUserQuestion) or "permission" (run a tool).
function approvalKind(toolName) {
  if (toolName === "ExitPlanMode") return "plan";
  if (toolName === "AskUserQuestion") return "question";
  return "permission";
}

// request: the `request` of Claude Code's can_use_tool control_request.
function claudeApprovalOptions(request) {
  if (request?.tool_name === "ExitPlanMode")
    return { options: [APPROVE_PLAN, KEEP_PLANNING], native: { [APPROVE_PLAN.id]: { exitPlan: true } } };
  const options = [ALLOW_ONCE];
  const native = {};
  (Array.isArray(request?.permission_suggestions) ? request.permission_suggestions : []).forEach((s, i) => {
    const described = describeClaudeSuggestion(s);
    if (!described) return;
    const id = `suggest-${i}`;
    options.push({
      id,
      kind: "allow",
      label: described.label,
      ...(described.persistent ? { persistent: true } : {}),
      ...(described.danger ? { danger: true } : {}),
    });
    native[id] = { updatedPermissions: [s] };
  });
  options.push(DENY_WITH_NOTE);
  return { options, native };
}

const CODEX_COMMAND = "item/commandExecution/requestApproval";
const CODEX_FILE = "item/fileChange/requestApproval";

function codexApprovalOptions(method, params) {
  if (method !== CODEX_COMMAND && method !== CODEX_FILE)
    return { options: [ALLOW_ONCE, DENY], native: {} };
  const isCommand = method === CODEX_COMMAND;
  const options = [
    { id: "accept", label: t("approval.allowOnce"), kind: "allow" },
    {
      id: "acceptForSession",
      label: isCommand ? t("approval.allowCommandSession") : t("approval.allowFilesSession"),
      kind: "allow",
    },
  ];
  const native = {
    accept: { decision: "accept" },
    acceptForSession: { decision: "acceptForSession" },
    decline: { decision: "decline" },
    cancel: { decision: "cancel" },
  };
  const amendment = params?.proposedExecpolicyAmendment;
  if (isCommand && Array.isArray(amendment) && amendment.length && amendment.every((p) => typeof p === "string")) {
    options.push({
      id: "amend",
      label: t("approval.allowCommandsLike", { prefix: oneLine(amendment.join(" "), 80) }),
      kind: "allow",
      persistent: true,
    });
    native.amend = { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: amendment } } };
  }
  options.push(
    { id: "decline", label: t("approval.denyContinue"), kind: "deny" },
    { id: "cancel", label: t("approval.denyStop"), kind: "deny" },
  );
  return { options, native };
}

// Accepts old brokers that only implement ask() (yes/no).
async function askApproval(approvals, request) {
  if (!approvals) return { allow: false };
  if (typeof approvals.askDetailed === "function") return approvals.askDetailed(request);
  return { allow: !!(await approvals.ask(request)) };
}

module.exports = {
  askApproval,
  ALLOW_ONCE,
  APPROVE_PLAN,
  approvalKind,
  DENY,
  DENY_WITH_NOTE,
  claudeApprovalOptions,
  codexApprovalOptions,
  describeClaudeSuggestion,
};
