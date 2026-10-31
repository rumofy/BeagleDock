const fs = require("fs"),
  path = require("path"),
  os = require("os");
const { StringDecoder } = require("string_decoder");
function liveDirectories(
  provider,
  nativeId,
  cwd,
  {
    home = os.homedir(),
    env = process.env,
    temp = os.tmpdir(),
    uid = process.getuid?.(),
  } = {},
) {
  if (!/^[a-zA-Z0-9_-]{8,160}$/.test(nativeId || "")) return [];
  if (provider === "antigravity")
    return [
      {
        base: path.join(
          env.GEMINI_CLI_HOME || path.join(home, ".gemini"),
          "antigravity-cli",
          "brain",
        ),
        dir: path.join(
          env.GEMINI_CLI_HOME || path.join(home, ".gemini"),
          "antigravity-cli",
          "brain",
          nativeId,
          ".system_generated",
          "tasks",
        ),
        pattern: /^task-\d+\.log$/,
      },
    ];
  if (provider === "claude")
    return [
      {
        base:
          env.CLAUDE_CODE_TMPDIR ||
          path.join(temp, `claude-${uid ?? env.USERNAME ?? "user"}`),
        dir: path.join(
          env.CLAUDE_CODE_TMPDIR ||
            path.join(temp, `claude-${uid ?? env.USERNAME ?? "user"}`),
          cwd.replace(/[^a-zA-Z0-9]/g, "-"),
          nativeId,
          "tasks",
        ),
        pattern: /^[a-zA-Z0-9_-]+\.output$/,
      },
    ];
  return [];
}
function createLiveFiles({
  directories,
  onData = () => {},
  interval = 150,
  baseline = true,
}) {
  const files = new Map();
  let stopped = false,
    pending,
    initialized = false;
  const metadata = (name) => ({
    file: name,
    stepIndex: name.match(/^task-(\d+)\.log$/)?.[1],
  });
  async function poll() {
    if (stopped) return;
    if (pending) return pending;
    pending = (async () => {
      for (const { dir, pattern, base = dir, conversationId } of directories) {
        try {
          const expected = path.join(
            await fs.promises.realpath(base),
            path.relative(base, dir),
          );
          const actual = await fs.promises.realpath(dir);
          if (
            process.platform === "win32"
              ? actual.toLowerCase() !== expected.toLowerCase()
              : actual !== expected
          )
            continue;
        } catch {
          continue;
        }
        let entries;
        try {
          entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries
          .filter((e) => e.isFile() && pattern.test(e.name))
          .slice(-128)) {
          const filename = path.join(dir, entry.name);
          if (files.has(filename)) continue;
          let handle;
          try {
            handle = await fs.promises.open(
              filename,
              fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
            );
            const stat = await handle.stat();
            if (!stat.isFile() || stopped) {
              await handle.close();
              continue;
            }
            files.set(filename, {
              name: entry.name,
              conversationId,
              handle,
              offset: baseline && !initialized && !conversationId ? stat.size : 0,
              decoder: new StringDecoder("utf8"),
            });
          } catch {
            await handle?.close().catch(() => {});
          }
        }
      }
      // Keep descriptors open: Claude may unlink its temporary output immediately at completion.
      // The final bytes remain readable through this descriptor, even after unlink.
      // Drena os logs incrementais antes do snapshot do transcript, para não repetir a saída.
      for (const tracked of [...files.values()].sort((a, b) => Number(a.name === "transcript.jsonl") - Number(b.name === "transcript.jsonl"))) {
        try {
          const stat = await tracked.handle.stat();
          if (
            stat.size < tracked.offset ||
            (tracked.name === "transcript.jsonl" && stat.size !== tracked.offset)
          ) {
            tracked.offset = 0;
            tracked.decoder = new StringDecoder("utf8");
          }
          let budget = 256 * 1024;
          while (tracked.offset < stat.size && budget > 0 && !stopped) {
            const buffer = Buffer.alloc(
              Math.min(32768, stat.size - tracked.offset, budget),
            );
            const { bytesRead } = await tracked.handle.read(
              buffer,
              0,
              buffer.length,
              tracked.offset,
            );
            if (!bytesRead) break;
            tracked.offset += bytesRead;
            budget -= bytesRead;
            const text = tracked.decoder.write(buffer.subarray(0, bytesRead));
            if (text) onData(text, { ...metadata(tracked.name), ...(tracked.conversationId ? { conversationId: tracked.conversationId } : {}) });
          }
        } catch {}
      }
      initialized = true;
    })().finally(() => (pending = null));
    return pending;
  }
  const ready = poll(),
    timer = setInterval(() => void poll().catch(() => {}), interval);
  timer.unref?.();
  return {
    ready,
    poll,
    addDirectories(extra) {
      for (const directory of extra)
        if (!directories.some((d) => d.dir === directory.dir)) directories.push(directory);
      return poll();
    },
    hasFile: (name) => [...files.values()].some((f) => f.name === name),
    async stop() {
      stopped = true;
      clearInterval(timer);
      await pending;
      await Promise.all(
        [...files.values()].map((f) => f.handle.close().catch(() => {})),
      );
      files.clear();
    },
  };
}
module.exports = { createLiveFiles, liveDirectories };
