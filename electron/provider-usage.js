const crossSpawn = require("cross-spawn");
const { StringDecoder } = require("string_decoder");
const { findBinary, execCli, terminateCli } = require("./platform");

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

function tzOffsetMs(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(timestamp));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(timestamp / 1000) * 1000;
}

function zonedInstant(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month, day, hour, minute);
  let instant = guess - tzOffsetMs(guess, timeZone);
  instant = guess - tzOffsetMs(instant, timeZone);
  return instant;
}

// "Oct 31, 3:20pm (America/Sao_Paulo)" · "Nov 7, 2am (America/Sao_Paulo)" · "3:20pm"
function parseResetLabel(label, now = Date.now()) {
  if (typeof label !== "string") return null;
  // "in 2h", "in 1h 30m", "in 3 days"
  const relative = label
    .trim()
    .match(
      /^in\s+(?:(\d+)\s*d(?:ays?)?\s*)?(?:(\d+)\s*h(?:ours?|rs?)?\s*)?(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/i,
    );
  if (relative && (relative[1] || relative[2] || relative[3]))
    return new Date(
      now +
        ((Number(relative[1]) || 0) * 86400 +
          (Number(relative[2]) || 0) * 3600 +
          (Number(relative[3]) || 0) * 60) *
          1000,
    ).toISOString();
  const match = label
    .trim()
    .match(
      /^(?:([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:\(([^)]+)\))?$/i,
    );
  if (!match) return null;
  const [, monthName, dayText, hourText, minuteText, meridiem, zone] = match;
  let hour = Number(hourText) % 12;
  if (meridiem.toLowerCase() === "pm") hour += 12;
  const minute = Number(minuteText || 0);
  const timeZone = zone?.trim() || undefined;
  try {
    const local = (ts) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
      })
        .formatToParts(new Date(ts))
        .reduce((acc, p) => ({ ...acc, [p.type]: Number(p.value) }), {});
    const today = local(now);
    const zoneName =
      timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (monthName) {
      const month = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase());
      if (month < 0) return null;
      // O reinício fica a dias de agora: escolhe o ano cujo instante é o mais próximo de "agora"
      // (cobre a virada de ano nos dois sentidos).
      const candidates = [today.year - 1, today.year, today.year + 1].map(
        (year) =>
          zonedInstant(year, month, Number(dayText), hour, minute, zoneName),
      );
      const instant = candidates.reduce((best, c) =>
        Math.abs(c - now) < Math.abs(best - now) ? c : best,
      );
      return new Date(instant).toISOString();
    }
    let instant = zonedInstant(
      today.year,
      today.month - 1,
      today.day,
      hour,
      minute,
      zoneName,
    );
    if (instant < now) instant += 86400000;
    return new Date(instant).toISOString();
  } catch {
    return null;
  }
}

function parseClaudeUsage(stdout, now = Date.now()) {
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw new Error("O Claude Code retornou um relatório /usage inválido.");
  }
  const text = typeof report?.result === "string" ? report.result : "";
  if (report?.is_error || !text)
    throw new Error("O Claude Code não retornou um relatório /usage válido.");
  const find = (label) => {
    const line = text.match(
      new RegExp(
        `^\\s*${label}:\\s*(\\d+(?:\\.\\d+)?)%\\s*used(?:\\s*·\\s*resets\\s*(.+))?\\s*$`,
        "im",
      ),
    );
    if (!line) return { percent: null, resetAt: null };
    const resetAt = parseResetLabel(line[2], now);
    // A janela que já reiniciou deixa de valer: não exibir percentual antigo.
    if (resetAt && Date.parse(resetAt) <= now)
      return { percent: null, resetAt };
    return { percent: Math.round(Number(line[1])), resetAt };
  };
  const session = find("Current session");
  const week = find("Current week \\(all models\\)");
  if (session.percent === null && week.percent === null)
    throw new Error(
      "O /usage do Claude Code não informou cotas (conta sem assinatura?).",
    );
  return {
    window5hPercent: session.percent,
    weeklyPercent: week.percent,
    window5hResetAt: session.resetAt,
    weeklyResetAt: week.resetAt,
    sourceLabel: "Claude Code /usage · cotas do provedor",
  };
}

