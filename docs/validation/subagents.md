# Subagents: permissions, count and output

Verified on Linux on 2026-10-31 for issues #35 and #36.

## Diagnosis

In the conversation reported in #35, Codex's native history records a call to
`spawn_agent`. The interface also counted `wait` and messages as agents and
reassigned the child's steps to the last communication item. The requested
suite was still running when the person interrupted the conversation; the history
doesn't prove an agent-creation loop.

In AGY, the hook received the child's native ID and compared it to the parent's ID.
That denied the request before sending it to the interface. Besides that, the
`inherit` mode ("CLI global") ignored `toolPermission: "always-proceed"` from
`settings.json`, coordination tools (`invoke_subagent`, `send_message`) required
manual confirmation, and `step_type: "subagent"` marked the agent as finished when
it was launched, without nesting the child's commands in the timeline.

The bridge now authenticates the process tree through the exclusive secret inherited
from the CLI, keeping the decisions in the local conversation that launched it,
respects the global policy in `inherit` mode, doesn't ask for approval for internal
subagent coordination tools or `ai-memory` reads, and follows
`subagent_info.subagents`, keeping the subagent active and its steps nested.
Another secret, an invalid ID and requests after the bridge closes don't grant
access. The CLI's global deny rules are still preserved.

## Real evidence

- Codex CLI 0.166.0: a subagent ran a three-second Node command,
  printed two markers and finished; the adapter received a single agent,
  its nested command and the output before the parent's final reply. The CLI sent
  the final marker through `outputDelta` and the initial one only in the command's
  snapshot. That missing initial delta comes from the CLI; the app recovered the
  initial chunk without repeating the chunk already received.
- Antigravity 1.4.12, Gemini 3.8 Flash: a subagent ran the same command,
  asked for permission from the parent conversation's broker and finished. Its result reached the
  shell channel about 5.7 seconds before the final reply. The synchronous command didn't produce
  an incremental log: both markers became available together in the
  native transcript when the command ended. That proves output recovery,
  not intermediate streaming of this command.
- The probe automatically authorized the real requests for the harmless
  command. The allow/deny click in the window was validated with the
  simulated CLIs, not with these real processes.
- The probes used temporary directories with `.ai-memory.toml` pointing to
  `default/beagledock-probes`. They didn't run tests or change files
  of another project.

To repeat the diagnosis, use a conversation in a temporary folder and ask for a single
subagent to run directly, without pipes or redirection:

```sh
node -e "console.log('FIRST');setTimeout(()=>console.log('LAST'),3000)"
```

Watch the child's permission, the number of agents, the shell output before the
final reply and the events the CLI really exposes. Don't infer live output
from final snapshots.

## Simulated evidence

`npm test` covers Codex's event contract, the authorization of known
children, the isolation of unknown conversations, AGY's authenticated bridge,
incremental file reading and the filter of command results in the
child's transcript. The tests tell the end of the agent's creation from the end of its
work and check that waits and messages don't create new agents.

`npm run test:desktop` exercises the app with simulated Claude Code,
Codex and Antigravity CLIs. The additional coverage of children in Codex and AGY checks
allow/deny in the interface and receiving output in the shell before completion. That
coverage doesn't replace the real evidence above. Claude Code didn't get a
protocol change in this work; its contract and the existing integration
remain in the regression suite.

Codex's v2 contract was checked with `codex app-server generate-ts` on the
installed CLI, including `CollabAgentTool`, `SubAgentActivityKind` and `agentsStates`.
The [official App Server documentation](https://learn.chatgpt.com/docs/app-server)
describes the transport of events and interactive replies.
