// Ditado por voz: transcreve o áudio gravado no composer (WAV mono 16 kHz) em texto.
// Padrão: Parakeet local (parakeet-cli do whisper.cpp), sem conta, sem chave e sem internet.
// Opcional: API compatível com OpenAI (gpt-4o-transcribe, Groq, servidor local…).
const fs = require("fs");
const os = require("os");
const path = require("path");
const spawn = require("cross-spawn");
const { redact } = require("./redact");
const { fixNamesBySound } = require("./speech-names");

const DEFAULTS = Object.freeze({
  engine: "local",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-transcribe",
  language: "pt",
  vocabulary: "",
});
// Limite da API da OpenAI (25 MB); em WAV 16 kHz mono são uns 13 minutos.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MIN_AUDIO_BYTES = 44 + 3200; // cabeçalho + ~0,1 s
const TIMEOUT_MS = 180_000;
const MAX_PROMPT_CHARS = 1500;

// Termos do dia a dia de quem programa que um modelo genérico costuma errar em português.
// Os que têm grafia própria (BeagleDock, TypeScript…) também são corrigidos pelo som.
const BASE_VOCABULARY = [
  "Claude Code",
  "Codex CLI",
  "Codex",
  "Antigravity",
  "BeagleDock",
  "ai-memory",
  "Claude",
  "Anthropic",
  "OpenAI",
  "Gemini",
  "ChatGPT",
  "Sonnet",
  "Opus",
  "Haiku",
  "GitHub",
  "GitLab",
  "TypeScript",
  "JavaScript",
  "Node.js",
  "Next.js",
  "React",
  "Electron",
  "Vite",
  "Tailwind",
  "Python",
  "Docker",
  "Kubernetes",
  "PostgreSQL",
  "SQLite",
  "MongoDB",
  "Redis",
  "Supabase",
  "Vercel",
  "Postman",
  "Sentry",
  "Figma",
  "VS Code",
  "Linux",
  "Ubuntu",
  "Debian",
  "MCP",
  "API",
  "JSON",
  "YAML",
  "SQL",
  "CI/CD",
  "npm",
  "handoff",
  "commit",
  "merge",
  "rebase",
  "pull request",
  "branch",
  "worktree",
  "deploy",
  "refactor",
  "endpoint",
  "frontend",
  "backend",
  "webhook",
  "token",
  "hook",
  "prompt",
  "build",
  "bug",
  "debug",
  "log",
  "release",
  "changelog",
  "plan mode",
  "skill",
];

// Nomes de uma palavra só que podem ser corrigidos pelo som: não soam como nenhuma palavra
// do português ("Sentry" ficaria perto de "sentir", "Postman" de "postam"; esses ficam fora).
const SOUND_SAFE_NAMES = ["Codex", "Anthropic", "Supabase", "Kubernetes", "ChatGPT"];

// Confusões frequentes que o som sozinho não resolve: "cloud" (nuvem) existe de verdade,
// então só a expressão completa vira o nome da ferramenta.
const BASE_REPLACEMENTS = [
  { from: "cloud code", to: "Claude Code" },
  { from: "clode code", to: "Claude Code" },
  { from: "cloud desktop", to: "Claude Desktop" },
  { from: "cloud sonnet", to: "Claude Sonnet" },
  { from: "cloud opus", to: "Claude Opus" },
  { from: "cloud haiku", to: "Claude Haiku" },
  { from: "codex cli", to: "Codex CLI" },
  { from: "anti gravity", to: "Antigravity" },
  { from: "ai memory", to: "ai-memory" },
  { from: "pul request", to: "pull request" },
  { from: "git hub", to: "GitHub" },
  { from: "type script", to: "TypeScript" },
  { from: "java script", to: "JavaScript" },
  { from: "node js", to: "Node.js" },
  { from: "next js", to: "Next.js" },
];

