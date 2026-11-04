const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), vm = require("node:vm");
const { EventEmitter } = require("node:events");
const ts = require("typescript");
const t = require("../electron/transcription");
const { revealSecret, protectSettings, publicSettings } = require("../electron/secure-settings");

const out = ts.transpileModule(fs.readFileSync(path.resolve("src/lib/wav.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const ctx = { exports: {}, Math, Float32Array, Uint8Array, DataView, String, btoa };
vm.runInNewContext(out, ctx);
const wav = ctx.exports;

function speechWav(seconds = 0.5) {
  const samples = new Float32Array(16000 * seconds);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.3 * Math.sin(i / 5);
  return Buffer.from(wav.encodeWav(samples, 16000));
}
const audio64 = () => speechWav().toString("base64");
// The app ships no fixed names: the tests use a registered vocabulary like a user's.
const VOCAB = "BeagleDock, Claude Code, Codex CLI, Codex, ai-memory, TypeScript, React, JSON, GitHub, GitLab";

test("a WAV generated in the renderer has a 16-bit mono PCM header and is accepted by the backend", () => {
  const bytes = speechWav(0.25);
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
  assert.equal(bytes.readUInt16LE(22), 1);
  assert.equal(bytes.readUInt32LE(24), 16000);
  assert.equal(bytes.readUInt16LE(34), 16);
  assert.equal(bytes.length, 44 + 4000 * 2);
  assert.equal(Buffer.from(wav.toBase64(new Uint8Array(bytes)), "base64").equals(bytes), true);
  assert.equal(t.decodeWav(bytes.toString("base64")).length, bytes.length);
});

test("silence isn't sent; a quiet voice is normalized without amplifying pure noise", () => {
  assert.equal(wav.hasSpeech(new Float32Array(16000)), false);
  const quiet = new Float32Array(1000).map((_, i) => 0.2 * Math.sin(i));
  assert.equal(wav.hasSpeech(quiet), true);
  const loud = wav.normalizePeak(quiet);
  assert.ok(Math.max(...loud) > 0.85 && Math.max(...loud) <= 0.9001);
  // Gain limited to 8x: very low noise doesn't become a shout.
  assert.ok(Math.max(...wav.normalizePeak(new Float32Array(100).fill(0.01))) <= 0.0801);
  const silence = new Float32Array(10);
  assert.equal(wav.normalizePeak(silence), silence);
});

test("dictated text goes in at the cursor with spaces only where missing", () => {
  assert.deepEqual({ ...wav.insertDictation("", 0, " Olá mundo ") }, { text: "Olá mundo", caret: 9 });
  assert.deepEqual({ ...wav.insertDictation("corrige", 7, "o bug") }, { text: "corrige o bug", caret: 13 });
  assert.deepEqual({ ...wav.insertDictation("antes depois", 5, "meio") }, { text: "antes meio depois", caret: 10 });
  assert.deepEqual({ ...wav.insertDictation("abc", 99, "") }, { text: "abc", caret: 99 });
});

test("appendDictation continues at the end of the text and leaves the cursor at the end", () => {
  const first = wav.appendDictation("", "Primeira observação.");
  const second = wav.appendDictation(first.text, "Segunda observação.");
  assert.deepEqual({ ...second }, { text: "Primeira observação. Segunda observação.", caret: 40 });
  assert.deepEqual({ ...wav.appendDictation("linha ", " mais") }, { text: "linha mais", caret: 10 });
  assert.deepEqual({ ...wav.appendDictation("abc", "  ") }, { text: "abc", caret: 3 });
});

test("decodeWav refuses empty, wrong format, too short and above 25 MB", () => {
  assert.throws(() => t.decodeWav(""), /Empty/);
  assert.throws(() => t.decodeWav(Buffer.from("OggS".padEnd(5000, "x")).toString("base64")), /Invalid/);
  assert.throws(() => t.decodeWav(Buffer.from(wav.encodeWav(new Float32Array(10), 16000)).toString("base64")), /too short/);
  assert.throws(() => t.decodeWav("A".repeat(36 * 1024 * 1024)), /25 MB/);
});

test("the default setting is local dictation; the API only when chosen", () => {
  const c = t.resolveDictationConfig({});
  assert.equal(c.engine, "local");
  assert.equal(c.model, "gpt-4o-transcribe");
  assert.equal(c.language, "pt");
  assert.equal(c.baseUrl, "https://api.openai.com/v1");
  const api = t.resolveDictationConfig({ voiceDictation: { engine: "api", baseUrl: "http://x/v1///" } });
  assert.equal(api.engine, "api");
  assert.equal(api.baseUrl, "http://x/v1");
  assert.equal(t.resolveDictationConfig({ voiceDictation: { engine: "whisper" } }).engine, "local");
});

test("the vocabulary fixes the transcription: 'wrong => right' swaps and name spelling", () => {
  const vocabulary = "cloud code => Claude Code\nsupabase, Rumofy; =>, a => ";
  const withNames = `${vocabulary}\n${VOCAB}`;
  assert.deepEqual(t.parseVocabulary(vocabulary), {
    terms: ["supabase", "Rumofy"],
    replacements: [{ from: "cloud code", to: "Claude Code" }],
  });
  const fixed = t.applyVocabulary("Abre o cloud  code e o codex cli no rumofynext, rumofy e typescript. Faça os testes.", {
    vocabulary: withNames,
    context: ["RumofyNext", "Testes"],
  });
  assert.equal(fixed, "Abre o Claude Code e o Codex CLI no RumofyNext, Rumofy e TypeScript. Faça os testes.");
  // Whole words only: "reactivo" doesn't become "Reactivo"; accents count as letters.
  assert.equal(t.applyVocabulary("reactivo react ação", { vocabulary: VOCAB }), "reactivo React ação");
  // Without a registered vocabulary nothing is swapped: the app ships no fixed names.
  assert.equal(t.applyVocabulary("o Bigodok no git hub em typescript", {}), "o Bigodok no git hub em typescript");
});

test("the prompt carries the user's and the session's vocabulary first, without repeats and with a limit", () => {
  const prompt = t.buildPrompt({ language: "pt", vocabulary: "Rumofy, supabase\nRumofy, Claude Code, Codex CLI", context: ["RumofyNext", "claude code"] });
  assert.match(prompt, /português do Brasil/);
  assert.match(prompt, /Vocabulário: Rumofy, supabase, Claude Code, Codex CLI, RumofyNext\.$/);
  assert.equal((prompt.match(/Rumofy,/g) || []).length, 1);
  assert.doesNotMatch(prompt, /claude code/); // already came from the vocabulary in another spelling
  const huge = t.buildPrompt({ language: "pt", vocabulary: Array.from({ length: 500 }, (_, i) => `termo${i}`).join(",") });
  assert.ok(huge.length <= 1501);
  assert.match(t.buildPrompt({ language: "en" }), /^Dictation/);
});

test("API: sends multipart with model, language, prompt and key; returns the clean text", async () => {
  let call;
  const fetchImpl = async (url, init) => {
    call = { url, init };
    return new Response(JSON.stringify({ text: " Corrige o bug [BLANK_AUDIO] no  Claude Code. " }), { status: 200 });
  };
  const result = await t.transcribeAudio(
    { audio: audio64(), context: ["RumofyNext", 42] },
    {
      getSettings: async () => ({ voiceDictation: { engine: "api" } }),
      getSecret: async (key) => (key === "transcriptionApiKey" ? "sk-teste" : ""),
      fetchImpl,
    },
  );
  assert.deepEqual(result, { text: "Corrige o bug no Claude Code.", engine: "api", model: "gpt-4o-transcribe" });
  assert.equal(call.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(call.init.headers.Authorization, "Bearer sk-teste");
  const form = call.init.body;
  assert.equal(form.get("model"), "gpt-4o-transcribe");
  assert.equal(form.get("language"), "pt");
  assert.equal(form.get("temperature"), "0");
  assert.match(form.get("prompt"), /RumofyNext/);
  assert.equal(form.get("file").type, "audio/wav");
});

test("API: automatic language doesn't send language; a server error comes out without leaking the key", async () => {
  let form;
  await t.transcribeWithApi({
    audio: speechWav(),
    config: t.resolveDictationConfig({ voiceDictation: { language: "auto" } }),
    apiKey: "k",
    prompt: "p",
    fetchImpl: async (_u, init) => ((form = init.body), new Response('{"text":"ok"}')),
  });
  assert.equal(form.has("language"), false);
  await assert.rejects(
    t.transcribeWithApi({
      audio: speechWav(),
      config: t.resolveDictationConfig({}),
      apiKey: "k",
      prompt: "p",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { message: "Incorrect API key provided: sk-abcdefghijklmnopqrstuvwxyz" } }), { status: 401 }),
    }),
    (e) => /HTTP 401/.test(e.message) && !/sk-abcdefghijklmnop/.test(e.message),
  );
});

test("API: requires a key and https, but accepts a local server without a key", async () => {
  const deps = (voiceDictation, key = "") => ({
    getSettings: async () => ({ voiceDictation: { engine: "api", ...voiceDictation } }),
    getSecret: async () => key,
    fetchImpl: async () => new Response('{"text":"local"}'),
  });
  await assert.rejects(t.transcribeAudio({ audio: audio64() }, deps({})), /Add the transcription API key/);
  await assert.rejects(t.transcribeAudio({ audio: audio64() }, deps({ baseUrl: "http://exemplo.com/v1" }, "k")), /https/);
  const local = await t.transcribeAudio({ audio: audio64() }, deps({ baseUrl: "http://127.0.0.1:8000/v1" }));
  assert.equal(local.text, "local");
});

function fakeSpawn({ stdout = "", code = 0, error } = {}) {
  const calls = [];
  const spawnImpl = (cmd, args) => {
    calls.push({ cmd, args, file: fs.existsSync(args[3]) && fs.readFileSync(args[3]) });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      if (error) return child.emit("error", error);
      child.stdout.emit("data", stdout);
      if (code) child.stderr.emit("data", "falha ao carregar modelo\n");
      child.emit("close", code);
    });
    return child;
  };
  return { spawnImpl, calls };
}

