const test = require("node:test");
const assert = require("node:assert/strict");
const { createTurnWatcher } = require("../electron/terminal-turns");

// Manual clock and timers: AGY's silence is measured without really waiting.
function clock() {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => {
      const timer = { at: t + ms, fn, done: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => timer && (timer.done = true),
    advance(ms) {
      t += ms;
      for (const timer of timers)
        if (!timer.done && timer.at <= t) {
          timer.done = true;
          timer.fn();
        }
    },
  };
}
const title = (text) => `\x1b]0;${text}\x07`;

test("Claude Code: the spinner in the title marks work and ✳ marks the end (or waiting for you)", () => {
  const c = clock();
  const ends = [];
  const w = createTurnWatcher({ providerId: "claude", onTurnEnd: (e) => ends.push(e), ...c });
  w.output(title("✳ Claude Code"));
  assert.equal(ends.length, 0, "the startup isn't a reply");
  w.input("rode os testes\r");
  w.output(title("◐ Claude Code"));
  c.advance(5000);
  w.output("\x1b[2Kspinner" + title("◑ Shell npm test"));
  c.advance(1000);
  w.output(title("✳ Shell npm test"));
  assert.equal(ends.length, 1);
  assert.equal(ends[0].startedAt, 0);
  w.output(title("✳ Shell npm test"));
  assert.equal(ends.length, 1, "the same title again doesn't notify twice");
  // Spontaneous reply (a background agent finished): without Enter it also counts.
  w.output(title("◒ Claude Code"));
  c.advance(2000);
  w.output(title("✳ Claude Code"));
  assert.equal(ends.length, 2);
});

test("Claude Code: title split between two output chunks and work that's too short", () => {
  const c = clock();
  const ends = [];
  const w = createTurnWatcher({ providerId: "claude", onTurnEnd: (e) => ends.push(e), ...c });
  w.output(title("◐ x"));
  c.advance(3000);
  const done = title("✳ x");
  w.output(done.slice(0, 5));
  w.output(done.slice(5));
  assert.equal(ends.length, 1);
  w.output(title("◐ x"));
  c.advance(100);
  w.output(title("✳ x"));
  assert.equal(ends.length, 1, "a quick redraw isn't a reply");
});

test("Codex CLI: the OSC 7501 state only counts after you send something", () => {
  const c = clock();
  const ends = [];
  const w = createTurnWatcher({ providerId: "codex", onTurnEnd: (e) => ends.push(e), ...c });
  // Real startup: goes through working (MCP servers) and back to idle on its own.
  w.output("\x1b]7501;state=idle:app=codex\x07");
  w.output("\x1b]7501;state=working:app=codex\x07");
  c.advance(3000);
  w.output("\x1b]7501;state=idle:app=codex\x07");
  assert.equal(ends.length, 0);
  w.input("oi\r");
  w.output("\x1b]7501;state=working:app=codex\x1b\\");
  c.advance(4000);
  w.output("\x1b]7501;state=idle:app=codex\x1b\\");
  assert.equal(ends.length, 1);
});

test("Codex: Enter on a startup screen (trust, hooks review) doesn't become the end of a reply", () => {
  const c = clock();
  const ends = [];
  const w = createTurnWatcher({ providerId: "codex", onTurnEnd: (e) => ends.push(e), ...c });
  // Codex CLI 0.166.0 with changed hooks: no state until the person gets past the review screen.
  w.input("\r");
  w.output("\x1b]7501;state=idle:app=codex\x07");
  w.output("\x1b]7501;state=working:app=codex\x07");
  c.advance(2500);
  w.output("\x1b]7501;state=idle:app=codex\x07");
  assert.equal(ends.length, 0, "the initialization after the screen isn't a reply");
  w.input("oi\r");
  w.output("\x1b]7501;state=working:app=codex\x07");
  c.advance(3000);
  w.output("\x1b]7501;state=idle:app=codex\x07");
  assert.equal(ends.length, 1);
});

test("AGY: silence after a reply ends it; short activity (echo, slash command) doesn't", () => {
  const c = clock();
  const ends = [];
  const w = createTurnWatcher({ providerId: "antigravity", onTurnEnd: (e) => ends.push(e), ...c });
  w.output("tela inicial");
  c.advance(10000);
  assert.equal(ends.length, 0, "without Enter, nothing counts");
  w.input("/help\r");
  w.output("ajuda");
  c.advance(3500);
  assert.equal(ends.length, 0, "short activity isn't a reply");
  w.input("rode os testes\r");
  for (let i = 0; i < 20; i++) {
    w.output("⠋ trabalhando");
    c.advance(500);
  }
  assert.equal(ends.length, 0, "while the screen animates, it's still working");
  c.advance(3000);
  assert.equal(ends.length, 1);
  c.advance(10000);
  assert.equal(ends.length, 1);
  w.dispose();
});

for (const providerId of ["claude", "codex", "antigravity"]) {
  test(`${providerId}: publishes live activity, idle and generic interaction states`, () => {
    const c = clock();
    const states = [];
    const w = createTurnWatcher({ providerId, onStateChange: ({ status }) => states.push(status), ...c });
    assert.equal(w.getState().status, "idle");
    if (providerId === "codex") w.output("\x1b]7501;state=idle:app=codex\x07");
    w.input("request\r");
    const working = providerId === "claude" ? title("◐ Working") : providerId === "codex" ? "\x1b]7501;state=working:app=codex\x07" : "working";
    w.output(working);
    assert.equal(w.getState().status, "running", "visible before the reply finishes");
    c.advance(3000);
    w.output(working);
    c.advance(3000);
    if (providerId === "claude") w.output(title("✳ Ready"));
    if (providerId === "codex") w.output("\x1b]7501;state=idle:app=codex\x07");
    assert.equal(w.getState().status, "idle");
    w.waitingForInput();
    const revision = w.getState().revision;
    assert.equal(w.getState().status, "waiting_input");
    w.input("continue\r");
    w.output(working);
    assert.equal(w.getState().status, "running");
    assert.ok(w.getState().revision > revision, "new work invalidates delayed waiting detection");
    assert.deepEqual(states, ["running", "idle", "waiting_input", "running"]);
    w.dispose();
  });
}
