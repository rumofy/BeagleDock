// Optional live integration check. Invoking this script uses locally authenticated CLIs.
// Ordinary npm test and test:desktop remain offline and never invoke providers.
const fs = require("fs"),
  os = require("os"),
  path = require("path");
const { createCliRunner } = require("../electron/cli-runner");
const { createCatalogs } = require("../electron/catalogs");
const { findBinary } = require("../electron/platform");
const selected = process.argv
  .find((a) => a.startsWith("--providers="))
  ?.split("=")[1]
  .split(",") || ["claude", "codex", "antigravity"];
const command = `node -e "console.log('BLEAGLE_CANARY_FIRST');let n=0;const t=setInterval(()=>{console.log('BLEAGLE_CANARY_TICK_'+(++n));if(n===4){clearInterval(t);console.log('BLEAGLE_CANARY_LAST')}},1000)"`;
const npmScenario = process.argv.includes("--npm-test");
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
    const cwd = fs.mkdtempSync(
        path.join(os.tmpdir(), "bleagledock-live-canary-"),
      ),
      links = new Map(),
      times = {},
      start = Date.now();
    if (npmScenario) {
      fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
        name: "bleagledock-stream-fixture", private: true,
        scripts: { test: "node tests.cjs" },
      }));
      fs.writeFileSync(path.join(cwd, "tests.cjs"),
        "console.log('BLEAGLE_CANARY_FIRST');let n=0;const t=setInterval(()=>{console.log('BLEAGLE_CANARY_TICK_'+(++n));if(n===8){clearInterval(t);console.log('BLEAGLE_CANARY_LAST')}},1000);");
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
      turnTimeout: 90000,
      emit: (channel, payload) => {
        if (channel === "cli-stream-chunk" && payload.fullText && !times.chat)
          times.chat = Date.now() - start;
        if (channel !== "pty-data" || payload.data.startsWith("$")) return;
        for (const [key, marker] of Object.entries({
          first: "BLEAGLE_CANARY_FIRST",
          tick: "BLEAGLE_CANARY_TICK_",
          last: "BLEAGLE_CANARY_LAST",
        }))
          if (payload.data.includes(marker) && times[key] === undefined)
            times[key] = Date.now() - start;
      },
    });
    try {
      const result = await runner.execute({
        providerId,
        sessionId: "canary-" + providerId,
        cwd,
        model,
        permission: "full",
        prompt: npmScenario
          ? "Roda pra mim os testes unitários deste projeto com npm test e me diga o resultado."
          : `Do not read or modify any project files. Run exactly this harmless command once: ${command}. ${providerId === "antigravity" ? "Use WaitMsBeforeAsync=1000 and manage_task to wait for completion." : ""} Wait until the command finishes, then reply exactly DONE.`,
      });
      times.completed = Date.now() - start;
      const live =
        result.ok &&
        times.tick !== undefined &&
        times.last !== undefined &&
        times.tick < times.last &&
        times.last <= times.completed;
      if (!live) failed++;
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
