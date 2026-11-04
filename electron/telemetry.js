const fs = require("fs");
const os = require("os");
const path = require("path");
const { t } = require("./i18n");
function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function jsonLines(file) {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
function walkFiles(root, suffix = ".jsonl") {
  const files = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(suffix)) {
        try {
          files.push({ full, mtime: fs.statSync(full).mtimeMs });
        } catch {}
      }
    }
  }
  walk(root);
  return files.sort((a, b) => b.mtime - a.mtime);
}
function roots(home = os.homedir(), env = process.env) {
  return {
    claude: env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"),
    codex: env.CODEX_HOME || path.join(home, ".codex"),
    agy: path.join(home, ".gemini", "antigravity-cli"),
  };
}
function tokens(usage) {
  if (
    !usage ||
    ![
      "input_tokens",
      "output_tokens",
      "cached_input_tokens",
      "cache_read_input_tokens",
      "cache_creation_input_tokens",
    ].some((k) => Number.isFinite(usage[k]))
  )
    return null;
  const n = (key) => Math.max(0, Number(usage[key]) || 0);
  const input = n("input_tokens") + n("cache_creation_input_tokens");
  const output = n("output_tokens");
  const cached = n("cached_input_tokens") || n("cache_read_input_tokens");
  return {
    inputTokens: input,
    outputTokens: output,
    cachedTokens: cached,
    totalTokens: Number.isFinite(usage.total_tokens)
      ? usage.total_tokens
      : input + output + n("cache_read_input_tokens"),
  };
}
function aggregateClaude(files, cutoff) {
  const messages = new Map();
  for (const file of files.filter((f) => f.mtime >= cutoff)) {
    for (const ev of jsonLines(file.full)) {
      if (
        !Number.isFinite(new Date(ev.timestamp).getTime()) ||
        new Date(ev.timestamp).getTime() < cutoff
      )
        continue;
      const usage = tokens(ev.message?.usage || ev.usage);
      if (!usage) continue;
      const id = ev.message?.id || ev.uuid;
      if (id) messages.set(id, usage); // streaming snapshots of the same response must not be added together
    }
  }
  return sumUsage([...messages.values()]);
}
function sumUsage(values) {
  if (!values.length)
    return {
      totalTokens: null,
      inputTokens: null,
      outputTokens: null,
      cachedTokens: null,
    };
  return values.reduce(
    (sum, u) => {
      for (const k of [
        "totalTokens",
        "inputTokens",
        "outputTokens",
        "cachedTokens",
      ])
        sum[k] += u[k] || 0;
      return sum;
    },
    { totalTokens: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
  );
}
function readLocalMetrics({
  home = os.homedir(),
  env = process.env,
  now = Date.now(),
} = {}) {
  const dirs = roots(home, env);
  const cutoff = now - 7 * 86400000;
  const unavailable = {
    window5hPercent: null,
    weeklyPercent: null,
    remainingResetMinutes: null,
    updatedAt: null,
    stale: true,
  };
  const claude = {
    ...unavailable,
    ...aggregateClaude(walkFiles(path.join(dirs.claude, "projects")), cutoff),
    sourceLabel: t("usage.localLogsNoQuota"),
  };
  const usageBySession = new Map();
  let newestRate = null;
  for (const file of walkFiles(path.join(dirs.codex, "sessions")).filter(
    (f) => f.mtime >= cutoff,
  )) {
    let previous = {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
    };
    const total = {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
    };
    let sessionId = file.full;
    let hasUsage = false;
    for (const ev of jsonLines(file.full)) {
      if (ev.type === "session_meta" && ev.payload?.id)
        sessionId = ev.payload.id;
      if (ev.payload?.type !== "token_count") continue;
      const ts = new Date(ev.timestamp).getTime();
      const current = tokens(ev.payload.info?.total_token_usage);
      if (current) {
        if (ts >= cutoff) {
          hasUsage = true;
          for (const key of Object.keys(total))
            total[key] += Math.max(0, current[key] - previous[key]);
        }
        previous = current;
      }
      if (
        ev.payload.rate_limits &&
        Number.isFinite(ts) &&
        (!newestRate || ts > newestRate.ts)
      )
        newestRate = { ts, value: ev.payload.rate_limits };
    }
    if (hasUsage && !usageBySession.has(sessionId))
      usageBySession.set(sessionId, total);
  }
  const codex = {
    ...unavailable,
    ...sumUsage([...usageBySession.values()]),
    sourceLabel: t("usage.codexTelemetry"),
  };
  if (newestRate) {
    const rate = newestRate.value;
    codex.window5hPercent = Number.isFinite(rate.primary?.used_percent)
      ? rate.primary.used_percent
      : null;
    codex.weeklyPercent = Number.isFinite(rate.secondary?.used_percent)
      ? rate.secondary.used_percent
      : null;
    codex.updatedAt = new Date(newestRate.ts).toISOString();
    codex.stale = now - newestRate.ts > 5 * 60000;
    if (rate.primary?.resets_at) {
      codex.window5hResetAt = new Date(
        rate.primary.resets_at * 1000,
      ).toISOString();
      codex.remainingResetMinutes = Math.max(
        0,
        Math.ceil((rate.primary.resets_at * 1000 - now) / 60000),
      );
      if (rate.primary.resets_at * 1000 <= now) {
        codex.window5hPercent = null;
        codex.stale = true;
      }
    }
    if (rate.secondary?.resets_at) {
      codex.weeklyResetAt = new Date(
        rate.secondary.resets_at * 1000,
      ).toISOString();
      if (rate.secondary.resets_at * 1000 <= now) {
        codex.weeklyPercent = null;
        codex.stale = true;
      }
    }
    if (rate.plan_type) codex.planType = rate.plan_type;
  }
  const history = jsonLines(path.join(dirs.agy, "history.jsonl"));
  const prompts5h = history.filter(
    (e) => new Date(e.timestamp).getTime() >= now - 5 * 3600000,
  ).length;
  const prompts7d = history.filter(
    (e) => new Date(e.timestamp).getTime() >= cutoff,
  ).length;
  const agyUsage = new Map();
  for (const file of walkFiles(path.join(dirs.agy, "brain")).filter(
    (f) => f.mtime >= cutoff,
  )) {
    for (const ev of jsonLines(file.full)) {
      const timestamp = Date.parse(ev.created_at);
      if (
        ev.type !== "PLANNER_RESPONSE" ||
        !Number.isFinite(timestamp) ||
        timestamp < cutoff
      )
        continue;
      const raw = ev.usage || ev;
      if (
        !Number.isFinite(raw.input_tokens) &&
        !Number.isFinite(raw.output_tokens)
      )
        continue;
      // AGY input_tokens already includes cache reads; cache is a subset, not extra input.
      const usage = tokens({
        input_tokens: raw.input_tokens,
        output_tokens: raw.output_tokens,
        cached_input_tokens: raw.cache_read_tokens,
        total_tokens: Number.isFinite(raw.total_tokens)
          ? raw.total_tokens
          : (raw.input_tokens || 0) + (raw.output_tokens || 0),
      });
      agyUsage.set(`${file.full}:${ev.step_index}`, usage);
    }
  }
  const antigravity = {
    ...unavailable,
    ...sumUsage([...agyUsage.values()]),
    prompts5h,
    prompts7d,
    sourceLabel: t("usage.agyLogs", { prompts5h, prompts7d }),
  };
  return { claude, codex, antigravity };
}
module.exports = {
  readJson,
  jsonLines,
  walkFiles,
  roots,
  readLocalMetrics,
  tokens,
};
