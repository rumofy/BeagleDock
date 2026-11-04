# Validation of chat attachments (issue #15)

Attached images and files (paste, drag or pick) and the project's `@file` are normalized to each CLI's
format. What the CLI doesn't support becomes a notice in the interface; there's no simulated attachment.

| CLI | Image | Other files and `@file` |
| --- | --- | --- |
| Claude Code | base64 `image` block in the user message (`--input-format stream-json`) | path in the text |
| Codex CLI | `localImage` in the app-server's `turn/start` | `mention` (name + path) |
| Antigravity | no verified native field: the image path in the text, with a notice | path in the text |

Attachments are kept in `attachments/<conversation>/` in the app's data folder (mode 600). Limits: 10 files per
message and 15 MB per file. `@file` only becomes a mention if the file exists inside the conversation's project.

## Real evidence, 2026-10-31

A 16×16 red PNG attached with the request “answer the dominant color in one word, without using a tool”:

| CLI | Version | Reply |
| --- | --- | --- |
| Claude Code | 2.1.316 | `red` |
| Codex CLI | 0.166.0 | `red` |
| Antigravity | 1.4.12 | `red`, opening the image through the path sent in the text (the app warns that there's no native field) |

## Simulated evidence

- Send contracts in the three protocols: `test/attachments.test.js` (Claude and Antigravity) and
  `test/codex-stream.test.js` (Codex).
- Saving rules, limits, mentions and file search: `test/attachments.test.js`.
- Integrated: `test:desktop` drops an image and a file on the composer, sends them and checks what the
  conversation's CLI received.
