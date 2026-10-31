// Opções de aprovação de cada CLI, no vocabulário nativo dela. Só oferece o que a CLI sabe fazer:
// Claude Code (permission_suggestions), Codex (decisões do app-server) e AGY (permitir/negar).
const { oneLine } = require("./activity-labels");

const ALLOW_ONCE = { id: "allow", label: "Permitir uma vez", kind: "allow" };
// A instrução junto da negação só existe onde a CLI a recebe (Claude Code, no `message` da negação).
// No Codex e no AGY a negação é só sim/não, então a interface não oferece o campo.
const DENY = { id: "deny", label: "Negar", kind: "deny" };
const DENY_WITH_NOTE = { ...DENY, allowsMessage: true };

const SCOPE = {
  session: "nesta sessão",
  localSettings: "neste projeto (arquivo local, não versionado)",
  projectSettings: "neste projeto (arquivo compartilhado)",
  userSettings: "em todos os projetos",
  cliArg: "nesta execução",
};
const MODE = {
  acceptEdits: "Aceitar edições automaticamente",
  plan: "Entrar no modo de plano",
  default: "Voltar ao modo padrão",
  bypassPermissions: "Ignorar todas as permissões",
  dontAsk: "Não perguntar de novo",
};

function describeClaudeSuggestion(s) {
  const scope = SCOPE[s?.destination] || "";
  if (s?.type === "addRules" && s.behavior === "allow" && Array.isArray(s.rules) && s.rules.length) {
    const rules = s.rules
      .map((r) => (r?.ruleContent ? `${r.toolName}(${oneLine(r.ruleContent, 80)})` : String(r?.toolName || "")))
      .filter(Boolean)
      .join(", ");
    return rules
      ? { label: `Permitir sempre ${rules} ${scope}`.trim(), persistent: s.destination !== "session", danger: s.destination === "userSettings" }
      : null;
  }
  if (s?.type === "addDirectories" && Array.isArray(s.directories) && s.directories.length)
    return {
      label: `Permitir acesso a ${s.directories.map((d) => oneLine(d, 80)).join(", ")} ${scope}`.trim(),
      persistent: s.destination !== "session",
    };
  if (s?.type === "setMode" && MODE[s.mode])
    return {
      label: `${MODE[s.mode]} ${scope}`.trim(),
      persistent: s.destination !== "session",
      danger: s.mode === "bypassPermissions" || s.destination === "userSettings",
    };
  return null; // tipo desconhecido: não oferece o que não sabemos aplicar
}

// request: o `request` do control_request can_use_tool do Claude Code.
function claudeApprovalOptions(request) {
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
    { id: "accept", label: "Permitir uma vez", kind: "allow" },
    {
      id: "acceptForSession",
      label: isCommand ? "Permitir este comando nesta sessão" : "Permitir alterações nestes arquivos nesta sessão",
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
      label: `Permitir sempre comandos como: ${oneLine(amendment.join(" "), 80)}`,
      kind: "allow",
      persistent: true,
    });
    native.amend = { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: amendment } } };
  }
  options.push(
    { id: "decline", label: "Negar e continuar", kind: "deny" },
    { id: "cancel", label: "Negar e interromper o turno", kind: "deny" },
  );
  return { options, native };
}

// Aceita brokers antigos que só implementam ask() (sim/não).
async function askApproval(approvals, request) {
  if (!approvals) return { allow: false };
  if (typeof approvals.askDetailed === "function") return approvals.askDetailed(request);
  return { allow: !!(await approvals.ask(request)) };
}

module.exports = {
  askApproval,
  ALLOW_ONCE,
  DENY,
  DENY_WITH_NOTE,
  claudeApprovalOptions,
  codexApprovalOptions,
  describeClaudeSuggestion,
};
