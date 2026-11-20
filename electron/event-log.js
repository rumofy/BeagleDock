// Diagnostic log of process and lifecycle events (CLI spawn/exit/kill, updates, app crashes).
// JSON Lines in `<data dir>/logs/events.jsonl`, rotated to `events.1.jsonl` past `maxBytes`.
// Only metadata is written (ids, pids, codes, reasons); never prompts or replies.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { redact } = require("./redact");

const MAX_TEXT = 500;

function clean(value) {
  if (value === undefined || typeof value === "function") return undefined;
  if (value === null || typeof value === "number" || typeof value === "boolean")
    return value;
  if (value instanceof Error) return clean(value.stack || value.message);
  if (typeof value === "string") {
    const text = redact(value);
    return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(clean);
  if (typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      const cleaned = clean(item);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return clean(String(value));
}

function createEventLog({
  file,
  maxBytes = 5 * 1024 * 1024,
  now = () => new Date(),
  fsApi = fs,
} = {}) {
  let ready = false;
  function log(event, fields = {}) {
    if (!file) return;
    try {
      if (!ready) {
        fsApi.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        ready = true;
      }
      try {
        if (fsApi.statSync(file).size > maxBytes)
          fsApi.renameSync(file, file.replace(/\.jsonl$/, ".1.jsonl"));
      } catch {}
      const line = JSON.stringify({
        at: now().toISOString(),
        pid: process.pid,
        event,
        ...clean(fields),
      });
      fsApi.appendFileSync(file, `${line}\n`, { mode: 0o600 });
    } catch {}
  }
  return { log, file };
}

// Unit tests (`node --test` sets NODE_TEST_CONTEXT) don't write to the person's data folder.
const defaultFile =
  process.env.NODE_TEST_CONTEXT && !process.env.BEAGLEDOCK_DATA_DIR
    ? null
    : path.join(
        process.env.BEAGLEDOCK_DATA_DIR || path.join(os.homedir(), ".beagledock"),
        "logs",
        "events.jsonl",
      );
const defaultLog = createEventLog({ file: defaultFile });

module.exports = {
  createEventLog,
  logEvent: defaultLog.log,
  eventLogFile: () => defaultLog.file,
};
