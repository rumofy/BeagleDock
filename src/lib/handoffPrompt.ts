import { t } from "../i18n";

// Request sent to the CLI by the /handoff shortcut. It doesn't start with "/" so Claude Code doesn't
// treat it as a command; the ai-memory handoff skill does the actual work. Written in the interface
// language, so the AI answers in it.
export const handoffPrompt = () => t("prompt.handoff");
