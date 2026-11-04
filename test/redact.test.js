const { test } = require("node:test");
const assert = require("node:assert/strict");
const { redact, MASK } = require("../electron/redact");
const { createEventTracker } = require("../electron/stream-events");
const { oneLine, claudeToolActivity, codexItemActivity } = require("../electron/activity-labels");

test("masks sensitive headers, keys and variables in commands", () => {
  const cases = [
    ['curl -H "Authorization: Bearer abc123def456ghi789" https://api.x.com', "abc123def456ghi789"],
    ["export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    ['{"api_key": "sk-proj-abcdefghijklmnopqrstuvwx"}', "sk-proj-abcdefghijklmnopqrstuvwx"],
    ["mysql -u root --password=hunter2secret db", "hunter2secret"],
    ["git clone https://user:s3cretpass@github.com/acme/api.git", "s3cretpass"],
    ["AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY aws s3 ls", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop", "eyJhbGciOiJIUzI1NiJ9"],
    ["AKIAIOSFODNN7EXAMPLE", "AKIAIOSFODNN7EXAMPLE"],
  ];
  for (const [input, secret] of cases) {
    const out = redact(input);
    assert.ok(!out.includes(secret), `leaked in: ${input} -> ${out}`);
    assert.ok(out.includes(MASK));
  }
});

test("doesn't change ordinary text or commands without a secret", () => {
  for (const text of ["npm test -- --watch=false", "git commit -m 'corrige token de paginação'", "ls -la src/hooks", "Analisando os testes e o arquivo package.json", "", undefined]) {
    assert.equal(redact(text), text);
  }
});

test("the timeline (live and saved) never carries the secret", () => {
  const sent = [];
  const tracker = createEventTracker({ emit: (_c, d) => sent.push(d.event), sessionId: "s" });
  tracker.start("r");
  tracker.upsert("c", { kind: "command", title: "Bash", detail: "curl -H 'Authorization: Bearer topsecrettoken123456' x" });
  tracker.upsert("t", { kind: "reasoning", title: "R" });
  tracker.appendText("t", "A senha é password=hunter2hunter2 e eu a usei");
  tracker.finishRunning();
  const everything = JSON.stringify([...sent, ...tracker.snapshot()]);
  assert.ok(!everything.includes("topsecrettoken123456"));
  assert.ok(!everything.includes("hunter2hunter2"));
});

test("activity labels of the three providers mask commands and arguments", () => {
  assert.ok(!oneLine("TOKEN=abcdefghijklmnop123 run").includes("abcdefghijklmnop123"));
  assert.ok(!claudeToolActivity({ name: "Bash", input: { command: "export API_KEY=zzzzzzzzzzzz9999" } }).detail.includes("zzzzzzzzzzzz9999"));
  assert.ok(!codexItemActivity({ type: "mcpToolCall", server: "s", tool: "t", arguments: { api_key: "kkkkkkkkkkkk8888" } }).detail.includes("kkkkkkkkkkkk8888"));
});

test("formats that slipped through: a flag with a separate value, the scheme in Authorization and a PEM key", () => {
  const cases = [
    ["mysql --password hunter2secret -u root", "hunter2secret"],
    ["curl -H 'Authorization: token ghx_abcdefghij123456' x", "ghx_abcdefghij123456"],
    ["Authorization: Basic dXNlcjpwYXNzd29yZA==", "dXNlcjpwYXNzd29yZA=="],
    ["-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7abc\n-----END RSA PRIVATE KEY-----", "MIIEpAIBAAKCAQEA7abc"],
    ["-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAA (bloco ainda chegando", "MIIEvQIBADANBgkqhkiG9w0BAQEFAA"],
  ];
  for (const [input, secret] of cases) assert.ok(!redact(input).includes(secret), `vazou: ${input} -> ${redact(input)}`);
  assert.equal(redact("use --force e --verbose sem segredo"), "use --force e --verbose sem segredo");
});

test("a secret split between two reasoning chunks doesn't leak the rest", () => {
  const sent = [];
  const tracker = createEventTracker({ emit: (_c, d) => sent.push(d.event), sessionId: "s", now: (() => { let t = 0; return () => (t += 500); })() });
  tracker.start("r");
  tracker.upsert("t", { kind: "reasoning", title: "R" });
  tracker.appendText("t", "A chave é sk-proj-abcdefghijklmnop");
  tracker.appendText("t", "qrstuvwxyz123456 e eu a usei");
  tracker.finishRunning();
  const everything = JSON.stringify([...sent, ...tracker.snapshot()]);
  assert.ok(!everything.includes("qrstuvwxyz123456"), "the rest of the key leaked");
  assert.ok(!everything.includes("abcdefghijklmnop"));
  assert.ok(tracker.get("t").text.includes("eu a usei"), "o texto comum continua");
});

test("Claude Code's proposed plan becomes a full-text plan step shown in the conversation", () => {
  const plan = "# Plan\n\n1. Create the table\n2. Write the tests";
  const label = claudeToolActivity({ name: "ExitPlanMode", input: { plan } });
  assert.equal(label.kind, "plan");
  assert.equal(label.text, plan);
  assert.equal(label.proposal, true);
  // Without a plan text it stays an ordinary tool step.
  assert.equal(claudeToolActivity({ name: "ExitPlanMode", input: {} }).kind, "tool");
});