const fakeModels = (installed = true) => ({
  status: () => ({ id: "parakeet", label: "Parakeet TDT 0.6B v3", size: 10, installed, downloading: false, received: 0 }),
  modelPath: () => "/modelos/parakeet.bin",
});

test("local: runs parakeet-cli with model and threads, fixes the vocabulary and deletes the temp file", async () => {
  const { spawnImpl, calls } = fakeSpawn({ stdout: " Olá, beagledock.\n Tudo certo.\n" });
  const result = await t.transcribeAudio(
    { audio: audio64() },
    {
      getSettings: async () => ({ voiceDictation: { vocabulary: "BeagleDock" } }),
      getSecret: async () => assert.fail("local mode doesn't read a key"),
      spawnImpl,
      models: fakeModels(),
      findEngine: () => "/app/speech/parakeet-cli",
    },
  );
  assert.deepEqual(result, { text: "Olá, BeagleDock. Tudo certo.", engine: "local", model: "Parakeet TDT 0.6B v3" });
  assert.equal(calls[0].cmd, "/app/speech/parakeet-cli");
  assert.deepEqual(calls[0].args.slice(0, 2), ["-m", "/modelos/parakeet.bin"]);
  assert.equal(calls[0].args[calls[0].args.indexOf("-t") + 1], String(t.localThreads()));
  assert.ok(calls[0].args.includes("-np"));
  assert.equal(calls[0].file.toString("ascii", 0, 4), "RIFF");
  assert.equal(fs.existsSync(path.dirname(calls[0].args[3])), false);
});

