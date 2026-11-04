const { t } = require("./i18n");
// Pure rules of the ai-memory maintenance (no I/O). The protection rules come from
// shared/memory-rules.mjs, the same source the renderer uses.
const {
  NEVER_DELETE_PREFIXES,
  MERGE_FIRST_PREFIXES,
  PROTECTED_PREFIXES,
  protectionFor,
  isTestProject,
  canPurgeProject,
  deleteConfirmationError,
} = require("../shared/memory-rules.mjs");

function buildMaintenancePrompt({ workspace, project, mode = "plan", maxDeletions = 40 } = {}) {
  const limit = Math.max(0, Math.min(500, Math.floor(Number(maxDeletions)) || 0));
  const plan = mode !== "execute";
  const scope = `workspace="${workspace}", project="${project}"`;
  const lines = [
    t("maintenancePrompt.intro", { project: `${workspace}/${project}`, language: t("maintenancePrompt.language") }),
    "",
    t("maintenancePrompt.rules"),
    t("maintenancePrompt.rule1", { scope }),
    t("maintenancePrompt.rule2"),
    t("maintenancePrompt.rule3"),
    t("maintenancePrompt.rule4"),
    t("maintenancePrompt.rule5", { limit }),
    t("maintenancePrompt.rule6"),
    t("maintenancePrompt.rule7"),
    "",
    t("maintenancePrompt.steps"),
    t("maintenancePrompt.step1", { scope }),
    t("maintenancePrompt.step2", { scope }),
    t("maintenancePrompt.step3", { language: t("maintenancePrompt.languageCode") }),
    t("maintenancePrompt.step4"),
    t("maintenancePrompt.step5"),
    t("maintenancePrompt.step6", { language: t("maintenancePrompt.languageCode") }),
    t("maintenancePrompt.step7"),
    "",
  ];
  if (plan) {
    lines.push(
      t("maintenancePrompt.planMode"),
      t("maintenancePrompt.plan1"),
      t("maintenancePrompt.plan2"),
    );
  } else {
    lines.push(
      t("maintenancePrompt.executeMode"),
      t("maintenancePrompt.execute1", { limit }),
    );
  }
  lines.push(
    "",
    t("maintenancePrompt.summary"),
  );
  return lines.join("\n");
}

module.exports = {
  PROTECTED_PREFIXES,
  NEVER_DELETE_PREFIXES,
  MERGE_FIRST_PREFIXES,
  protectionFor,
  isTestProject,
  canPurgeProject,
  deleteConfirmationError,
  buildMaintenancePrompt,
};
