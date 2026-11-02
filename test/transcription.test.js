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

test("WAV gerado no renderer tem cabeçalho PCM 16 bits mono e é aceito pelo backend", () => {
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

test("silêncio não é enviado; voz baixa é normalizada sem amplificar ruído puro", () => {
  assert.equal(wav.hasSpeech(new Float32Array(16000)), false);
  const quiet = new Float32Array(1000).map((_, i) => 0.2 * Math.sin(i));
  assert.equal(wav.hasSpeech(quiet), true);
  const loud = wav.normalizePeak(quiet);
  assert.ok(Math.max(...loud) > 0.85 && Math.max(...loud) <= 0.9001);
  // Ganho limitado a 8x: ruído baixíssimo não vira grito.
  assert.ok(Math.max(...wav.normalizePeak(new Float32Array(100).fill(0.01))) <= 0.0801);
  const silence = new Float32Array(10);
  assert.equal(wav.normalizePeak(silence), silence);
});

test("texto ditado entra no cursor com espaços só onde faltam", () => {
  assert.deepEqual({ ...wav.insertDictation("", 0, " Olá mundo ") }, { text: "Olá mundo", caret: 9 });
  assert.deepEqual({ ...wav.insertDictation("corrige", 7, "o bug") }, { text: "corrige o bug", caret: 13 });
  assert.deepEqual({ ...wav.insertDictation("antes depois", 5, "meio") }, { text: "antes meio depois", caret: 10 });
  assert.deepEqual({ ...wav.insertDictation("abc", 99, "") }, { text: "abc", caret: 99 });
});

test("appendDictation continua no fim do texto e deixa o cursor no fim", () => {
  const first = wav.appendDictation("", "Primeira observação.");
  const second = wav.appendDictation(first.text, "Segunda observação.");
  assert.deepEqual({ ...second }, { text: "Primeira observação. Segunda observação.", caret: 40 });
  assert.deepEqual({ ...wav.appendDictation("linha ", " mais") }, { text: "linha mais", caret: 10 });
  assert.deepEqual({ ...wav.appendDictation("abc", "  ") }, { text: "abc", caret: 3 });
});

test("decodeWav recusa vazio, formato errado, curto demais e acima de 25 MB", () => {
  assert.throws(() => t.decodeWav(""), /vazio/);
  assert.throws(() => t.decodeWav(Buffer.from("OggS".padEnd(5000, "x")).toString("base64")), /inválido/);
  assert.throws(() => t.decodeWav(Buffer.from(wav.encodeWav(new Float32Array(10), 16000)).toString("base64")), /curta/);
  assert.throws(() => t.decodeWav("A".repeat(36 * 1024 * 1024)), /25 MB/);
});

test("configuração padrão é o ditado local; a API só quando escolhida", () => {
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

test("vocabulário corrige a transcrição: trocas 'errado => certo' e grafia de nomes", () => {
  const vocabulary = "cloud code => Claude Code\nsupabase, Rumofy; =>, a => ";
  assert.deepEqual(t.parseVocabulary(vocabulary), {
    terms: ["supabase", "Rumofy"],
    replacements: [{ from: "cloud code", to: "Claude Code" }],
  });
  const fixed = t.applyVocabulary("Abre o cloud  code e o codex cli no rumofynext, rumofy e typescript. Faça os testes.", {
    vocabulary,
    context: ["RumofyNext", "Testes"],
  });
  assert.equal(fixed, "Abre o Claude Code e o Codex CLI no RumofyNext, Rumofy e TypeScript. Faça os testes.");
  // Só palavras inteiras: "reactivo" não vira "Reactivo"; acentos contam como letra.
  assert.equal(t.applyVocabulary("reactivo react ação", {}), "reactivo React ação");
});

test("prompt leva o vocabulário do usuário e da sessão primeiro, sem repetir e com limite", () => {
  const prompt = t.buildPrompt({ language: "pt", vocabulary: "Rumofy, supabase\nRumofy", context: ["RumofyNext", "claude code"] });
  assert.match(prompt, /português do Brasil/);
  assert.match(prompt, /Vocabulário: Rumofy, supabase, RumofyNext, claude code, Codex CLI/);
  assert.equal((prompt.match(/Rumofy,/g) || []).length, 1);
  assert.doesNotMatch(prompt, /Claude Code/); // já veio do contexto em outra grafia
  const huge = t.buildPrompt({ language: "pt", vocabulary: Array.from({ length: 500 }, (_, i) => `termo${i}`).join(",") });
  assert.ok(huge.length <= 1501);
  assert.match(t.buildPrompt({ language: "en" }), /^Dictation/);
});

test("API: envia multipart com modelo, idioma, prompt e chave; devolve o texto limpo", async () => {
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

test("API: idioma automático não manda language; erro do servidor sai sem vazar a chave", async () => {
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

test("API: exige chave e https, mas aceita servidor local sem chave", async () => {
  const deps = (voiceDictation, key = "") => ({
    getSettings: async () => ({ voiceDictation: { engine: "api", ...voiceDictation } }),
    getSecret: async () => key,
    fetchImpl: async () => new Response('{"text":"local"}'),
  });
  await assert.rejects(t.transcribeAudio({ audio: audio64() }, deps({})), /Cadastre a chave/);
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

test("local: roda o parakeet-cli com modelo e threads, corrige o vocabulário e apaga o temporário", async () => {
  const { spawnImpl, calls } = fakeSpawn({ stdout: " Olá, beagledock.\n Tudo certo.\n" });
  const result = await t.transcribeAudio(
    { audio: audio64() },
    {
      getSettings: async () => ({}),
      getSecret: async () => assert.fail("modo local não lê chave"),
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

test("local: modelo ausente vira código próprio; motor ausente ou com erro viram mensagens claras", async () => {
  await assert.rejects(
    t.transcribeAudio({ audio: audio64() }, { getSettings: async () => ({}), models: fakeModels(false), findEngine: () => "/x" }),
    (e) => e.code === "SPEECH_MODEL_MISSING" && /Baixe o modelo de voz/.test(e.message),
  );
  const base = { audio: speechWav(), modelPath: "/m.bin" };
  await assert.rejects(t.transcribeLocally({ ...base, binary: null }), /npm run build:speech/);
  await assert.rejects(
    t.transcribeLocally({ ...base, binary: "/x", spawnImpl: fakeSpawn({ error: new Error("EACCES") }).spawnImpl }),
    /Falha no motor de ditado: EACCES/,
  );
  await assert.rejects(
    t.transcribeLocally({ ...base, binary: "/x", spawnImpl: fakeSpawn({ code: 3 }).spawnImpl }),
    /erro \(3\): falha ao carregar modelo/,
  );
});

test("motor local é procurado no pacote instalado e depois em vendor/ do repositório", () => {
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
    assert.equal(t.findLocalEngine({ resourcesPath: undefined, appRoot: path.join(root, "repo") }), null, "sem permissão de execução não conta");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(t.localThreads(12), 8);
  assert.equal(t.localThreads(4), 2);
  assert.equal(t.localThreads(1), 1);
});

test("chave de transcrição fica cifrada no cofre, some das configurações públicas e é lida só no backend", () => {
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
  // Salvar só o ditado mantém a chave já cadastrada.
  const again = protectSettings({ voiceDictation: { model: "n" } }, stored, storage);
  assert.deepEqual(again.transcriptionApiKey, stored.transcriptionApiKey);
});

test("nomes ditados com outra grafia são reconhecidos pelo som, sem mexer no português", () => {
  const fix = (s, opts = {}) => t.applyVocabulary(s, opts);
  // Casos reais do Parakeet com fala rápida.
  assert.equal(fix("o Bigodok está ótimo"), "o BeagleDock está ótimo");
  assert.equal(fix("Bigaloc ou é o próprio iMemory?"), "BeagleDock ou é o próprio ai-memory?");
  assert.equal(fix("Clod Code e o Codecs"), "Claude Code e o Codex");
  assert.equal(fix("o anti gravity travou"), "o Antigravity travou");
  assert.equal(fix("subi no git hub em type script"), "subi no GitHub em TypeScript");
  // Pasta da sessão e termos cadastrados pela pessoa também entram.
  const rumofy = { vocabulary: "Rumofy", context: ["RumofyNext"] };
  assert.equal(fix("projeto do Rumopy Next", rumofy), "projeto do RumofyNext");
  assert.equal(fix("alimentando o Bigodoc e não o Remofi", rumofy), "alimentando o BeagleDock e não o Rumofy");
  // "cloud" sozinho é nuvem; só a expressão vira o nome da ferramenta.
  assert.equal(fix("abre o cloud code"), "abre o Claude Code");
  assert.equal(fix("guarda na cloud da AWS"), "guarda na cloud da AWS");
  // Português e palavras parecidas ficam como estão.
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

test("vocabulário não mexe dentro de caminho, arquivo ou variável", () => {
  for (const s of [
    "package.json",
    "~/.beagledock",
    "CLAUDE_CONFIG_DIR",
    "dev:vite",
    "`beagledock --quit`",
    "beagledock-probes",
    // Regressão PR #73: o badge do README tinha `logo=linux` trocado por `logo=Linux`.
    "https://img.shields.io/badge/Linux-x64?logo=linux&logoColor=white",
    "www.github.com/rumofy/beagledock",
  ])
    assert.equal(t.applyVocabulary(s, {}), s, s);
  assert.equal(
    t.applyVocabulary("abre https://github.com/rumofy/beagledock no claude code", {}),
    "abre https://github.com/rumofy/beagledock no Claude Code",
  );
  assert.equal(t.applyVocabulary("abre o beagledock.", {}), "abre o BeagleDock.");
  assert.equal(t.applyVocabulary("usa json e o codex: ok", {}), "usa JSON e o Codex: ok");
});

test("documentação em português não sofre correções indevidas", () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.join(__dirname, "..");
  // Só as versões já lançadas: o texto novo cita de propósito exemplos de troca ("Bigodok").
  const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const released = changelog.slice(changelog.indexOf("## [0.9.0]")).replace(/cloud code/gi, "");
  const text = [released, ...["README.md", "AGENTS.md"].map((f) => fs.readFileSync(path.join(root, f), "utf8"))].join("\n");
  const lines = text.split("\n").filter((l) => l.trim());
  const changed = lines.filter((l) => t.applyVocabulary(l, { context: ["BeagleDock"] }) !== l);
  assert.deepEqual(changed, []);
});

test("ditado: variações faladas de Claude Code e a sigla AGY viram os nomes certos", () => {
  const fix = (text) => t.applyVocabulary(text, {});
  assert.equal(
    fix("Ver se isso não é só problema do cloud coding. Acho que o ag também pode ter e o Codex também."),
    "Ver se isso não é só problema do Claude Code. Acho que o AGY também pode ter e o Codex também.",
  );
  assert.equal(fix("Olha como escreveu o Claudio Coding aí."), "Olha como escreveu o Claude Code aí.");
  assert.equal(fix("o Cláudio Code e o claude coding"), "o Claude Code e o Claude Code");
  assert.equal(fix("roda no agy"), "roda no AGY");
  // Sem "code/coding" ao lado, Cláudio é nome de gente e "cloud" é nuvem; palavras com "ag" ficam.
  assert.equal(fix("O Cláudio subiu na cloud a agenda e a tag."), "O Cláudio subiu na cloud a agenda e a tag.");
});
