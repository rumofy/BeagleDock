# Validation of per-command shells (issue #7)

Each chunk of shell output leaves the backend with a `shellId`: the id of the timeline event of the command that
produced it. The interface reads title, state and agent from there. Output the CLI doesn't let us attribute has no
`shellId` and shows only in the "All" tab; the origin is never made up.

## Real evidence (`node test/native-cli-canary.cjs --parallel`), 2026-10-31

Two commands requested at the same time; each prints `PAR_A_*` / `PAR_B_*` markers.

| CLI | Version | Distinct origin per command | No mixing between tabs | Output without origin |
| --- | --- | --- | --- | --- |
| Codex CLI | 0.166.0 | yes (each command's `exec-…`) | yes | 0 |
| Claude Code | 2.1.316 | yes (each tool's `toolu_…`) | yes | 1 chunk |
| Antigravity | 1.4.12 | yes (each `run_command`'s `step-N`) | yes | 0 |

- Claude Code: a tool's live log is only attributed when exactly one is in progress; with two, that chunk has no
  origin, and each tool's final result arrives with the right origin.
- Antigravity: the async command is a `run_command` step (`step-2`) and the output comes later through
  `manage_task`, whose `TaskId` ends in `task-N` (N = the `run_command` step). The output is attributed to the
  command's step, so each command has a single tab. Before that, each command showed up in two tabs
  (`step-2` and `step-5`). The day's first attempt couldn't be made because the CLI didn't answer model
  prompts; it was redone when it came back.

## Simulated evidence

- Contracts in the three CLIs: `test/codex-stream.test.js` and `test/cli-runner.test.js` (parallel commands
  tagged, without mixing).
- Tab rules (title/state/agent, visible tabs and the "more" menu, limits per tab and per session):
  `test/native-commands.test.js`.
- Integrated: `test:desktop` opens the app with the simulated Codex, checks both `shellId`s, both tabs and the tab
  switch.
