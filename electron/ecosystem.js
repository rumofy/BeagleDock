const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const { findBinary, execCli } = require("./platform");
const IDS = ["claude", "codex", "antigravity"];
const NAMES = {
  claude: "Claude Code",
  codex: "Codex CLI",
  antigravity: "Antigravity",
};
function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { "User-Agent": "BeagleDock", Accept: "application/json" },
        timeout: 8000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error("Fonte de versões indisponível."));
          return;
        }
        let body = "",
          bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024)
            req.destroy(new Error("Resposta excedeu o limite."));
          else body += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("Versão publicada inválida."));
          }
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () =>
      req.destroy(new Error("Tempo limite na consulta de versões.")),
    );
    req.on("error", reject);
  });
}
function newer(a, b) {
  if (!/^\d+\.\d+\.\d+$/.test(a || "") || !/^\d+\.\d+\.\d+$/.test(b || ""))
    return false;
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] > right[i];
  return false;
}
function updateCommand(id, bin, find = findBinary) {
  if (id === "claude" || id === "antigravity") return { bin, args: ["update"] };
  let real;
  try {
    real = fs.realpathSync(bin);
  } catch {
    real = bin;
  }
  if (
    /[\\/]node_modules[\\/]@openai[\\/]codex[\\/]/.test(real) ||
    (() => {
      try {
        return (
          /\.(cmd|bat)$/i.test(bin) &&
          JSON.parse(
            fs.readFileSync(
              path.join(
                path.dirname(bin),
                "node_modules",
                "@openai",
                "codex",
                "package.json",
              ),
              "utf8",
            ),
          ).name === "@openai/codex"
        );
      } catch {
        return false;
      }
    })()
  ) {
    const npm = find("npm");
    if (npm)
      return {
        bin: npm,
        args: [
          "install",
          "--global",
          "--prefix",
          (() => {
            const marker = real.search(
              /[\\/]node_modules[\\/]@openai[\\/]codex[\\/]/,
            );
            if (marker < 0) return path.dirname(bin);
            const root = real.slice(0, marker);
            return path.basename(root) === "lib" ? path.dirname(root) : root;
          })(),
          "@openai/codex@latest",
        ],
      };
  }
  const brew = find("brew");
  if (brew && /(?:Cellar|Caskroom|homebrew).*codex/i.test(real))
    return { bin: brew, args: ["upgrade", "codex"] };
  throw new Error(
    "Instalação não reconhecida. Atualize o Codex pelo gerenciador usado na instalação.",
  );
}
function createEcosystem({
  file = path.join(
    process.env.BEAGLEDOCK_DATA_DIR || path.join(os.homedir(), ".beagledock"),
    "ecosystem.json",
  ),
  request = getJson,
  find = findBinary,
  exec = execCli,
  now = () => Date.now(),
} = {}) {
  let state = { seen: {}, notifications: [], releases: {}, checkedAt: null };
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (saved.seen && Array.isArray(saved.notifications))
      state = { ...state, ...saved };
  } catch {}
  let checking,
    lastAttempt = 0;
  const updating = new Set();
  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  function notify(id, category, title, description, extra = {}) {
    if (state.notifications.some((n) => n.id === id)) return;
    state.notifications.unshift({
      id,
      category,
      title,
      description,
      date: new Date(now()).toLocaleDateString("pt-BR"),
      isNew: true,
      ...extra,
    });
    state.notifications = state.notifications.slice(0, 100);
  }
  function observe(tools) {
    for (const id of IDS) {
      const tool = tools[id];
      if (!tool) continue;
      const old = state.seen[id];
      if (old && !old.installed && tool.installed)
        notify(
          `installed:${id}:${now()}`,
          "cli_update",
          `${NAMES[id]} detectada`,
          "Uma nova CLI foi encontrada nesta máquina.",
        );
      if (old?.version && tool.version && newer(tool.version, old.version))
        notify(
          `installed-version:${id}:${tool.version}`,
          "cli_update",
          `${NAMES[id]} atualizada`,
          `Versão instalada: ${tool.version}.`,
        );
      const options = tool.modelOptions || [];
      const describe = (modelId) => {
        const key = String(modelId).toLowerCase();
        const model = options.find(
          (m) =>
            m.id.toLowerCase() === key ||
            m.aliases?.some((a) => a.toLowerCase() === key) ||
            m.efforts?.some((e) => e.nativeModel?.toLowerCase() === key),
        );
        return { id: model?.id || modelId, label: model?.label || modelId };
      };
      const models = Array.isArray(tool.models) ? tool.models : [];
      if (old?.models?.length && models.length && !tool.modelsError) {
        const previous = new Set(old.models.map((m) => describe(m).id));
        const added = [
          ...new Map(
            models
              .map(describe)
              .filter((m) => !previous.has(m.id))
              .map((m) => [m.id, m]),
          ).values(),
        ];
        if (added.length)
          notify(
            `models:${id}:${added
              .map((m) => m.id)
              .sort()
              .join(",")}`,
            "new_model",
            `Novos modelos em ${NAMES[id]}`,
            added.map((m) => m.label).join(", "),
            { models: added },
          );
      }
      // Enrich older notices and their short aliases from the synchronized catalogue.
      for (const notice of state.notifications) {
        const prefix = `models:${id}:`;
        if (notice.category !== "new_model" || !notice.id.startsWith(prefix))
          continue;
        const ids =
          notice.models?.map((m) => m.id) ||
          notice.id.slice(prefix.length).split(",");
        notice.models = [
          ...new Map(ids.map(describe).map((m) => [m.id, m])).values(),
        ];
        notice.description = notice.models.map((m) => m.label).join(", ");
      }
      state.seen[id] = {
        installed: !!tool.installed,
        version: tool.version || old?.version,
        models: models.length && !tool.modelsError ? models : old?.models || [],
      };
      const latest = state.releases[id]?.version;
      if (tool.installed && newer(latest, tool.version))
        notify(
          `release:${id}:${latest}`,
          "cli_update",
          `${NAMES[id]} ${latest} disponível`,
          `Instalada: ${tool.version}. Atualize em Configurações.`,
        );
    }
    persist();
  }
  async function check(force = false) {
    if (checking) return checking;
    if (!force && now() - lastAttempt < 60 * 60 * 1000) return;
    lastAttempt = now();
    checking = (async () => {
      const urls = {
        claude:
          "https://api.github.com/repos/anthropics/claude-code/releases/latest",
        codex: "https://api.github.com/repos/openai/codex/releases/latest",
      };
      const arch =
        process.arch === "x64"
          ? "amd64"
          : process.arch === "arm64"
            ? "arm64"
            : null;
      const platform =
        process.platform === "win32" ? "windows" : process.platform;
      const musl =
        process.platform === "linux" &&
        !!process.report?.getReport?.().header &&
        !process.report.getReport().header.glibcVersionRuntime;
      if (arch)
        urls.antigravity = `https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/${platform}_${arch}${musl ? "_musl" : ""}.json`;
      await Promise.all(
        Object.entries(urls).map(async ([id, url]) => {
          try {
            const result = await request(url);
            const raw = id === "antigravity" ? result.version : result.tag_name;
            const version = raw?.replace(/^(?:rust-)?v/, "");
            if (!/^\d+\.\d+\.\d+$/.test(version || ""))
              throw new Error("Versão publicada inválida.");
            state.releases[id] = { version, error: null };
          } catch (e) {
            state.releases[id] = {
              ...state.releases[id],
              error: "Não foi possível verificar novas versões.",
            };
          }
        }),
      );
      state.checkedAt = new Date(now()).toISOString();
      persist();
    })().finally(() => (checking = null));
    return checking;
  }
  async function update(id) {
    if (!IDS.includes(id)) throw new Error("CLI inválida.");
    if (updating.has(id)) throw new Error("Atualização já em andamento.");
    const bin = find(id === "antigravity" ? "agy" : id);
    if (!bin) throw new Error("CLI não encontrada.");
    const command = updateCommand(id, bin, find);
    updating.add(id);
    try {
      await exec(command.bin, command.args, {
        timeout: 180000,
        maxBuffer: 1024 * 1024,
        cwd: os.homedir(),
      });
      const result = await exec(
        find(id === "antigravity" ? "agy" : id) || bin,
        ["--version"],
        { timeout: 10000 },
      );
      return {
        ok: true,
        version: result.stdout.match(/\d+\.\d+\.\d+/)?.[0] || null,
      };
    } catch {
      return {
        ok: false,
        error:
          "Não foi possível atualizar. Verifique conexão, permissões de instalação e o gerenciador da CLI. Nenhuma elevação automática foi executada.",
      };
    } finally {
      updating.delete(id);
    }
  }
  return {
    notifyOnce(id, category, title, description) {
      notify(id, category, title, description);
      persist();
    },
    observe,
    check,
    update,
    get: () => ({
      notifications: state.notifications,
      releases: state.releases,
      checkedAt: state.checkedAt,
    }),
    markRead() {
      state.notifications.forEach((n) => (n.isNew = false));
      persist();
      return this.get();
    },
  };
}
module.exports = { createEcosystem, newer, updateCommand };
