# Contributing

Thanks for your interest in BeagleDock! Issues and PRs are welcome, in English or Portuguese.

## Before you start

- Read the [README](README.md) to set up the environment (`npm ci`, `npm run dev`).
- The project rules (version, changelog, frontend structure, Git, languages) are in [AGENTS.md](AGENTS.md). They apply to people and AI agents alike.
- Documentation, code comments, tests, commit messages and PR descriptions are written in English.
- Every text shown in the interface goes through the dictionaries in `shared/i18n/` (English, Spanish and Brazilian Portuguese); a new key goes into all three files.
- Changes to the integrations must cover **Claude Code, Codex CLI and Antigravity**, unless the issue narrows the scope.
- Every user-visible change goes into `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).

## Before opening the PR

```sh
npm test
npm run typecheck
npm run build:vite
```

Point `BEAGLEDOCK_DATA_DIR` at a temporary folder when testing; never use your personal data in tests. When touching streaming or the CLIs' protocols, follow [test/PROTOCOLS.md](test/PROTOCOLS.md) and say in the PR whether the evidence comes from a simulated or a real CLI, with the versions used.

## Windows

BeagleDock is officially supported only on Linux. The code already handles Windows paths, `.cmd` launchers and shell, but the app has **never been validated** on this platform. If you use Windows, your help is very valuable.

### Set up the environment

Node.js 22.12 or later, Python and Visual Studio Build Tools with the C++ workload (to build `node-pty` and `sqlite3`). Then:

```powershell
npm ci
npm test
$env:BEAGLEDOCK_DATA_DIR = "$env:TEMP\beagledock-test"
npm run dev
```

### What needs to be validated

For each installed CLI (Claude Code, Codex CLI, Antigravity):

1. **Discovery:** the app finds the CLI and shows its version, models and levels.
2. **Conversation:** send a message, watch the reply arrive bit by bit (streaming) and reopen the conversation after restarting the app.
3. **Approval:** in "Accept edits", ask for a command and approve/deny it through the panel. In Antigravity this uses a hook with a local socket, the most sensitive point on Windows.
4. **Stop:** interrupt a reply with a long command running and check in Task Manager that no child process is left.
5. **Terminal:** open the built-in shell and check colors, resizing and text input.
6. **Quotas and usage:** the usage indicators show up for each CLI.
7. **Packaging (optional):** `npm run build:electron -- --win --dir` and open the built executable.

Record the result with the **Platform report** issue template, even if everything works: a positive report helps too. Windows-specific fixes must keep the Linux behavior and, when possible, come with a test in `test/` that simulates the platform (see `test/data.test.js`).

## macOS

Also untested. Reports following the same script are welcome. Known points: Claude Code may keep credentials in the Keychain (the quota may not show) and the app isn't signed.

## Security

Don't open a public issue for vulnerabilities. See [SECURITY.md](SECURITY.md).
