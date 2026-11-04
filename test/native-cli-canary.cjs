// Optional live integration check. Invoking this script uses locally authenticated CLIs.
// Ordinary npm test and test:desktop remain offline and never invoke providers.
const fs = require("fs"),
  path = require("path");
const { createCliRunner } = require("../electron/cli-runner");
const { createCatalogs } = require("../electron/catalogs");
const { findBinary } = require("../electron/platform");
const { makeProbeDir } = require("./probe-dir.cjs");
const selected = process.argv
  .find((a) => a.startsWith("--providers="))
  ?.split("=")[1]
  .split(",") || ["claude", "codex", "antigravity"];
const command = `node -e "console.log('BEAGLEDOCK_CANARY_FIRST');let n=0;const t=setInterval(()=>{console.log('BEAGLEDOCK_CANARY_TICK_'+(++n));if(n===4){clearInterval(t);console.log('BEAGLEDOCK_CANARY_LAST')}},1000)"`;
const npmScenario = process.argv.includes("--npm-test");
// Two commands at the same time: each output must arrive with its own command's origin (shellId).
const parallelScenario = process.argv.includes("--parallel");
const parallelCommand = (tag) =>
  `node -e "let n=0;console.log('PAR_${tag}_FIRST');const t=setInterval(()=>{console.log('PAR_${tag}_TICK_'+(++n));if(n===3){clearInterval(t);console.log('PAR_${tag}_LAST')}},1000)"`;
(async () => {
  const catalogs = createCatalogs();
  await catalogs.refreshAgy();
  const local = catalogs.localCatalogs();
  let failed = 0;
  for (const providerId of selected) {
    if (!["claude", "codex", "antigravity"].includes(providerId))
      throw new Error("Invalid provider");
    if (!findBinary(providerId === "antigravity" ? "agy" : providerId)) {
      console.log(JSON.stringify({ providerId, status: "not-installed" }));
      failed++;
      continue;
    }
    // The folder already comes with the single probes project's `.ai-memory.toml`.
    const cwd = makeProbeDir("canary-probe"),
      links = new Map(),
      times = {},
      shells = {},
      origins = new Set(),
      shellText = {},
      start = Date.now();
    if (npmScenario) {
      fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
        name: "beagledock-stream-fixture", private: true,
        scripts: { test: "node tests.cjs" },
      }));
      fs.writeFileSync(path.join(cwd, "tests.cjs"),
        "console.log('BEAGLEDOCK_CANARY_FIRST');let n=0;const t=setInterval(()=>{console.log('BEAGLEDOCK_CANARY_TICK_'+(++n));if(n===8){clearInterval(t);console.log('BEAGLEDOCK_CANARY_LAST')}},1000);");
    }
    const options = local[providerId]?.modelOptions || [];
    const option =
      providerId === "antigravity"
        ? options.find((m) => /gemini.*flash/i.test(m.id))
        : providerId === "claude"
          ? options.find((m) => /sonnet/i.test(m.id))
          : null;
    const model = process.argv.includes("--use-cli-default") ? "" : ( option?.efforts?.at(-1)?.nativeModel || option?.id || "");
    const runner = createCliRunner({
      store: {
        getNativeSession: async (id) => links.get(id),
        setNativeSession: async (id, p, nativeId, cwd) =>
          links.set(id, { nativeId, cwd }),
      },
      turnTimeout: parallelScenario ? 180000 : 90000,
      emit: (channel, payload) => {
        if (channel === "cli-stream-chunk" && payload.fullText && !times.chat)
          times.chat = Date.now() - start;
        if (parallelScenario && channel === "pty-data") {
          const tag = /PAR_(A|B)_/.exec(payload.data)?.[1];
          if (tag) {
            (shells[tag] ||= new Set()).add(payload.shellId || "(no origin)");
            (shellText[payload.shellId || "(no origin)"] ||= "");
            shellText[payload.shellId || "(no origin)"] += payload.data;
          }
        }
        if (channel !== "pty-data" || payload.data.startsWith("$")) return;
        for (const [key, marker] of Object.entries({
          first: "BEAGLEDOCK_CANARY_FIRST",
          tick: "BEAGLEDOCK_CANARY_TICK_",
          last: "BEAGLEDOCK_CANARY_LAST",
        }))
          if (payload.data.includes(marker)) {
            origins.add(payload.shellId || "(no origin)");
            if (times[key] === undefined) times[key] = Date.now() - start;
          }
      },
    });
    try {
      const result = await runner.execute({
        providerId,
        sessionId: "canary-" + providerId,
        cwd,
        model,
        permission: "full",
        prompt: parallelScenario
          ? `Do not read or modify any project files. Run these two harmless commands IN PARALLEL (start both before waiting for either; use separate tool calls in the same step), then wait for both to finish and reply exactly DONE. Command A: ${parallelCommand("A")} Command B: ${parallelCommand("B")} ${providerId === "antigravity" ? "Use WaitMsBeforeAsync=1000 and manage_task to wait for completion." : ""}`
          : npmScenario
          ? "Run this project's unit tests with npm test and tell me the result."
          : `Do not read or modify any project files. Run exactly this harmless command once: ${command}. ${providerId === "antigravity" ? "Use WaitMsBeforeAsync=1000 and manage_task to wait for completion." : ""} Wait until the command finishes, then reply exactly DONE.`,
      });
      times.completed = Date.now() - start;
      const live =
        result.ok &&
        times.tick !== undefined &&
        times.last !== undefined &&
        times.tick < times.last &&
        times.last <= times.completed;
      if (!live && !parallelScenario) failed++;
      let attribution;
      if (parallelScenario) {
        const own = (tag) => [...(shells[tag] || [])].filter((id) => id !== "(no origin)");
        const a = own("A"), b = own("B");
        const unattributed = ["A", "B"].filter((tag) => shells[tag]?.has("(no origin)")).length;
        const distinct = a.length === 1 && b.length === 1 && a[0] !== b[0];
        const clean = distinct && !/PAR_B_/.test(shellText[a[0]] || "") && !/PAR_A_/.test(shellText[b[0]] || "");
        attribution = { A: a, B: b, distinct, clean, unattributed };
        if (!clean) failed++;
      }
      const nativeId = result.nativeSessionId;
      const resumed = result.ok
        ? await runner.execute({
            providerId,
            sessionId: "canary-" + providerId,
            cwd,
            model,
            permission: "full",
            prompt: "Do not execute anything. Reply exactly CONTINUED.",
          })
        : null;
      const preserved = !!nativeId && resumed?.nativeSessionId === nativeId;
      if (!preserved) failed++;
      console.log(
        JSON.stringify({
          providerId,
          live,
          preserved,
          origins: [...origins],
          ...(attribution ? { attribution } : {}),
          times,
          status: result.ok ? "completed" : "failed",
          error: result.ok ? undefined : result.error,
        }),
      );
    } finally {
      runner.shutdown();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
  process.exitCode = failed ? 1 : 0;
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
