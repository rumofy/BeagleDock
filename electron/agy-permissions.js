const fs = require("fs");
const os = require("os");
const path = require("path");
const { t } = require("./i18n");
const BLOCKED_ACTIONS = [
  "command(*)",
  "unsandboxed(*)",
  "mcp(*)",
  "read_url(*)",
  "execute_url(*)",
];
function settingsPath({ home = os.homedir(), env = process.env } = {}) {
  return path.join(
    env.GEMINI_CLI_HOME || path.join(home, ".gemini"),
    "antigravity-cli",
    "settings.json",
  );
}
function readInheritedPermissions(options) {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath(options), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(
      t("errors.agyPolicyRead"),
    );
  }
  const rules = settings.permissions;
  if (rules === undefined || rules === null) return {};
  if (typeof rules !== "object" || Array.isArray(rules))
    throw new Error(t("errors.agyPolicyInvalid"));
  for (const key of ["deny", "ask", "allow"])
    if (
      rules[key] !== undefined &&
      (!Array.isArray(rules[key]) ||
        rules[key].some((rule) => typeof rule !== "string"))
    )
      throw new Error(t("errors.agyRulesInvalid"));
  return { deny: rules.deny || [], ask: rules.ask || [] };
}
function agyPermissionSettings(
  permission,
  inherited = {},
  interactive = false,
) {
  if (!["plan", "ask", "edits", "full"].includes(permission))
    throw new Error(t("errors.agyPermissionInvalid"));
  const readonly = permission === "plan" || permission === "ask";
  return {
    toolPermission: permission === "full" ? "always-proceed" : "request-review",
    allowNonWorkspaceAccess: permission === "full",
    ...(permission === "full" ? { enableTerminalSandbox: false } : {}),
    permissions: {
      // Do not inherit global grants (including write_file(*) and command(*)).
      // Keep narrower global restrictions; explicit denies take precedence in AGY.
      allow: [],
      ask: [...new Set(inherited.ask || [])],
      deny: [
        ...new Set([
          ...(inherited.deny || []),
          ...(permission === "full" || (permission === "edits" && interactive)
            ? []
            : BLOCKED_ACTIONS),
          ...(readonly ? ["write_file(*)"] : []),
        ]),
      ],
    },
  };
}
module.exports = {
  agyPermissionSettings,
  readInheritedPermissions,
  settingsPath,
};