class SpeechModelMissingError extends Error {
  constructor(model) {
    super(`Baixe o modelo de voz (${model.label}) para usar o ditado local.`);
    this.code = "SPEECH_MODEL_MISSING";
  }
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/** Configuração efetiva do ditado, com os padrões aplicados. */
function resolveDictationConfig(settings) {
  const raw = (settings && settings.voiceDictation) || {};
  return {
    engine: raw.engine === "api" ? "api" : "local",
    baseUrl: text(raw.baseUrl, DEFAULTS.baseUrl).replace(/\/+$/, ""),
    model: text(raw.model, DEFAULTS.model),
    language: text(raw.language, DEFAULTS.language),
    vocabulary: text(raw.vocabulary),
  };
}

/** Entradas do vocabulário: "termo" fixa a grafia; "errado => certo" troca o que sair errado. */
function parseVocabulary(vocabulary = "") {
  const terms = [];
  const replacements = [];
  for (const raw of String(vocabulary).split(/[,;\n]/)) {
    const entry = raw.trim().replace(/\s+/g, " ");
    if (!entry || entry.length > 120) continue;
    const arrow = entry.split(/\s*=>\s*/);
    if (arrow.length === 2 && arrow[0] && arrow[1]) replacements.push({ from: arrow[0], to: arrow[1] });
    else if (arrow.length === 1) terms.push(entry);
  }
  return { terms, replacements };
}

/** Lista de termos sem repetição, preservando a ordem: a do usuário vem primeiro. */
function vocabularyTerms({ vocabulary = "", context = [] } = {}) {
  const { terms: own, replacements } = parseVocabulary(vocabulary);
  const seen = new Set();
  const terms = [];
  for (const term of [...own, ...replacements.map((r) => r.to), ...context, ...BASE_VOCABULARY]) {
    const clean = String(term || "").trim().replace(/\s+/g, " ");
    if (!clean || clean.length > 60 || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    terms.push(clean);
  }
  return terms;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Palavra inteira e solta: não mexe dentro de caminho, arquivo ou variável (`~/.app`,
// `package.json`, `APP_DIR`).
const wordPattern = (phrase) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}_./\\\\:\`@-])${escapeRegExp(phrase).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}_/\\\\\`@-]|\\.[\\p{L}\\p{N}])`,
    "giu",
  );

/**
 * Corrige a transcrição com o vocabulário: troca "errado => certo" e acerta a grafia de
 * termos conhecidos (ex.: "claude code" → "Claude Code"). Funciona com qualquer motor.
 */
function applyVocabulary(transcript, { vocabulary = "", context = [] } = {}) {
  let result = String(transcript || "");
  const { terms: own, replacements } = parseVocabulary(vocabulary);
  // As trocas da pessoa vêm antes das do app, para poder sobrepor qualquer uma delas.
  for (const { from, to } of [...replacements, ...BASE_REPLACEMENTS])
    result = result.replace(wordPattern(from), to);
  // Nomes da sessão (pasta, workspace) podem ser palavras comuns ("Testes"): só entram os
  // que têm grafia claramente própria, como "RumofyNext".
  const distinctive = context.filter((term) => /\p{Lu}/u.test(String(term).slice(1)));
  // O que soa como um nome conhecido ("Bigodok") vira o nome ("BeagleDock").
  result = fixNamesBySound(
    result,
    [...distinctive, ...BASE_VOCABULARY],
    [...own, ...replacements.map((r) => r.to), ...SOUND_SAFE_NAMES],
  );
  for (const term of vocabularyTerms({ vocabulary, context: distinctive })) {
    if (term.length < 3 || term === term.toLowerCase()) continue; // só termos com grafia própria
    result = result.replace(wordPattern(term), term);
  }
  return result;
}

/**
 * Contexto para modelos que aceitam dica (API): ditado para um assistente de programação,
 * com os nomes próprios e termos técnicos que precisam sair escritos exatamente assim.
 */
function buildPrompt({ language, vocabulary, context }) {
  const intro =
    language === "pt" || language === "auto"
      ? "Ditado em português do Brasil para um assistente de programação. Termos técnicos em inglês são mantidos em inglês. Use pontuação correta."
      : "Dictation for a coding assistant. Keep technical terms verbatim and use proper punctuation.";
  let prompt = `${intro} Vocabulário: `;
  for (const term of vocabularyTerms({ vocabulary, context })) {
    const next = `${prompt}${prompt.endsWith(": ") ? "" : ", "}${term}`;
    if (next.length > MAX_PROMPT_CHARS) break;
    prompt = next;
  }
  return `${prompt}.`;
}

/** Valida o áudio recebido do renderer (base64 de um WAV). */
function decodeWav(base64) {
  if (typeof base64 !== "string" || !base64) throw new Error("Áudio vazio.");
  if (base64.length > Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 4)
    throw new Error("Gravação longa demais para transcrever (limite de 25 MB).");
  const audio = Buffer.from(base64, "base64");
  if (audio.length > MAX_AUDIO_BYTES)
    throw new Error("Gravação longa demais para transcrever (limite de 25 MB).");
  if (
    audio.length < 12 ||
    audio.toString("ascii", 0, 4) !== "RIFF" ||
    audio.toString("ascii", 8, 12) !== "WAVE"
  )
    throw new Error("Formato de áudio inválido.");
  if (audio.length < MIN_AUDIO_BYTES) throw new Error("Gravação curta demais.");
  return audio;
}

/** Remove marcações que não são fala ([BLANK_AUDIO], [Música]…) e junta as linhas. */
function cleanTranscript(raw) {
  return String(raw || "")
    .replace(/\[[^\]\n]{1,40}\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLocalHost(url) {
  try {
    const { hostname } = new URL(url);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
  } catch {
    return false;
  }
}

async function transcribeWithApi({ audio, config, apiKey, prompt, fetchImpl = fetch }) {
  let url;
  try {
    url = new URL(`${config.baseUrl}/audio/transcriptions`);
  } catch {
    throw new Error("Endereço da API de transcrição inválido.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHost(url.href)))
    throw new Error("A API de transcrição precisa usar https (http só para localhost).");
  if (!apiKey && !isLocalHost(url.href))
    throw new Error(
      "Cadastre a chave da API de transcrição em Configurações → Ditado por voz.",
    );
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/wav" }), "ditado.wav");
  form.append("model", config.model);
  if (config.language && config.language !== "auto")
    form.append("language", config.language);
  form.append("prompt", prompt);
  form.append("response_format", "json");
  form.append("temperature", "0");
  let response;
  try {
    response = await fetchImpl(url.href, {
      method: "POST",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "TimeoutError")
      throw new Error("A transcrição demorou demais para responder.");
    throw new Error(`Não foi possível falar com a API de transcrição: ${redact(error.message)}`);
  }
  const body = await response.text();
  let data = null;
  try {
    data = JSON.parse(body);
  } catch {}
  if (!response.ok) {
    const detail = data?.error?.message || data?.error || body.slice(0, 300);
    throw new Error(
      `Transcrição recusada (HTTP ${response.status}): ${redact(String(detail || "sem detalhes"))}`,
    );
  }
  if (typeof data?.text !== "string") throw new Error("Resposta da transcrição sem texto.");
  return cleanTranscript(data.text);
}

/** Threads para o modelo local: os núcleos de desempenho bastam; mais que 8 não ajuda. */
function localThreads(cpuCount = os.cpus().length) {
  return Math.max(1, Math.min(8, cpuCount - 2));
}

/** Roda o parakeet-cli com o WAV num arquivo temporário privado e devolve o texto. */
async function transcribeLocally({ audio, binary, modelPath, spawnImpl = spawn, fsApi = fs, threads = localThreads() }) {
  if (!binary)
    throw new Error(
      "Motor de ditado local não encontrado. Rode `npm run build:speech` (ou `npm run build`) para compilá-lo.",
    );
  const dir = fsApi.mkdtempSync(path.join(os.tmpdir(), "beagledock-ditado-"));
  const file = path.join(dir, "ditado.wav");
  try {
    fsApi.writeFileSync(file, audio, { mode: 0o600 });
    const args = ["-m", modelPath, "-f", file, "-t", String(threads), "-np"];
    return await new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let child;
      try {
        child = spawnImpl(binary, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      } catch (error) {
        reject(new Error(`Não foi possível iniciar o motor de ditado: ${error.message}`));
        return;
      }
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("O motor de ditado demorou demais para transcrever."));
      }, TIMEOUT_MS);
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-2000)));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`Falha no motor de ditado: ${error.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(cleanTranscript(stdout));
        else
          reject(
            new Error(
              `O motor de ditado terminou com erro (${code}): ${stderr.trim().split("\n").pop() || "sem detalhes"}`,
            ),
          );
      });
    });
  } finally {
    try {
      fsApi.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

/** Caminho do parakeet-cli: recurso do pacote instalado ou vendor/ do repositório. */
function findLocalEngine({ resourcesPath = process.resourcesPath, appRoot = path.join(__dirname, ".."), fsApi = fs } = {}) {
  const candidates = [
    resourcesPath && path.join(resourcesPath, "speech", "parakeet-cli"),
    path.join(appRoot, "vendor", "speech", "parakeet-cli"),
  ].filter(Boolean);
  return candidates.find((file) => {
    try {
      fsApi.accessSync(file, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) || null;
}

/**
 * Transcreve uma gravação. `request.context` traz termos da sessão atual (projeto,
 * arquivos citados) que viram dica para a API e correção de grafia em qualquer motor.
 */
async function transcribeAudio(request, deps) {
  const { getSettings, getSecret, fetchImpl, spawnImpl, fsApi, models, findEngine = findLocalEngine } = deps;
  const audio = decodeWav(request?.audio);
  const config = resolveDictationConfig(await getSettings());
  const context = Array.isArray(request?.context)
    ? request.context.filter((t) => typeof t === "string").slice(0, 40)
    : [];
  let transcript;
  let model;
  if (config.engine === "local") {
    const status = models.status();
    if (!status.installed) throw new SpeechModelMissingError(status);
    transcript = await transcribeLocally({
      audio,
      binary: findEngine(),
      modelPath: models.modelPath(status.id),
      spawnImpl,
      fsApi,
    });
    model = status.label;
  } else {
    transcript = await transcribeWithApi({
      audio,
      config,
      fetchImpl,
      prompt: buildPrompt({ language: config.language, vocabulary: config.vocabulary, context }),
      apiKey: await getSecret("transcriptionApiKey"),
    });
    model = config.model;
  }
  return {
    text: applyVocabulary(transcript, { vocabulary: config.vocabulary, context }),
    engine: config.engine,
    model,
  };
}

module.exports = {
  DEFAULTS,
  MAX_AUDIO_BYTES,
  SpeechModelMissingError,
  resolveDictationConfig,
  parseVocabulary,
  vocabularyTerms,
  applyVocabulary,
  buildPrompt,
  decodeWav,
  cleanTranscript,
  localThreads,
  transcribeWithApi,
  transcribeLocally,
  findLocalEngine,
  transcribeAudio,
};