test("local: a missing model gets its own code; a missing or failing engine gives clear messages", async () => {
  await assert.rejects(
    t.transcribeAudio({ audio: audio64() }, { getSettings: async () => ({}), models: fakeModels(false), findEngine: () => "/x" }),
    (e) => e.code === "SPEECH_MODEL_MISSING" && /Download the voice model/.test(e.message),
  );
  const base = { audio: speechWav(), modelPath: "/m.bin" };
  await assert.rejects(t.transcribeLocally({ ...base, binary: null }), /npm run build:speech/);
  await assert.rejects(
    t.transcribeLocally({ ...base, binary: "/x", spawnImpl: fakeSpawn({ error: new Error("EACCES") }).spawnImpl }),
    /Dictation engine failed: EACCES/,
  );
  await assert.rejects(
    t.transcribeLocally({ ...base, binary: "/x", spawnImpl: fakeSpawn({ code: 3 }).spawnImpl }),
    /error \(3\): falha ao carregar modelo/,
  );
});

test("the local engine is looked up in the installed package and then in the repository's vendor/", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bd-engine-"));
  try {
    const vendor = path.join(root, "repo", "vendor", "speech");
    fs.mkdirSync(vendor, { recursive: true });
    fs.writeFileSync(path.join(vendor, "parakeet-cli"), "", { mode: 0o755 });
    const opts = { resourcesPath: path.join(root, "res"), appRoot: path.join(root, "repo") };
    assert.equal(t.findLocalEngine(opts), path.join(vendor, "parakeet-cli"));
    fs.mkdirSync(path.join(root, "res", "speech"), { recursive: true });
    fs.writeFileSync(path.join(root, "res", "speech", "parakeet-cli"), "", { mode: 0o755 });
    assert.equal(t.findLocalEngine(opts), path.join(root, "res", "speech", "parakeet-cli"));
    fs.chmodSync(path.join(vendor, "parakeet-cli"), 0o644);
    assert.equal(t.findLocalEngine({ resourcesPath: undefined, appRoot: path.join(root, "repo") }), null, "without execute permission it doesn't count");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(t.localThreads(12), 8);
  assert.equal(t.localThreads(4), 2);
  assert.equal(t.localThreads(1), 1);
});

