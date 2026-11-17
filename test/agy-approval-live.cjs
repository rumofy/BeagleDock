// Optional live check of Antigravity's approval path: the real agy CLI, in "Accept edits", asks to
// run a command; its hook reaches BeagleDock through the approval bridge (a named pipe on Windows,
// a Unix socket elsewhere), the broker shows the request, the check approves it once, and the
// command must then run. Uses the locally authenticated agy; never part of `npm test`.
//
//   node test/agy-approval-live.cjs
const { createCliRunner } = require("../electron/cli-runner");
const { createApprovalBroker } = require("../electron/approvals");
const { findBinary } = require("../electron/platform");
const { makeProbeDir } = require("./probe-dir.cjs");
const fs = require("fs");

(async () => {
  if (!findBinary("agy")) {
    console.log(JSON.stringify({ providerId: "antigravity", status: "not-installed" }));
    process.exitCode = 1;
    return;
  }
  const cwd = makeProbeDir("approval-probe");
  const links = new Map();
  const seen = [];
  let output = "";
  let broker;
  broker = createApprovalBroker({
    emit: (channel, list) => {
      if (channel !== "cli-approvals") return;
      for (const request of list) {
        if (seen.some((s) => s.id === request.id)) continue;
        seen.push({ id: request.id, tool: request.tool, options: request.options.map((o) => o.id) });
        const once = request.options.find((o) => o.kind === "allow_once") || request.options.find((o) => /allow|once/i.test(o.id));
        setTimeout(() => broker.resolve(request.id, once ? once.id : request.options[0].id), 300);
      }
    },
  });
  const runner = createCliRunner({
    store: {
      getNativeSession: async (id) => links.get(id),
      setNativeSession: async (id, _p, nativeId, dir) => links.set(id, { nativeId, cwd: dir }),
    },
    approvals: broker,
    turnTimeout: 180000,
    emit: (channel, payload) => {
      if (channel === "pty-data" && typeof payload.data === "string") output += payload.data;
    },
  });
  try {
    const result = await runner.execute({
      providerId: "antigravity",
      sessionId: "approval-live",
      cwd,
      permission: "edits",
      prompt:
        'Do not read or modify any project files. Run exactly this harmless command once: node -e "console.log(\'BEAGLEDOCK_APPROVED_RAN\')". Use WaitMsBeforeAsync=1000 and manage_task to wait for completion, then reply exactly DONE.',
    });
    const ran = output.includes("BEAGLEDOCK_APPROVED_RAN") || JSON.stringify(result || {}).includes("BEAGLEDOCK_APPROVED_RAN");
    const ok = seen.length > 0 && ran;
    console.log(JSON.stringify({ providerId: "antigravity", approvals: seen, ran, status: ok ? "completed" : "failed" }));
    process.exitCode = ok ? 0 : 1;
  } finally {
    runner.shutdown();
    // Windows keeps the folder locked for a moment while the CLI process exits.
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
