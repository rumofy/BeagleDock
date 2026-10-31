const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseClaudeUsage,
  parseCodexRateLimits,
  parseResetLabel,
  createProviderUsage,
} = require("../electron/provider-usage");

// Saídas capturadas das CLIs reais: claude 2.1.316 (`-p /usage --output-format json`)
// e codex-cli 0.166.0 (app-server, account/rateLimits/read).
const now = Date.parse("2026-10-31T12:00:00Z");
const claudeReport = (result, extra = {}) =>
  JSON.stringify({ is_error: false, subtype: "success", result, ...extra });
const claudeText = `You are currently using your subscription to power your Claude Code usage

Current session: 1% used · resets Oct 31, 3:20pm (America/Sao_Paulo)
Current week (all models): 13% used · resets Nov 7, 2am (America/Sao_Paulo)

What's contributing to your usage?`;
const codexResult = {
  ordinaryUsageAllowed: true,
  rateLimits: {
    limitId: "codex",
    primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1793471074 },
    secondary: {
      usedPercent: 92,
      windowDurationMins: 10080,
      resetsAt: 1793784788,
    },
    planType: "plus",
  },
};

test("reset do Claude é convertido para o instante real no fuso informado", () => {
  assert.equal(
    parseResetLabel("Oct 31, 3:20pm (America/Sao_Paulo)", now),
    "2026-10-31T18:20:00.000Z",
  );
  assert.equal(
    parseResetLabel("Nov 7, 2am (America/Sao_Paulo)", now),
    "2026-11-07T05:00:00.000Z",
  );
  assert.equal(
    parseResetLabel("3:20pm (America/Sao_Paulo)", now),
    "2026-10-31T18:20:00.000Z",
  );
  assert.equal(parseResetLabel("amanhã", now), null);
  assert.equal(parseResetLabel(undefined, now), null);
});

test("/usage do Claude Code vira cota de 5h e semanal", () => {
  const usage = parseClaudeUsage(claudeReport(claudeText), now);
  assert.equal(usage.window5hPercent, 1);
  assert.equal(usage.weeklyPercent, 13);
  assert.equal(usage.window5hResetAt, "2026-10-31T18:20:00.000Z");
  assert.equal(usage.weeklyResetAt, "2026-11-07T05:00:00.000Z");
});

test("janela do Claude que já reiniciou não exibe percentual antigo", () => {
  const usage = parseClaudeUsage(claudeReport(claudeText), now + 7 * 3600000);
  assert.equal(usage.window5hPercent, null);
  assert.equal(usage.weeklyPercent, 13);
});

test("relatório do Claude inválido ou sem cotas falha explicitamente", () => {
  assert.throws(() => parseClaudeUsage("não é json", now), /inválido/);
  assert.throws(
    () => parseClaudeUsage(claudeReport("", { is_error: true }), now),
    /válido/,
  );
  assert.throws(
    () => parseClaudeUsage(claudeReport("Using API key billing"), now),
    /não informou cotas/,
  );
});

test("limites do Codex mapeiam janelas por duração e trazem o reset", () => {
  const usage = parseCodexRateLimits(codexResult, now);
  assert.equal(usage.window5hPercent, 0);
  assert.equal(usage.weeklyPercent, 92);
  assert.equal(usage.window5hResetAt, "2026-10-31T18:24:34.000Z");
  assert.equal(usage.planType, "plus");
});

test("Codex só com janela semanal não vira cota de 5h", () => {
  const usage = parseCodexRateLimits(
    {
      rateLimits: {
        primary: {
          usedPercent: 40,
          windowDurationMins: 10080,
          resetsAt: 1793784788,
        },
      },
    },
    now,
  );
  assert.equal(usage.window5hPercent, null);
  assert.equal(usage.weeklyPercent, 40);
  assert.throws(() => parseCodexRateLimits({}, now), /não retornou/);
});

test("leitura mantém o último valor como desatualizado quando a CLI falha", async () => {
  let clock = now;
  let fail = false;
  const usage = createProviderUsage({
    find: (name) => `/bin/${name}`,
    now: () => clock,
    refreshMs: 1000,
    exec: async () => {
      if (fail) throw new Error("falha");
      return { stdout: claudeReport(claudeText) };
    },
    spawn: () => {
      throw new Error("codex indisponível");
    },
  });
  let result = await usage.get();
  assert.equal(result.claude.window5hPercent, 1);
  assert.equal(result.claude.stale, false);
  assert.match(result.codex.quotaError, /codex indisponível/);
  fail = true;
  clock += 5000;
  result = await usage.get();
  assert.equal(result.claude.window5hPercent, 1);
  assert.equal(result.claude.stale, true);
  assert.match(result.claude.quotaError, /\/usage/);
});