test("the transcription key stays encrypted in the keyring, leaves the public settings and is read only in the backend", () => {
  const storage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: (v) => Buffer.from(`enc:${v}`),
    decryptString: (b) => b.toString().replace(/^enc:/, ""),
  };
  const stored = protectSettings({ transcriptionApiKey: "sk-voz", voiceDictation: { model: "m" } }, {}, storage);
  assert.equal(stored.transcriptionApiKey.encrypted, 1);
  assert.equal(JSON.stringify(stored).includes("sk-voz"), false);
  const pub = publicSettings(stored);
  assert.equal(pub.transcriptionApiKey, undefined);
  assert.equal(pub.configuredSecrets.transcriptionApiKey, true);
  assert.deepEqual(pub.voiceDictation, { model: "m" });
  assert.equal(revealSecret(stored.transcriptionApiKey, storage), "sk-voz");
  assert.equal(revealSecret(undefined, storage), "");
  // Saving only the dictation settings keeps the already registered key.
  const again = protectSettings({ voiceDictation: { model: "n" } }, stored, storage);
  assert.deepEqual(again.transcriptionApiKey, stored.transcriptionApiKey);
});

test("names dictated with another spelling are recognized by sound, without touching Portuguese", () => {
  const fix = (s, opts = {}) => t.applyVocabulary(s, { vocabulary: VOCAB, ...opts });
  // Real Parakeet cases with fast speech.
  assert.equal(fix("o Bigodok está ótimo"), "o BeagleDock está ótimo");
  assert.equal(fix("Bigaloc ou é o próprio iMemory?"), "BeagleDock ou é o próprio ai-memory?");
  assert.equal(fix("Clod Code e o Codecs"), "Claude Code e o Codex");
  assert.equal(fix("subi em type script"), "subi em TypeScript");
  // The session's folder and the terms registered by the person also count.
  const rumofy = { vocabulary: `Rumofy, ${VOCAB}`, context: ["RumofyNext"] };
  assert.equal(fix("projeto do Rumopy Next", rumofy), "projeto do RumofyNext");
  assert.equal(fix("alimentando o Bigodoc e não o Remofi", rumofy), "alimentando o BeagleDock e não o Rumofy");
  // "cloud" alone is a cloud; only the expression becomes the tool's name.
  assert.equal(fix("abre o cloud code"), "abre o Claude Code");
  assert.equal(fix("guarda na cloud da AWS"), "guarda na cloud da AWS");
  // Portuguese and similar words stay as they are.
  for (const s of [
    "a memória do projeto",
    "o bigode dele",
    "um bloco de código",
    "vamos sentir o código",
    "eles postam no blog",
    "Codex pelo terminal",
    "GitHub e GitLab",
    "o codigo",
  ])
    assert.equal(fix(s), s);
});

