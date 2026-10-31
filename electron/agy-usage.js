const { findBinary, execCli } = require("./platform");
function maximum(values) {
  const known = values.filter(Number.isFinite);
  return known.length ? Math.max(...known) : null;
}
function parseUsageReport(stdout, now = Date.now()) {
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw new Error("O AGY retornou um relatório de cotas inválido.");
  }
  if (
    report.status !== "SUCCESS" ||
    report.command?.name !== "usage" ||
    !Array.isArray(report.command.data?.groups)
  )
    throw new Error("O AGY não retornou um relatório /usage válido.");
  const groups = report.command.data.groups
    .filter((g) => g && typeof g.name === "string" && Array.isArray(g.buckets))
    .map((group) => {
      const buckets = group.buckets
        .filter((b) => b && !b.disabled && ["5h", "weekly"].includes(b.window))
        .map((bucket) => {
          const reset = Date.parse(bucket.reset_time);
          const fraction = bucket.remaining_fraction;
          const known =
            Number.isFinite(fraction) &&
            fraction >= 0 &&
            fraction <= 1 &&
            (!Number.isFinite(reset) || reset > now);
          return {
            id: typeof bucket.id === "string" ? bucket.id : bucket.window,
            window: bucket.window,
            usedPercent: known ? Math.round((1 - fraction) * 100) : null,
            resetAt: Number.isFinite(reset)
              ? new Date(reset).toISOString()
              : null,
          };
        });
      const select = (window) =>
        buckets
          .filter((b) => b.window === window)
          .sort((a, b) => (b.usedPercent ?? -1) - (a.usedPercent ?? -1))[0];
      return {
        name: group.name.slice(0, 160),
        window5hPercent: select("5h")?.usedPercent ?? null,
        weeklyPercent: select("weekly")?.usedPercent ?? null,
        window5hResetAt: select("5h")?.resetAt,
        weeklyResetAt: select("weekly")?.resetAt,
      };
    });
  if (
    !groups.some((g) => g.window5hPercent !== null || g.weeklyPercent !== null)
  )
    throw new Error(
      "O relatório do AGY não contém cotas conhecidas e vigentes.",
    );
  return {
    groups,
    window5hPercent: maximum(groups.map((g) => g.window5hPercent)),
    weeklyPercent: maximum(groups.map((g) => g.weeklyPercent)),
    updatedAt: new Date(now).toISOString(),
    stale: false,
    quotaError: null,
    sourceLabel: "AGY /usage · cotas do provedor",
    groupLabel: "Maior uso entre grupos",
  };
}
function expireSnapshot(snapshot, now) {
  const groups = snapshot.groups.map((g) => ({
    ...g,
    window5hPercent:
      g.window5hResetAt && Date.parse(g.window5hResetAt) <= now
        ? null
        : g.window5hPercent,
    weeklyPercent:
      g.weeklyResetAt && Date.parse(g.weeklyResetAt) <= now
        ? null
        : g.weeklyPercent,
  }));
  return {
    ...snapshot,
    groups,
    window5hPercent: maximum(groups.map((g) => g.window5hPercent)),
    weeklyPercent: maximum(groups.map((g) => g.weeklyPercent)),
    stale:
      snapshot.stale ||
      now - Date.parse(snapshot.updatedAt) > 120000 ||
      groups.some(
        (g, i) =>
          g.window5hPercent !== snapshot.groups[i].window5hPercent ||
          g.weeklyPercent !== snapshot.groups[i].weeklyPercent,
      ),
  };
}
function createAgyUsage({
  find = findBinary,
  exec = execCli,
  now = Date.now,
  refreshMs = 45000,
} = {}) {
  let snapshot = {
    groups: [],
    window5hPercent: null,
    weeklyPercent: null,
    updatedAt: null,
    stale: true,
    sourceLabel: "AGY /usage",
    quotaError: null,
  };
  let pending,
    lastAttempt = -Infinity;
  async function get() {
    if (pending) return pending;
    if (now() - lastAttempt < refreshMs) return expireSnapshot(snapshot, now());
    lastAttempt = now();
    pending = (async () => {
      try {
        const bin = find("agy") || find("antigravity");
        if (!bin) throw new Error("CLI do AGY não encontrada.");
        const options = {
          timeout: 20000,
          maxBuffer: 1024 * 1024,
          env: { AGY_CLI_DISABLE_AUTO_UPDATE: "true" },
        };
        const version = (
          await exec(bin, ["--version"], { ...options, timeout: 3000 })
        ).stdout.match(/(\d+)\.(\d+)\.(\d+)/);
        if (
          !version ||
          (Number(version[1]) === 1 &&
            (Number(version[2]) < 1 ||
              (Number(version[2]) === 1 && Number(version[3]) < 11))) ||
          Number(version[1]) < 1
        )
          throw new Error(
            "Atualize o AGY para consultar /usage em JSON (1.1.11 ou superior).",
          );
        let result;
        try {
          result = await exec(
            bin,
            ["-p", "/usage", "--output-format", "json"],
            options,
          );
        } catch {
          throw new Error(
            "Não foi possível consultar /usage. Confira a autenticação do AGY no terminal.",
          );
        }
        snapshot = parseUsageReport(result.stdout, now());
      } catch (error) {
        snapshot = { ...snapshot, stale: true, quotaError: error.message };
      }
      return expireSnapshot(snapshot, now());
    })().finally(() => {
      pending = null;
    });
    return pending;
  }
  return { get };
}
module.exports = { createAgyUsage, parseUsageReport };