function parseCodexRateLimits(result, now = Date.now()) {
  const snapshot =
    result?.rateLimitsByLimitId?.codex || result?.rateLimits || null;
  if (!snapshot)
    throw new Error(
      "O Codex não retornou limites de uso (account/rateLimits).",
    );
  const windows = [snapshot.primary, snapshot.secondary].filter(
    (w) => w && Number.isFinite(w.usedPercent),
  );
  const byDuration = (predicate) =>
    windows.find((w) => Number.isFinite(w.windowDurationMins) && predicate(w));
  const five =
    byDuration((w) => w.windowDurationMins <= 600) ||
    (!windows.some((w) => Number.isFinite(w.windowDurationMins))
      ? snapshot.primary
      : null);
  const weekly =
    byDuration((w) => w.windowDurationMins >= 7200) ||
    (!windows.some((w) => Number.isFinite(w.windowDurationMins))
      ? snapshot.secondary
      : null);
  const read = (window) => {
    if (!window || !Number.isFinite(window.usedPercent))
      return { percent: null, resetAt: null };
    const resetAt = Number.isFinite(window.resetsAt)
      ? new Date(window.resetsAt * 1000).toISOString()
      : null;
    if (resetAt && Date.parse(resetAt) <= now)
      return { percent: null, resetAt };
    return { percent: Math.round(window.usedPercent), resetAt };
  };
  const a = read(five);
  const b = read(weekly);
  if (a.percent === null && b.percent === null)
    throw new Error("O Codex não informou limites conhecidos e vigentes.");
  return {
    window5hPercent: a.percent,
    weeklyPercent: b.percent,
    window5hResetAt: a.resetAt,
    weeklyResetAt: b.resetAt,
    ...(snapshot.planType ? { planType: snapshot.planType } : {}),
    sourceLabel: "Codex app-server · limites da conta (/status)",
  };
}

function queryCodexRateLimits({ bin, spawn = crossSpawn, timeoutMs = 20000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let buffer = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.stdin.end();
      } catch {}
      terminateCli(child);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error("Tempo limite ao consultar os limites do Codex.")),
      timeoutMs,
    );
    const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
    child.on("error", (error) => finish(error));
    // EPIPE/ENOENT ao escrever em um codex que saiu na hora não pode virar erro não tratado.
    child.stdin?.on("error", (error) => finish(error));
    const decoder = new StringDecoder("utf8");
    child.on("close", () =>
      finish(new Error("O Codex encerrou antes de informar os limites.")),
    );
    child.stderr?.on("data", () => {});
    child.stdout.on("data", (chunk) => {
      buffer += decoder.write(chunk);
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === "usage-init") {
          if (message.error) return finish(new Error(message.error.message));
          send({ method: "initialized" });
          send({ id: "usage-read", method: "account/rateLimits/read" });
        } else if (message.id === "usage-read") {
          if (message.error)
            finish(new Error(message.error.message || "Falha no Codex."));
          else finish(null, message.result);
        }
      }
    });
    try {
      send({
        id: "usage-init",
        method: "initialize",
        params: {
          clientInfo: {
            name: "beagledock",
            title: "BeagleDock",
            version: require("../package.json").version,
          },
        },
      });
    } catch (error) {
      finish(error);
    }
  });
}

function expireSnapshot(snapshot, now) {
  if (!snapshot.updatedAt) return snapshot;
  const expired = (resetAt) => resetAt && Date.parse(resetAt) <= now;
  const window5hExpired = expired(snapshot.window5hResetAt);
  const weeklyExpired = expired(snapshot.weeklyResetAt);
  return {
    ...snapshot,
    window5hPercent: window5hExpired ? null : snapshot.window5hPercent,
    weeklyPercent: weeklyExpired ? null : snapshot.weeklyPercent,
    remainingResetMinutes: snapshot.window5hResetAt
      ? Math.max(
          0,
          Math.ceil((Date.parse(snapshot.window5hResetAt) - now) / 60000),
        )
      : null,
    stale:
      snapshot.stale ||
      window5hExpired ||
      weeklyExpired ||
      now - Date.parse(snapshot.updatedAt) > 120000,
  };
}