test("English dictation: similar short words and words next to a right name stay as they are", () => {
  const fix = (s) => t.applyVocabulary(s, { vocabulary: VOCAB, context: ["BeagleDock"] });
  assert.equal(fix("it checks the tests"), "it checks the tests", "“checks” isn't “Codex”");
  assert.equal(fix("where BeagleDock is developed"), "where BeagleDock is developed");
  assert.equal(fix("Codex's limits and Codex shows them"), "Codex's limits and Codex shows them");
  assert.equal(fix("outside BeagleDock it defers"), "outside BeagleDock it defers");
  // The real fixes still happen.
  assert.equal(fix("open the Bigodok and the codecs"), "open the BeagleDock and the Codex");
});

test("the vocabulary doesn't touch paths, files or variables", () => {
  for (const s of [
    "package.json",
    "~/.beagledock",
    "CLAUDE_CONFIG_DIR",
    "dev:vite",
    "`beagledock --quit`",
    "beagledock-probes",
    // Regression PR #73: the README badge had `logo=linux` swapped for `logo=Linux`.
    "https://img.shields.io/badge/Linux-x64?logo=linux&logoColor=white",
    "www.github.com/rumofy/beagledock",
  ])
    assert.equal(t.applyVocabulary(s, { vocabulary: VOCAB }), s, s);
  assert.equal(
    t.applyVocabulary("abre https://github.com/rumofy/beagledock no claude code", { vocabulary: VOCAB }),
    "abre https://github.com/rumofy/beagledock no Claude Code",
  );
  assert.equal(t.applyVocabulary("abre o beagledock.", { vocabulary: VOCAB }), "abre o BeagleDock.");
  assert.equal(t.applyVocabulary("usa json e o codex: ok", { vocabulary: VOCAB }), "usa JSON e o Codex: ok");
});

test("the documentation isn't wrongly corrected", () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.join(__dirname, "..");
  // Only released versions: the new text quotes swap examples on purpose ("Bigodok").
  const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const released = changelog.slice(changelog.indexOf("## [0.9.0]")).replace(/cloud code/gi, "");
  const text = [released, ...["README.md", "AGENTS.md"].map((f) => fs.readFileSync(path.join(root, f), "utf8"))].join("\n");
  const lines = text.split("\n").filter((l) => l.trim());
  const changed = lines.filter((l) => t.applyVocabulary(l, { vocabulary: VOCAB, context: ["BeagleDock"] }) !== l);
  assert.deepEqual(changed, []);
});
