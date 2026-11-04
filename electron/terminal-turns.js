// Terminal mode: finds out, from the CLI's own screen, when a reply ends (or the CLI stops
// waiting for you, on an approval). BeagleDock doesn't talk to the CLI in this mode; it only sees the
// terminal's bytes. Signals verified with the real CLIs (Claude Code 2.1.317, Codex CLI 0.166.0,
// AGY 1.4.12):
// - Claude Code: the window title (OSC 0) shows a spinner (◐ ◓ ◑ ◒) while it works and goes back to
//   "✳" when it finishes or stops on a permission request. It also replies on its own (background
//   agent), so the spinner is enough to start counting.
// - Codex CLI: reports its state in OSC 7501 (`state=working` / `state=idle`). On startup it also
//   goes through `working`, so it only counts after you send something (Enter), and only an Enter given
//   with it already ready (after the first `idle`): an Enter on a startup screen (folder
//   trust, hooks review) is followed by initialization, not by a reply.
// - AGY: sends no signal at all; while it works the screen animates nonstop, and when done it goes
//   silent. Silence after a period of activity counts as the end, also only after Enter.

const CLAUDE_BUSY = /^[◐◓◑◒⠀-⣿]/u;
const CLAUDE_IDLE = /^✳/u;
// Titles and states may arrive split between two output chunks: keep the end of the previous one.
const CARRY = 256;

function lastMatch(text, pattern) {
  let found = null;
  for (const m of text.matchAll(pattern)) found = m;
  return found;
}

function createTurnWatcher({
  providerId,
  onTurnEnd,
  now = Date.now,
  setTimer = (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimer = clearTimeout,
  // AGY: silence that ends the reply and the minimum activity to count as a reply (a slash
  // command or an empty Enter redraw little and shouldn't become a notification).
  quietMs = 3000,
  minActiveMs = 2500,
  // Work that's too short (e.g. the redraw of an empty Enter) isn't a reply.
  minBusyMs = 800,
}) {
  let armed = false;
  // Codex: already reported `idle` once (finished starting up).
  let ready = false;
  let busySince = null;
  let firstOutput = null;
  let quietTimer = null;
  let tail = "";

  function end() {
    const startedAt = busySince ?? firstOutput;
    armed = false;
    busySince = null;
    firstOutput = null;
    if (quietTimer) clearTimer(quietTimer);
    quietTimer = null;
    onTurnEnd?.({ providerId, startedAt, endedAt: now() });
  }

  function busy() {
    if (busySince === null) busySince = now();
  }
  function idle() {
    if (busySince === null) return;
    if (now() - busySince < minBusyMs) {
      busySince = null;
      return;
    }
    end();
  }

  return {
    // What the person typed in the terminal: Enter arms the wait for the end of the reply.
    input(data) {
      if (typeof data !== "string" || !data.includes("\r")) return;
      if (providerId === "codex" && !ready) return;
      armed = true;
      firstOutput = null;
      if (providerId !== "claude") busySince = null;
    },
    output(data) {
      if (typeof data !== "string" || !data) return;
      const text = tail + data;
      tail = text.slice(-CARRY);
      if (providerId === "claude") {
        const title = lastMatch(text, /\x1b\]0;([^\x07\x1b]*)(?:\x07|\x1b\\)/g);
        if (!title) return;
        // Avoid counting the same title left in the kept chunk twice.
        tail = text.slice(title.index + title[0].length).slice(-CARRY);
        if (CLAUDE_BUSY.test(title[1])) busy();
        else if (CLAUDE_IDLE.test(title[1])) idle();
        return;
      }
      if (providerId === "codex") {
        const state = lastMatch(text, /\x1b\]7501;([^\x07\x1b]*)(?:\x07|\x1b\\)/g);
        if (!state) return;
        tail = text.slice(state.index + state[0].length).slice(-CARRY);
        if (/(^|:)state=idle\b/.test(state[1])) ready = true;
        if (!armed) return;
        if (/(^|:)state=working\b/.test(state[1])) busy();
        else if (/(^|:)state=idle\b/.test(state[1])) idle();
        return;
      }
      // AGY: only the screen's activity.
      if (!armed) return;
      if (firstOutput === null) firstOutput = now();
      if (quietTimer) clearTimer(quietTimer);
      quietTimer = setTimer(() => {
        quietTimer = null;
        if (armed && firstOutput !== null && now() - quietMs - firstOutput >= minActiveMs) end();
        else {
          // Short activity (Enter echo, a slash command): it wasn't a reply.
          armed = false;
          firstOutput = null;
        }
      }, quietMs);
    },
    dispose() {
      if (quietTimer) clearTimer(quietTimer);
      quietTimer = null;
      armed = false;
    },
  };
}

module.exports = { createTurnWatcher };
