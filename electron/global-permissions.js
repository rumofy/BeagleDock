const fs = require("fs");
const os = require("os");
const path = require("path");
const { parse } = require("smol-toml");
const { isDeepStrictEqual } = require("util");
const { settingsPath } = require("./agy-permissions");
const FIELDS = {
  claude: {
    mode: {
      label: "Modo padrão",
      values: [
        "default",
        "acceptEdits",
        "plan",
        "auto",
        "dontAsk",
        "bypassPermissions",
      ],
    },
  },
  codex: {
    sandbox_mode: {
      label: "Sandbox",
      values: ["read-only", "workspace-write", "danger-full-access"],
    },
    approval_policy: { label: "Aprovações", values: ["on-request", "never"] },
  },
  antigravity: {
    toolPermission: {
      label: "Política de ferramentas",
      values: [
        "request-review",
        "proceed-in-sandbox",
        "strict",
        "always-proceed",
      ],
    },
    agentMode: {
      label: "Modo padrão",
      values: ["plan", "accept-edits", "auto"],
    },
  },
};
const VALUE_LABELS = {
  default: "Solicitar aprovação",
  acceptEdits: "Aceitar edições",
  plan: "Planejar",
  auto: "Automático",
  dontAsk: "Negar ações que exigem aprovação",
  bypassPermissions: "Acesso total sem confirmação",
  "read-only": "Somente leitura",
  "workspace-write": "Escrita no projeto",
  "danger-full-access": "Acesso total sem sandbox",
  "on-request": "Solicitar quando necessário",
  never: "Sem aprovações interativas",
  "request-review": "Solicitar revisão",
  "proceed-in-sandbox": "Permitir comandos no sandbox",
  strict: "Solicitar para todas as ações",
  "always-proceed": "Permitir sem confirmação",
  "accept-edits": "Aceitar edições",
};
function createGlobalPermissions({
  home = os.homedir(),
  env = process.env,
} = {}) {
  const files = {
    claude: path.join(
      env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"),
      "settings.json",
    ),
    codex: path.join(
      env.CODEX_HOME || path.join(home, ".codex"),
      "config.toml",
    ),
    antigravity: settingsPath({ home, env }),
  };
  function load(id) {
    if (!FIELDS[id]) throw new Error("CLI inválida.");
    let text = "";
    try {
      text = fs.readFileSync(files[id], "utf8");
    } catch (e) {
      if (e.code !== "ENOENT")
        throw new Error("Não foi possível ler a configuração global.");
    }
    try {
      const data = id === "codex" ? parse(text) : text ? JSON.parse(text) : {};
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new Error("Configuração inválida.");
      return { text, data };
    } catch {
      throw new Error(
        "Configuração global inválida; corrija o arquivo antes de salvar.",
      );
    }
  }
  function get(id) {
    try {
      const { data } = load(id);
      const values =
        id === "claude" ? { mode: data.permissions?.defaultMode } : data;
      return {
        providerId: id,
        fields: Object.entries(FIELDS[id]).map(([key, field]) => ({
          key,
          ...field,
          valueLabels: Object.fromEntries(
            field.values.map((value) => [value, VALUE_LABELS[value] || value]),
          ),
          value: typeof values[key] === "string" ? values[key] : "",
        })),
      };
    } catch (e) {
      return { providerId: id, fields: [], error: e.message };
    }
  }
  function save(id, changes) {
    if (
      !FIELDS[id] ||
      !changes ||
      typeof changes !== "object" ||
      Array.isArray(changes) ||
      !Object.keys(changes).length
    )
      throw new Error("Política inválida.");
    for (const [key, value] of Object.entries(changes))
      if (!FIELDS[id][key]?.values.includes(value))
        throw new Error("Permissão global inválida.");
    const { text, data } = load(id);
    let output;
    if (id === "codex") {
      // Edit root scalars only, preserving comments, profiles, MCPs and all other tables.
      let lines = text.split(/\r?\n/),
        firstTable = lines.findIndex((l) => /^\s*\[/.test(l));
      if (firstTable < 0) firstTable = lines.length;
      for (const [key, value] of Object.entries(changes)) {
        const index = lines.findIndex(
          (line, i) =>
            i < firstTable && new RegExp("^\\s*" + key + "\\s*=").test(line),
        );
        if (data[key] !== undefined && index < 0)
          throw new Error(
            "Esse campo usa uma tabela avançada; edite-o diretamente no arquivo da CLI.",
          );
        const entry = `${key} = ${JSON.stringify(value)}`;
        if (index >= 0) lines[index] = entry;
        else {
          lines.splice(firstTable, 0, entry);
          firstTable++;
        }
      }
      output = lines.join("\n");
      if (
        !isDeepStrictEqual(
          parse(output),
          Object.assign(Object.create(null), data, changes),
        )
      )
        throw new Error(
          "Formato avançado de TOML: edite esse campo diretamente na CLI.",
        );
    } else {
      if (id === "claude")
        data.permissions = { ...data.permissions, defaultMode: changes.mode };
      else Object.assign(data, changes);
      output = JSON.stringify(data, null, 2) + "\n";
    }
    fs.mkdirSync(path.dirname(files[id]), { recursive: true, mode: 0o700 });
    const temp = files[id] + `.bleagledock-${process.pid}-${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temp, output, { mode: 0o600, flag: "wx" });
      let current = "";
      try {
        current = fs.readFileSync(files[id], "utf8");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      if (current !== text)
        throw new Error(
          "Configuração alterada por outro processo. Recarregue e tente novamente.",
        );
      fs.renameSync(temp, files[id]);
    } finally {
      try {
        fs.unlinkSync(temp);
      } catch {}
    }
    return get(id);
  }
  // Only a fingerprint crosses into the runner; configuration contents stay in the main process.
  function fingerprint(id) {
    return require("crypto")
      .createHash("sha256")
      .update(load(id).text)
      .digest("hex");
  }
  return { get, save, fingerprint, all: () => Object.keys(FIELDS).map(get) };
}
module.exports = { createGlobalPermissions };
