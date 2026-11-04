// Guidance sent to the CLIs that accept it (Claude Code: system prompt; Codex: developerInstructions).
// AGY can't receive instructions outside the prompt, so there's only the notice in the timeline.
const LIVE_OUTPUT_GUIDANCE =
  "BeagleDock displays your text and terminal output live. For long-running commands such as tests, builds and installs, preserve incremental stdout/stderr: run the command directly. Do not pipe it through tail, collect it in command substitution, or redirect all output to a file and read it only after completion unless the user explicitly requests that behavior. Summarize the result in chat after the command finishes. This guidance does not grant permissions or override project instructions.";
module.exports = { LIVE_OUTPUT_GUIDANCE };
