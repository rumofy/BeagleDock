# Stream validation (issue #3)

**Real** evidence (CLIs authenticated on the machine, `node test/native-cli-canary.cjs`), recorded on 2026-10-31.
Each CLI runs a command that prints `FIRST`, four `TICK`s (1 per second) and `LAST`; the times are
ms since the start of the run, measured on the `pty-data` emitted by the runner before completion.

| CLI | Version | first | tick | last | chat (1st text) | finished | Live output |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | 2.1.316 | 9073 | 9973 | 12975 | 13961 | 13994 | yes (first < tick < last < finished) |
| Codex CLI | 0.166.0 | 12152 | 9143 | 12145 | 7074 | 13948 | partial: `first` only arrives in the final snapshot; `tick`/`last` arrive by delta |
| Antigravity (agy) | 1.4.12 | 8276 | 9178 | 11283 | 16077 | 19444 | yes |

The native session was preserved on resume in the three CLIs.

## Simulated evidence (offline)

- `test/stream-performance.test.js`: applying each frame in a 400-message conversation with a reply
  of hundreds of KB; p95 < 1/4 of a frame and worst frame < 16 ms.
- `test/stream-apply.test.js`: batch per frame, metrics (`ipc + frame wait + commit`) and a scheduler with a
  safety timeout for a hidden window.
- `test:desktop`: three simulated CLIs with output before completion.

Simulated final events don't prove live output; the table above is the proof with a real CLI.

## Known limitations

- Codex 0.166.0: the app-server doesn't send a delta for the command's first output line. Real timeline
  (command printing `M_FIRST` at t≈7.0 s and one `M_TICK_n` per second): the first `outputDelta` arrives at
  8015 ms already with `M_TICK_1`, and `M_FIRST` only shows up in the final snapshot (12034 ms, marked as
  "[Start of output]"). The app delivers each delta the moment it receives it; there's no way to anticipate or
  simulate that line.
- Antigravity 1.4.12: stream-json only exposes the `user_input` and `agent_response` steps (with `--effort high`,
  without tools); there's no reasoning step. The app doesn't show "thinking" for Antigravity, instead of
  simulating it.
- Claude Code: live reasoning through `thinking_delta` (already covered).