test("CLI lenta não atrasa a leitura: devolve o valor conhecido e avisa quando terminar", async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const updates = [];
  const usage = createProviderUsage({
    find: (name) => `/bin/${name}`,
    now: () => now,
    waitMs: 20,
    exec: async () => {
      await gate;
      return { stdout: claudeReport(claudeText) };
    },
    spawn: () => {
      throw new Error("codex indisponível");
    },
    onUpdate: (id) => updates.push(id),
  });
  const started = Date.now();
  const first = await usage.get();
  assert.ok(Date.now() - started < 1000, "não esperou a CLI lenta");
  assert.equal(first.claude.window5hPercent, null);
  release();
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(updates, ["claude"]);
  const second = await usage.get();
  assert.equal(second.claude.window5hPercent, 1);
});

const { queryCodexRateLimits } = require("../electron/provider-usage");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");

test("a leitura do Claude não grava transcript nem dispara hooks do usuário", async () => {
  let args;
  const usage = createProviderUsage({
    find: (name) => `/bin/${name}`,
    now: () => now,
    waitMs: 1000,
    exec: async (_bin, a) => ((args = a), { stdout: claudeReport(claudeText) }),
    spawn: () => {
      throw new Error("sem codex");
    },
  });
  await usage.get();
  assert.ok(args.includes("--no-session-persistence"));
  assert.deepEqual(args.slice(args.indexOf("--setting-sources")), ["--setting-sources", "local"]);
  assert.ok(!args.includes("--bare"), "--bare perderia a autenticação da assinatura");
});

test("virada de ano: escolhe o ano mais próximo nos dois sentidos", () => {
  const jan1 = Date.parse("2027-01-01T03:00:00Z");
  assert.equal(parseResetLabel("Dec 31, 11pm (America/Sao_Paulo)", jan1), "2027-01-01T02:00:00.000Z");
  const dec31 = Date.parse("2026-12-31T12:00:00Z");
  assert.equal(parseResetLabel("Jan 2, 2am (America/Sao_Paulo)", dec31), "2027-01-02T05:00:00.000Z");
});

test("formatos extras de reset: 'at' e relativo", () => {
  assert.equal(parseResetLabel("Nov 7 at 2am (America/Sao_Paulo)", now), "2026-11-07T05:00:00.000Z");
  assert.equal(parseResetLabel("in 2h", now), new Date(now + 2 * 3600000).toISOString());
  assert.equal(parseResetLabel("in 1h 30m", now), new Date(now + 90 * 60000).toISOString());
  assert.equal(parseResetLabel("in 3 days", now), new Date(now + 3 * 86400000).toISOString());
});

function fakeCodex({ failOnWrite = false, exitImmediately = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => (child.killed = true);
  child.stdin = new Writable({
    write(chunk, enc, done) {
      if (failOnWrite) return done(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
      done();
    },
  });
  if (exitImmediately) setImmediate(() => child.emit("close", 1));
  return child;
}

test("codex que fecha o stdin ou sai na hora vira erro tratado, não exceção do app", async () => {
  await assert.rejects(
    queryCodexRateLimits({ bin: "codex", spawn: () => fakeCodex({ failOnWrite: true }), timeoutMs: 500 }),
    /EPIPE/,
  );
  await assert.rejects(
    queryCodexRateLimits({ bin: "codex", spawn: () => fakeCodex({ exitImmediately: true }), timeoutMs: 500 }),
    /encerrou antes/,
  );
});

test("com a janela em segundo plano a leitura espera o intervalo maior", async () => {
  let clock = now;
  let calls = 0;
  let background = false;
  const usage = createProviderUsage({
    find: (name) => `/bin/${name}`,
    now: () => clock,
    waitMs: 1000,
    getRefreshMs: () => (background ? 600000 : 45000),
    exec: async () => (calls++, { stdout: claudeReport(claudeText) }),
    spawn: () => {
      throw new Error("sem codex");
    },
  });
  await usage.get();
  clock += 60000;
  await usage.get();
  assert.equal(calls, 2, "em primeiro plano relê após 45 s");
  background = true;
  clock += 60000;
  await usage.get();
  assert.equal(calls, 2, "em segundo plano não relê em 1 min");
  clock += 600000;
  await usage.get();
  assert.equal(calls, 3);
});
