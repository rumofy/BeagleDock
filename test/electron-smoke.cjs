const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const path = require("node:path");
const stage = process.argv.at(-1);
const failures = [];
Object.defineProperty(app, "isPackaged", { get: () => true });
app.on("web-contents-created", (_event, contents) => {
  contents.on("preload-error", (_event, _path, error) =>
    failures.push(error.message),
  );
  contents.on("console-message", (details) => {
    if (details.message?.includes("Uncaught")) failures.push(details.message);
  });
  contents.on("render-process-gone", (_event, details) =>
    failures.push(details.reason),
  );
});
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !details.url.startsWith("file:") }),
  );
});
const backend = require("../electron/main");
const pause = () => new Promise((resolve) => setTimeout(resolve, 40));
async function waitFor(win, expression) {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const result = await win.webContents.executeJavaScript(expression);
    if (result) return result;
    await pause();
  }
  throw new Error("Renderer timed out: " + expression);
}
async function send(win, text, expected) {
  await win.webContents.executeJavaScript(
    `(()=>{const input=document.querySelector('input[placeholder^="Mensagem"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await waitFor(
    win,
    `!document.querySelector('button[type="submit"]').disabled`,
  );
  await win.webContents.executeJavaScript(
    `document.querySelector('input[placeholder^="Mensagem"]').form.requestSubmit()`,
  );
  await waitFor(
    win,
    `document.body.innerText.includes(${JSON.stringify(expected)})`,
  );
  await waitFor(win, `!document.body.innerText.includes('EXECUTANDO CLI')`);
}
(async () => {
  await backend.ready;
  const win = BrowserWindow.getAllWindows()[0];
  win.hide();
  if (win.webContents.isLoading())
    await new Promise((resolve) =>
      win.webContents.once("did-finish-load", resolve),
    );
  await waitFor(
    win,
    `document.querySelectorAll('button[title="Abrir nova conversa"]:not(:disabled)').length === 3`,
  );
  assert.equal(
    await win.webContents.executeJavaScript("document.title"),
    "BeagleDock - Multi-AI Cockpit",
  );
  await waitFor(
    win,
    `(()=>{const logo=document.querySelector('img[alt="BeagleDock — mascote beagle"]');return logo?.complete && logo.naturalWidth>0;})()`,
  );

  await waitFor(
    win,
    `document.querySelector('[aria-label="Cotas por grupo do AGY"]')?.innerText.includes('Claude and GPT models')`,
  );
  for (const [index, name] of ["claude", "codex", "agy"].entries()) {
    if (stage === "first") {
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('button[title="Abrir nova conversa"]')[${index}].click()`,
      );
      await waitFor(
        win,
        `document.querySelector('header').innerText.includes('Nova sessão')`,
      );
      if (name === "agy") {
        await waitFor(
          win,
          `[...document.querySelector('select[aria-label="Modelo"]').options].some(o=>o.value==='fixture-orbit')`,
        );
        const choices = await win.webContents.executeJavaScript(
          `[...document.querySelector('select[aria-label="Modelo"]').options].map(o=>o.value)`,
        );
        assert.equal(
          choices.filter((value) => value === "fixture-orbit").length,
          1,
        );
        assert.equal(
          choices.some((value) => value === "fixture-orbit-economy"),
          false,
        );
        await win.webContents.executeJavaScript(
          `(()=>{const field=document.querySelector('select[aria-label="Modelo"]');field.value='fixture-orbit';field.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
        await waitFor(
          win,
          `document.querySelector('select[aria-label="Nível de raciocínio"]').options.length===3`,
        );
        const levels = await win.webContents.executeJavaScript(
          `[...document.querySelector('select[aria-label="Nível de raciocínio"]').options].map(o=>o.value)`,
        );
        assert.deepEqual(levels, ["economy", "standard", "research"]);
        await win.webContents.executeJavaScript(
          `(()=>{const field=document.querySelector('select[aria-label="Nível de raciocínio"]');field.value='research';field.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
        await waitFor(
          win,
          `document.querySelector('select[aria-label="Nível de raciocínio"]').value==='research'`,
        );
      }
      await send(win, "smoke one", `${name} fixture resposta 1`);
      await send(win, "smoke two", `${name} fixture resposta 2`);
    } else {
      await win.webContents.executeJavaScript(
        `(()=>{const cards=[...document.querySelectorAll('div.rounded-xl.border')].filter(el=>el.querySelector('button[title="Abrir nova conversa"]'));const item=[...cards[${index}].querySelectorAll('span')].find(el=>el.textContent==='smoke one');item?.click();})()`,
      );
      // Use a saved session through the rendered session row; restored titles contain the first prompt.
      await waitFor(
        win,
        `document.body.innerText.includes('${name} fixture resposta 2')`,
      );
      await send(win, "smoke three", `${name} fixture resposta 3`);
    }
  }
  if (stage === "restart") {
    const longQuestion =
      "smoke-scroll " +
      Array(500).fill("Pergunta de teste de rolagem.").join(" ");
    await send(win, longQuestion, "agy fixture resposta 4");
    await waitFor(
      win,
      `(()=>{const el=document.querySelector('[data-testid="chat-scroll"]');return el.scrollHeight>el.clientHeight && el.scrollTop+el.clientHeight>=el.scrollHeight-2;})()`,
    );
    const args = JSON.parse(
      require("fs").readFileSync(
        path.join(process.env.BEAGLEDOCK_SMOKE_ROOT, "last-args-agy.json"),
        "utf8",
      ),
    );
    assert.equal(args[args.indexOf("--model") + 1], "fixture-orbit-research");
    assert.equal(args.includes("--effort"), false);
  }
  await waitFor(
    win,
    `[...document.querySelectorAll('img[src*="providers/"]')].length>=3 && [...document.querySelectorAll('img[src*="providers/"]')].every(img=>img.complete && img.naturalWidth>0)`,
  );
  const state = await win.webContents.executeJavaScript(
    "window.beagleAPI.getSavedState()",
  );
  assert.equal(state.sessions.length, 3);
  assert.equal(new Set(state.sessions.map((s) => s.nativeSessionId)).size, 3);
  assert.ok(state.sessions.every((s) => s.nativeSessionId));
  await waitFor(
    win,
    `!!document.querySelector('[data-testid="live-shell"] .xterm')`,
  );
  if (stage === "restart") {
    const submit = async (text) => {
      await win.webContents.executeJavaScript(
        `(()=>{const input=document.querySelector('input[placeholder^="Mensagem"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await waitFor(
        win,
        `!document.querySelector('button[type="submit"]').disabled`,
      );
      await win.webContents.executeJavaScript(
        `document.querySelector('button[type="submit"]').form.requestSubmit()`,
      );
    };
    await submit("smoke-queue first");
    await waitFor(win, `document.body.innerText.includes('EXECUTANDO CLI')`);
    await submit("smoke-queue second");
    await waitFor(win, `document.body.innerText.includes('Na fila')`);
    await waitFor(win, `!document.body.innerText.includes('EXECUTANDO CLI')`);
    const after = await win.webContents.executeJavaScript(
      "window.beagleAPI.getSavedState()",
    );
    const agyBefore = state.sessions.find(
      (s) => s.providerId === "antigravity",
    );
    const agyAfter = after.sessions.find((s) => s.providerId === "antigravity");
    assert.equal(agyAfter.nativeSessionId, agyBefore.nativeSessionId);
    const replies = after.messagesBySession[agyAfter.id].filter(
      (m) => m.sender === "antigravity" && m.text.includes("fixture resposta"),
    );
    assert.ok(replies.length >= 4);
    await submit("smoke-concurrent in background");
    await waitFor(
      win,
      `document.querySelector('header').innerText.includes('EXECUTANDO CLI')`,
    );
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('button[title="Abrir nova conversa"]:disabled').length`,
      ),
      0,
    );
    await win.webContents.executeJavaScript(
      `document.querySelectorAll('button[title="Abrir nova conversa"]')[1].click()`,
    );
    await waitFor(
      win,
      `document.querySelector('header').innerText.includes('Nova sessão')`,
    );
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelector('header').innerText.includes('EXECUTANDO CLI')`,
      ),
      false,
    );
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelector('select[aria-label="Modelo"]').disabled`,
      ),
      false,
    );
    await send(win, "independent conversation", "codex fixture resposta 1");
    const middle = await win.webContents.executeJavaScript(
      "window.beagleAPI.getSavedState()",
    );
    const created = middle.sessions.find(
      (s) => !state.sessions.some((old) => old.id === s.id),
    );
    assert.ok(created?.nativeSessionId);
    assert.notEqual(created.nativeSessionId, agyBefore.nativeSessionId);
    assert.equal(
      middle.messagesBySession[agyBefore.id].some(
        (m) => m.text === "smoke-concurrent in background",
      ),
      true,
    );
    await win.webContents.executeJavaScript(
      `document.querySelector('[data-session-id="${agyBefore.id}"]').click()`,
    );
    await waitFor(
      win,
      `document.querySelector('header').innerText.includes('EXECUTANDO CLI')`,
    );
    await waitFor(
      win,
      `!document.querySelector('header').innerText.includes('EXECUTANDO CLI')`,
    );
    const done = await win.webContents.executeJavaScript(
      "window.beagleAPI.getSavedState()",
    );
    assert.equal(
      done.sessions.find((s) => s.id === agyBefore.id).nativeSessionId,
      agyBefore.nativeSessionId,
    );
    assert.ok(
      done.messagesBySession[agyBefore.id].some(
        (m) => m.text === "agy fixture resposta 7",
      ),
    );
    assert.equal(
      done.messagesBySession[created.id].some(
        (m) => m.sender === "antigravity",
      ),
      false,
    );
  }
  if (stage === "restart") {
    for (const index of [0, 1, 2]) {
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('button[title="Abrir nova conversa"]')[${index}].click()`,
      );
      await waitFor(
        win,
        `document.querySelector('header').innerText.includes('Nova sessão')`,
      );
      await win.webContents.executeJavaScript(
        `window.__liveOutput='';window.__unsubscribeLive?.();window.__unsubscribeLive=window.beagleAPI.on('pty-data',p=>{window.__liveOutput+=p.data;});void 0;`,
      );
      await win.webContents.executeJavaScript(
        `(()=>{const input=document.querySelector('input[placeholder^="Mensagem"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'smoke-live ${index}');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await waitFor(
        win,
        `!document.querySelector('button[type="submit"]').disabled`,
      );
      await win.webContents.executeJavaScript(
        `document.querySelector('button[type="submit"]').form.requestSubmit()`,
      );
      await waitFor(
        win,
        `window.__liveOutput.includes('LIVE_FIRST') && document.body.innerText.includes('LIVE_CHAT_PARTIAL')`,
      );
      assert.equal(
        await win.webContents.executeJavaScript(
          `document.querySelector('header').innerText.includes('EXECUTANDO CLI')`,
        ),
        true,
      );
      await waitFor(win, `window.__liveOutput.includes('LIVE_MIDDLE')`);
      assert.equal(
        await win.webContents.executeJavaScript(
          `document.querySelector('header').innerText.includes('EXECUTANDO CLI')`,
        ),
        true,
      );
      await waitFor(
        win,
        `!document.querySelector('header').innerText.includes('EXECUTANDO CLI')`,
      );
      await win.webContents.executeJavaScript(
        `void window.__unsubscribeLive()`,
      );
      for (const [prompt, button, answer] of [
        ["smoke-approval allow", "Autorizar uma vez", "APPROVED_ACTION_DONE"],
        ["smoke-approval deny", "Negar", "DENIED_ACTION_DONE"],
      ]) {
        await win.webContents.executeJavaScript(
          `(()=>{const input=document.querySelector('input[placeholder^="Mensagem"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(prompt)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
        );
        await waitFor(
          win,
          `!document.querySelector('button[type="submit"]').disabled`,
        );
        await win.webContents.executeJavaScript(
          `document.querySelector('button[type="submit"]').form.requestSubmit()`,
        );
        await waitFor(
          win,
          `!!document.querySelector('[aria-label="Autorizar ação da CLI"]')`,
        );
        assert.equal(
          await win.webContents.executeJavaScript(
            `document.querySelectorAll('button[title="Abrir nova conversa"]:disabled').length`,
          ),
          0,
        );
        await win.webContents.executeJavaScript(
          `[...document.querySelectorAll('[aria-label="Autorizar ação da CLI"] button')].find(b=>b.textContent===${JSON.stringify(button)}).click()`,
        );
        await waitFor(
          win,
          `document.body.innerText.includes(${JSON.stringify(answer)}) && !document.querySelector('[aria-label="Autorizar ação da CLI"]')`,
        );
        await waitFor(
          win,
          `!document.querySelector('header').innerText.includes('EXECUTANDO CLI')`,
        );
      }
      console.log(
        `Desktop streaming and allow/deny: provider ${index} passed before completion.`,
      );
      const stopBefore = await win.webContents.executeJavaScript(
        "window.beagleAPI.getSavedState()",
      );
      const target = stopBefore.sessions.find(
        (s) => s.title === "smoke-live " + index,
      );
      assert.ok(target?.nativeSessionId);
      const submitStopCase = async (text) => {
        await win.webContents.executeJavaScript(
          `(()=>{const input=document.querySelector('input[placeholder^="Mensagem"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
        );
        await waitFor(
          win,
          `!document.querySelector('button[type="submit"]').disabled`,
        );
        await win.webContents.executeJavaScript(
          `document.querySelector('button[type="submit"]').form.requestSubmit()`,
        );
      };
      await submitStopCase("smoke-hang button " + index);
      await waitFor(
        win,
        `document.body.innerText.includes('PARTIAL_BEFORE_STOP') && !!document.querySelector('[aria-label="Parar execução e cancelar fila"]')`,
      );
      await submitStopCase("queued-cancel-" + index + "-a");
      await submitStopCase("queued-cancel-" + index + "-b");
      await waitFor(win, `document.body.innerText.includes('Na fila')`);
      await win.webContents.executeJavaScript(
        `document.querySelector('[aria-label="Parar execução e cancelar fila"]').click()`,
      );
      await waitFor(
        win,
        `!document.querySelector('[aria-label="Parar execução e cancelar fila"]') && !document.querySelector('header').innerText.includes('EXECUTANDO CLI')`,
      );
      const stopped = await win.webContents.executeJavaScript(
        "window.beagleAPI.getSavedState()",
      );
      assert.equal(
        stopped.sessions.find((s) => s.id === target.id).nativeSessionId,
        target.nativeSessionId,
      );
      assert.ok(
        stopped.messagesBySession[target.id].some(
          (m) =>
            m.text.includes("Saída parcial:") &&
            m.text.includes("PARTIAL_BEFORE_STOP"),
        ),
      );
      const provider = ["claude", "codex", "agy"][index];
      const received = require("fs").readFileSync(
        path.join(
          process.env.BEAGLEDOCK_SMOKE_ROOT,
          "received-" + provider + ".jsonl",
        ),
        "utf8",
      );
      assert.equal(received.includes("queued-cancel-" + index), false);
      await send(
        win,
        "resume after stop " + index,
        provider + " fixture resposta",
      );
      await submitStopCase("smoke-hang text " + index);
      await waitFor(
        win,
        `!!document.querySelector('[aria-label="Parar execução e cancelar fila"]')`,
      );
      await submitStopCase("para");
      await waitFor(
        win,
        `!document.querySelector('header').innerText.includes('EXECUTANDO CLI')`,
      );
      const afterStop = await win.webContents.executeJavaScript(
        "window.beagleAPI.getSavedState()",
      );
      assert.equal(
        afterStop.sessions.find((s) => s.id === target.id).nativeSessionId,
        target.nativeSessionId,
      );
      const inputs = require("fs")
        .readFileSync(
          path.join(
            process.env.BEAGLEDOCK_SMOKE_ROOT,
            "received-" + provider + ".jsonl",
          ),
          "utf8",
        )
        .trim()
        .split("\n")
        .map(JSON.parse);
      assert.equal(
        inputs.some((m) => m.text === "para"),
        false,
      );
      console.log(
        `Desktop stop, queue cancellation and native resume: provider ${index} passed.`,
      );
    }
  }
  await win.webContents.executeJavaScript(
    `document.querySelector('button[title="Configurações, Banco SQLite & MCPs"]').click()`,
  );
  await waitFor(
    win,
    `document.querySelectorAll('button[aria-label^="Atualizar "]').length===3`,
  );
  await waitFor(
    win,
    `!!document.querySelector('select[aria-label="Antigravity: Política de ferramentas global"]')`,
  );
  if (stage === "first") {
    await win.webContents.executeJavaScript(
      `(()=>{const field=document.querySelector('select[aria-label="Antigravity: Política de ferramentas global"]');field.value='strict';field.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await waitFor(
      win,
      `[...document.querySelectorAll('button')].some(b=>b.textContent==='Salvar permissão global')`,
    );
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('button')].find(b=>b.textContent==='Salvar permissão global').click()`,
    );
    await waitFor(
      win,
      `document.body.innerText.includes('Permissão global salva.')`,
    );
    const settings = JSON.parse(
      require("fs").readFileSync(
        path.join(process.env.HOME, ".gemini/antigravity-cli/settings.json"),
        "utf8",
      ),
    );
    assert.equal(settings.toolPermission, "strict");
    await win.webContents.executeJavaScript(
      `document.querySelector('button[aria-label="Atualizar Antigravity"]').click()`,
    );
    await waitFor(
      win,
      `document.body.innerText.includes('CLI atualizada para 1.4.0.')`,
    );
    assert.deepEqual(
      JSON.parse(
        require("fs").readFileSync(
          path.join(process.env.BEAGLEDOCK_SMOKE_ROOT, "update-agy.json"),
          "utf8",
        ),
      ),
      ["update"],
    );
  } else {
    const value = await win.webContents.executeJavaScript(
      `document.querySelector('select[aria-label="Antigravity: Política de ferramentas global"]').value`,
    );
    assert.equal(value, "strict");
  }
  assert.deepEqual(failures, []);
  console.log(
    `Desktop smoke ${stage}: três provedores, mensagens e IDs persistentes passaram.`,
  );
  backend.shutdown();
  app.quit();
})().catch((error) => {
  console.error(error);
  backend.shutdown();
  app.exit(1);
});
setTimeout(() => {
  console.error("Desktop smoke timeout");
  app.exit(1);
}, 45000).unref();
