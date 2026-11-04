# BeagleDock

## Language

English is the project's language for everything written in the repository: README, `docs/`, `CHANGELOG.md`, this file, code comments, test names, commit messages and PR descriptions. Do not add documentation or comments in another language.

The app's interface is multilingual: English (default), Spanish and Brazilian Portuguese, chosen in Settings → Appearance. Every text shown to the user, in the renderer and in the Electron main process (notifications, tray menu, dialogs, error messages), goes through the dictionaries in `shared/i18n/` (`en.json`, `es.json`, `pt-BR.json`) via `t()`/`tn()` (`src/i18n` in the renderer, `electron/i18n.js` in the main process). Never hard-code user-facing strings. A new key goes into all three files in the same change; `test/i18n.test.js` checks that the locales have the same keys and placeholders. Prompts the app sends to the CLIs on the user's behalf (handoff, continuation, plan approval) also follow the interface language.

## Integration scope

Feature requests and fixes in the integrations cover **Claude Code, Codex CLI and Antigravity (AGY)**. Do not deliver a change for only one of them unless the user explicitly narrows the scope. Preserve each conversation's native identifier and history.

Keep contract tests for the three protocols, unit tests for the rules and integrated tests of the app. When validating streaming, check intermediate data before completion; simulated final events do not prove live output. Record verified versions and distinguish simulated evidence from diagnosis with the real CLI.

Diagnosis with a real CLI always runs in a folder created by `node test/probe-dir.cjs <name>` (or `makeProbeDir` in the test scripts), never in a loose `/tmp` folder or `mktemp -d`: its `.ai-memory.toml` groups the sessions under the `beagledock-probes` project instead of creating a new ai-memory project for every folder.

## Versions and distribution

The app is called BeagleDock and uses the Apache-2.0 license. The version lives **only** in `package.json`: never write the version number in the README, docs, code or fixed file names. Whatever needs it reads it from `package.json`/`app.getVersion()`; `docs/openapi.json` is synced by the version script and checked by the tests.

### Changelog

`CHANGELOG.md` follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and [SemVer](https://semver.org/):

- Every user-visible change goes into `## [Unreleased]` in the same work that introduces it, in one of these sections, in this order: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`. One line per change, in English, written for the user (what and why), without internal file names or implementation details. Refactors and tests with no visible effect are not listed.
- Never hand-edit the sections of released versions, their dates or the footer links. Versions released before the switch to English keep their original Portuguese text.
- Releasing a version: `npm version patch|minor|major` (fix / feature / breaking change). The script moves `Unreleased` to `## [x.y.z] - YYYY-MM-DD`, updates the comparison links and `docs/openapi.json`. It does not commit or tag; do that only when the user asks. The old names (CapyAI, Bleagle/BleagleDock) are not used in code, identities or documentation; the one-time migration of old data, settings and hooks to the BeagleDock identities must keep working without losing sessions or duplicating approvals.

Distribution is local only, on Linux (`.deb`/AppImage built on the machine itself). CI (`.github/workflows/`) only runs types, tests and the frontend build on PRs and publishes the GitHub release with the notes from `CHANGELOG.md`, with no packages attached. Do not add packaging to CI or targets for other platforms without an explicit request. Releases are automatic: when the release branch (`release/X.Y.Z`) is merged into `main`, the `Release` workflow creates the `vX.Y.Z` tag on the merged commit and publishes the release. Do not create or push the tag by hand; only check that the workflow passed.

## Frontend structure

`src/App.tsx` only composes the layout. Each area lives in `src/features/<area>/` (its own components, hooks and utilities); shared state and backend calls live in hooks (`src/hooks/`) and in the typed API client (`src/api/`), never through `(window as any)`. Reusable interface components live in `src/components/`.

## Git

Only create commits and PRs when asked. The `vX.Y.Z` tag of a release is created by CI when `release/X.Y.Z` is merged into `main`. Do not include co-authorship, AI attribution or session links in commits and PRs.
