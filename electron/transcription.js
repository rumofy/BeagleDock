// Voice dictation: transcribes the audio recorded in the composer (16 kHz mono WAV) into text.
// Default: local Parakeet (whisper.cpp's parakeet-cli), no account, no key and no internet.
// Optional: an OpenAI-compatible API (gpt-4o-transcribe, Groq, local server…).
const fs = require("fs");
const os = require("os");
const path = require("path");
const spawn = require("cross-spawn");
const { redact } = require("./redact");
const { fixNamesBySound } = require("./speech-names");
const { t } = require("./i18n");

const DEFAULTS = Object.freeze({
  engine: "local",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-transcribe",
  language: "pt",
  vocabulary: "",
});
// OpenAI API limit (25 MB); in 16 kHz mono WAV that's about 13 minutes.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MIN_AUDIO_BYTES = 44 + 3200; // header + ~0.1 s
const TIMEOUT_MS = 180_000;
const MAX_PROMPT_CHARS = 1500;

class SpeechModelMissingError extends Error {
  constructor(model) {
    super(t("dictation.modelMissing", { model: model.label }));
    this.code = "SPEECH_MODEL_MISSING";
  }
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/** Effective dictation settings, with the defaults applied. */
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

/** Vocabulary entries: "term" fixes the spelling; "wrong => right" replaces what comes out wrong. */
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

/** List of terms without repeats, keeping the order: the user's come first. */
function vocabularyTerms({ vocabulary = "", context = [] } = {}) {
  const { terms: own, replacements } = parseVocabulary(vocabulary);
  const seen = new Set();
  const terms = [];
  for (const term of [...own, ...replacements.map((r) => r.to), ...context]) {
    const clean = String(term || "").trim().replace(/\s+/g, " ");
    if (!clean || clean.length > 60 || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    terms.push(clean);
  }
  return terms;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Whole, standalone word: doesn't touch the inside of a path, file or variable (`~/.app`,
// `package.json`, `APP_DIR`).
const wordPattern = (phrase) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}_./\\\\:\`@-])${escapeRegExp(phrase).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}_/\\\\\`@-]|\\.[\\p{L}\\p{N}])`,
    "giu",
  );

/**
 * Fixes the transcription with the vocabulary: replaces "wrong => right" and fixes the spelling of
 * known terms (e.g. "claude code" → "Claude Code"). Works with any engine.
 */
function applyVocabulary(transcript, options = {}) {
  // URLs pass through intact (`?logo=linux` doesn't become `?logo=Linux`); only the text around is fixed.
  return String(transcript || "")
    .split(URL_PATTERN)
    .map((part, i) => (i % 2 ? part : applyVocabularyToText(part, options)))
    .join("");
}

const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<>()[\]`]+)/i;

function applyVocabularyToText(text, { vocabulary = "", context = [] } = {}) {
  let result = text;
  const { terms: own, replacements } = parseVocabulary(vocabulary);
  for (const { from, to } of replacements)
    result = result.replace(wordPattern(from), to);
  // Session names (folder, workspace) may be common words ("Testes"): only the ones
  // with a clearly own spelling, like "RumofyNext", get in.
  const distinctive = context.filter((term) => /\p{Lu}/u.test(String(term).slice(1)));
  // What sounds like a known name ("Bigodok") becomes the name ("BeagleDock").
  result = fixNamesBySound(result, distinctive, [...own, ...replacements.map((r) => r.to)]);
  for (const term of vocabularyTerms({ vocabulary, context: distinctive })) {
    if (term.length < 3 || term === term.toLowerCase()) continue; // only terms with their own spelling
    result = result.replace(wordPattern(term), term);
  }
  return result;
}

/**
 * Context for models that accept a hint (API): dictation for a coding assistant,
 * with the proper names and technical terms that must come out written exactly like this.
 */
const DICTATION_HINTS = {
  pt: {
    intro:
      "Ditado em português do Brasil para um assistente de programação. Termos técnicos em inglês são mantidos em inglês. Use pontuação correta.",
    vocabulary: "Vocabulário",
  },
  es: {
    intro:
      "Dictado en español para un asistente de programación. Los términos técnicos en inglés se mantienen en inglés. Usa la puntuación correcta.",
    vocabulary: "Vocabulario",
  },
  en: {
    intro: "Dictation for a coding assistant. Keep technical terms verbatim and use proper punctuation.",
    vocabulary: "Vocabulary",
  },
};
function buildPrompt({ language, vocabulary, context }) {
  // The hint follows the dictation language (not the interface's): it's what the speech model hears.
  const hint = DICTATION_HINTS[language === "auto" ? "pt" : language] || DICTATION_HINTS.en;
  let prompt = `${hint.intro} ${hint.vocabulary}: `;
  for (const term of vocabularyTerms({ vocabulary, context })) {
    const next = `${prompt}${prompt.endsWith(": ") ? "" : ", "}${term}`;
    if (next.length > MAX_PROMPT_CHARS) break;
    prompt = next;
  }
  return `${prompt}.`;
}

/** Validates the audio received from the renderer (base64 of a WAV). */
function decodeWav(base64) {
  if (typeof base64 !== "string" || !base64) throw new Error(t("dictation.emptyAudio"));
  if (base64.length > Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 4)
    throw new Error(t("dictation.tooLong"));
  const audio = Buffer.from(base64, "base64");
  if (audio.length > MAX_AUDIO_BYTES)
    throw new Error(t("dictation.tooLong"));
  if (
    audio.length < 12 ||
    audio.toString("ascii", 0, 4) !== "RIFF" ||
    audio.toString("ascii", 8, 12) !== "WAVE"
  )
    throw new Error(t("dictation.invalidFormat"));
  if (audio.length < MIN_AUDIO_BYTES) throw new Error(t("dictation.tooShort"));
  return audio;
}

/** Removes markings that aren't speech ([BLANK_AUDIO], [Music]…) and joins the lines. */
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
    throw new Error(t("dictation.invalidApiUrl"));
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHost(url.href)))
    throw new Error(t("dictation.httpsOnly"));
  if (!apiKey && !isLocalHost(url.href))
    throw new Error(
      t("dictation.apiKeyMissing"),
    );
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/wav" }), "dictation.wav");
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
      throw new Error(t("dictation.apiTimeout"));
    throw new Error(t("dictation.apiUnreachable", { error: redact(error.message) }));
  }
  const body = await response.text();
  let data = null;
  try {
    data = JSON.parse(body);
  } catch {}
  if (!response.ok) {
    const detail = data?.error?.message || data?.error || body.slice(0, 300);
    throw new Error(
      t("dictation.apiRefused", { status: response.status, detail: redact(String(detail || t("dictation.noDetails"))) }),
    );
  }
  if (typeof data?.text !== "string") throw new Error(t("dictation.noText"));
  return cleanTranscript(data.text);
}

/** Threads for the local model: the performance cores are enough; more than 8 doesn't help. */
function localThreads(cpuCount = os.cpus().length) {
  return Math.max(1, Math.min(8, cpuCount - 2));
}

/** Runs parakeet-cli with the WAV in a private temporary file and returns the text. */
async function transcribeLocally({ audio, binary, modelPath, spawnImpl = spawn, fsApi = fs, threads = localThreads() }) {
  if (!binary)
    throw new Error(
      t("dictation.engineMissing"),
    );
  const dir = fsApi.mkdtempSync(path.join(os.tmpdir(), "beagledock-dictation-"));
  const file = path.join(dir, "dictation.wav");
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
        reject(new Error(t("dictation.engineStartFailed", { error: error.message })));
        return;
      }
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(t("dictation.engineTimeout")));
      }, TIMEOUT_MS);
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-2000)));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new Error(t("dictation.engineFailed", { error: error.message })));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(cleanTranscript(stdout));
        else
          reject(
            new Error(
              t("dictation.engineExited", { code, detail: stderr.trim().split("\n").pop() || t("dictation.noDetails") }),
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

/** Path of parakeet-cli: a resource of the installed package or the repository's vendor/. */
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
 * Transcribes a recording. `request.context` carries terms of the current session (project,
 * mentioned files) that become a hint for the API and a spelling fix in any engine.
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
