const fs = require("fs");
const os = require("os");
const path = require("path");
const { parse } = require("smol-toml");
const { roots, readJson } = require("./telemetry");
const { findBinary, execCli } = require("./platform");
const { metadataModels, parseAgyRows, agyModels } = require("./model-options");
const modelIds = (values) => [
  ...new Set(
    (Array.isArray(values) ? values : [])
      .map((m) => (typeof m === "string" ? m : m?.slug || m?.id))
      .filter(
        (id) => typeof id === "string" && /^[a-z0-9][a-z0-9._:/-]*$/i.test(id),
      ),
  ),
];
function mcpList(config) {
  return Object.entries(config || {})
    .filter(
      ([, v]) =>
        v && typeof v === "object" && !v.disabled && v.enabled !== false,
    )
    .map(([name, cfg]) => ({
      name,
      type: cfg.url ? "remote" : "stdio",
      commandOrUrl: cfg.url
        ? "Endpoint configurado"
        : cfg.command || "Configurado",
      status: "idle",
    }));
}
function parseAgyModels(stdout) {
  try {
    const value = JSON.parse(stdout);
    return modelIds(value.models || value);
  } catch {}
  return modelIds(
    stdout
      .replace(/\x1b\[[0-9;]*m/g, "")
      .split("\n")
      .map(
        (line) =>
          line
            .trim()
            .replace(/^[*✓]\s*/, "")
            .split(/\s+/)[0],
      )
      .filter((id) => /[-.]/.test(id) && !id.startsWith("-")),
  );
}
function createCatalogs({
  home = os.homedir(),
  env = process.env,
  find = findBinary,
  exec = execCli,
} = {}) {
  const dirs = roots(home, env);
  let agyCache = { models: [], rows: [], updatedAt: null, error: null };
  let refreshing;
  let lastAttempt = 0;
  const versionCache = new Map();
  async function version(bin) {
    if (!bin) return null;
    const cached = versionCache.get(bin);
    if (cached && Date.now() - cached.at < 60000) return cached.value;
    const value = exec(bin, ["--version"], { timeout: 3000 })
      .then((r) => r.stdout.match(/\d+\.\d+\.\d+/)?.[0] || null)
      .catch(() => null);
    versionCache.set(bin, { at: Date.now(), value });
    return value;
  }
  async function refreshAgy(force = false) {
    if (refreshing) return refreshing;
    if (!force && Date.now() - lastAttempt < 60000) return;
    lastAttempt = Date.now();
    const bin = find("agy") || find("antigravity");
    if (!bin) {
      agyCache = { models: [], rows: [], updatedAt: null, error: null };
      return;
    }
    refreshing = (async () => {
      try {
        const { stdout } = await exec(bin, ["models"], { timeout: 20000 });
        const ids = parseAgyModels(stdout);
        if (!ids.length)
          throw new Error("A CLI não retornou um catálogo de modelos válido.");
        agyCache = {
          models: ids,
          rows: parseAgyRows(stdout),
          updatedAt: new Date().toISOString(),
          error: null,
        };
      } catch (e) {
        agyCache = { ...agyCache, error: e.message };
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }
  function localCatalogs() {
    const result = Object.fromEntries(
      ["claude", "codex", "antigravity"].map((id) => [
        id,
        {
          models: [],
          modelOptions: [],
          activeModel: "",
          mcps: [],
          modelsSource: "Indisponível",
          modelsUpdatedAt: null,
          modelsError: null,
        },
      ]),
    );
    try {
      const dir = path.join(dirs.claude, "cache", "model-catalog");
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => ({
          full: path.join(dir, f),
          mtime: fs.statSync(path.join(dir, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const file of files) {
        const raw = readJson(file.full);
        const ids = modelIds(raw.catalog?.config?.models || raw.models);
        if (ids.length) {
          result.claude.models = ids;
          result.claude.modelOptions = metadataModels(
            raw.catalog?.config?.models || raw.models,
            "claude",
          );
          result.claude.modelsSource = "Cache local Claude";
          result.claude.modelsUpdatedAt = new Date(file.mtime).toISOString();
          break;
        }
      }
    } catch {}
    const claudeSettings = readJson(path.join(dirs.claude, "settings.json"));
    result.claude.activeModel = claudeSettings.model || "";
    result.claude.mcps = mcpList({
      ...readJson(path.join(home, ".claude.json")).mcpServers,
      ...claudeSettings.mcpServers,
    });
    const cachePath = path.join(dirs.codex, "models_cache.json");
    result.codex.models = modelIds(readJson(cachePath).models);
    result.codex.modelOptions = metadataModels(
      readJson(cachePath).models,
      "codex",
    );
    if (result.codex.models.length) {
      result.codex.modelsSource = "Cache local Codex";
      result.codex.modelsUpdatedAt = new Date(
        fs.statSync(cachePath).mtimeMs,
      ).toISOString();
    }
    try {
      const config = parse(
        fs.readFileSync(path.join(dirs.codex, "config.toml"), "utf8"),
      );
      result.codex.activeModel = config.model || "";
      result.codex.mcps = mcpList(config.mcp_servers);
    } catch {}
    const agySettings = readJson(path.join(dirs.agy, "settings.json"));
    result.antigravity.activeModel = agySettings.model || "";
    result.antigravity.modelOptions = agyModels(
      agyCache.rows || [],
      result.antigravity.activeModel,
    );
    result.antigravity.mcps = mcpList({
      ...readJson(path.join(home, ".gemini", "config", "mcp_config.json"))
        .mcpServers,
      ...agySettings.mcpServers,
    });
    Object.assign(result.antigravity, {
      models: agyCache.models,
      modelsSource: agyCache.updatedAt ? "agy models" : "Indisponível",
      modelsUpdatedAt: agyCache.updatedAt,
      modelsError: agyCache.error,
    });
    for (const info of Object.values(result)) {
      if (
        info.activeModel &&
        !info.modelOptions.some(
          (o) =>
            o.id.toLowerCase() === info.activeModel.toLowerCase() ||
            o.aliases.some(
              (alias) => alias.toLowerCase() === info.activeModel.toLowerCase(),
            ),
        )
      ) {
        info.modelOptions.push({
          id: info.activeModel,
          label: info.activeModel,
          aliases: [],
          efforts: [],
          requiresEffort: false,
        });
      }
      if (
        info.activeModel &&
        /^[a-z0-9][a-z0-9._:/-]*$/i.test(info.activeModel) &&
        !info.models.includes(info.activeModel)
      )
        info.models.push(info.activeModel);
    }
    return result;
  }
  async function detect() {
    const catalogs = localCatalogs();
    const bins = {
      claude: find("claude"),
      codex: find("codex"),
      antigravity: find("agy") || find("antigravity"),
      aiMemory: find("ai-memory"),
    };
    const entries = await Promise.all(
      Object.entries(bins).map(async ([id, bin]) => [
        id,
        {
          ...catalogs[id],
          installed: !!bin,
          path: bin,
          version: await version(bin),
        },
      ]),
    );
    return Object.fromEntries(entries);
  }
  return {
    detect,
    refreshAgy,
    localCatalogs,
    invalidateVersions: () => versionCache.clear(),
  };
}
module.exports = { createCatalogs, parseAgyModels, modelIds };