function createProviderUsage({
  find = findBinary,
  exec = execCli,
  spawn = crossSpawn,
  now = Date.now,
  refreshMs = 45000,
  // Em segundo plano (janela oculta/minimizada) consulta bem menos: cada leitura inicia uma CLI.
  getRefreshMs = () => refreshMs,
  // Quanto a leitura espera pela CLI antes de devolver o último valor conhecido; a CLI lenta
  // nunca deve atrasar a lista de ferramentas. Ao terminar em segundo plano, `onUpdate` avisa.
  waitMs = 1500,
  onUpdate = () => {},
  cwd = require("os").tmpdir(),
} = {}) {
  const empty = () => ({
    window5hPercent: null,
    weeklyPercent: null,
    updatedAt: null,
    stale: true,
    quotaError: null,
  });
  const providers = {
    claude: {
      snapshot: empty(),
      pending: null,
      lastAttempt: -Infinity,
      read: async () => {
        const bin = find("claude");
        if (!bin) throw new Error("CLI do Claude Code não encontrada.");
        let result;
        try {
          // Sem transcript e sem os hooks/configurações do usuário: é só uma leitura de cota,
          // não pode virar sessão no histórico do Claude nem disparar hooks (ex.: ai-memory).
          result = await exec(
            bin,
            [
              "-p",
              "/usage",
              "--output-format",
              "json",
              "--no-session-persistence",
              "--setting-sources",
              "local",
            ],
            {
              cwd,
              timeout: 25000,
              maxBuffer: 1024 * 1024,
            },
          );
        } catch {
          throw new Error(
            "Não foi possível consultar /usage. Confira a autenticação do Claude Code no terminal.",
          );
        }
        return parseClaudeUsage(result.stdout, now());
      },
    },
    codex: {
      snapshot: empty(),
      pending: null,
      lastAttempt: -Infinity,
      read: async () => {
        const bin = find("codex");
        if (!bin) throw new Error("CLI do Codex não encontrada.");
        const result = await queryCodexRateLimits({ bin, spawn });
        return parseCodexRateLimits(result, now());
      },
    },
  };
  async function refresh(id, force) {
    const provider = providers[id];
    if (provider.pending) return provider.pending;
    if (!force && now() - provider.lastAttempt < getRefreshMs())
      return expireSnapshot(provider.snapshot, now());
    provider.lastAttempt = now();
    provider.pending = (async () => {
      try {
        provider.snapshot = {
          ...(await provider.read()),
          updatedAt: new Date(now()).toISOString(),
          stale: false,
          quotaError: null,
        };
      } catch (error) {
        provider.snapshot = {
          ...provider.snapshot,
          stale: true,
          quotaError: error.message,
        };
      }
      return expireSnapshot(provider.snapshot, now());
    })().finally(() => {
      provider.pending = null;
    });
    return provider.pending;
  }
  const bounded = (id, force) => {
    const started = refresh(id, force);
    const wait = new Promise((resolve) => {
      const timer = setTimeout(
        () => resolve(expireSnapshot(providers[id].snapshot, now())),
        waitMs,
      );
      started.finally(() => clearTimeout(timer));
    });
    // Leitura que passou do prazo ainda termina em segundo plano e avisa quem estiver ouvindo.
    started.then(() => {
      if (providers[id].late) {
        providers[id].late = false;
        onUpdate(id);
      }
    });
    return Promise.race([started, wait]).then((value) => {
      if (providers[id].pending) providers[id].late = true;
      return value;
    });
  };
  return {
    get: async (force = false) => {
      const [claude, codex] = await Promise.all([
        bounded("claude", force),
        bounded("codex", force),
      ]);
      return { claude, codex };
    },
  };
}

module.exports = {
  createProviderUsage,
  parseClaudeUsage,
  parseCodexRateLimits,
  parseResetLabel,
  queryCodexRateLimits,
};
