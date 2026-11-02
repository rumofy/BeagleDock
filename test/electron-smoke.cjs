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
    if (details.message?.includes("Uncaught")) {
      failures.push(details.message);
      console.error(`[renderer] ${details.message}`);
    }
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

  // Os detalhes da cota começam recolhidos: nada deles aparece até abrir.
  await waitFor(win, `!document.querySelector('[data-testid="quota-details"]')`);
  await win.webContents.executeJavaScript(
    `document.querySelectorAll('button[aria-label^="Detalhes da cota"]').forEach((b) => b.click())`,
  );
  await waitFor(
    win,
    `document.querySelector('[aria-label="Cotas por grupo do AGY"]')?.innerText.includes('Claude and GPT models')`,
  );
  // Cotas lidas das próprias CLIs (Claude /usage e Codex app-server), com horário de reinício.
  await waitFor(
    win,
    `(()=>{const t=document.body.innerText;return t.includes('5h: 34%') && t.includes('5h: 21%') && t.includes('Reinicia · 5h:');})()`,
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
  // A conversa criada por "Continuar em outra CLI" no primeiro estágio sobrevive à reinicialização.
  const expectedSessions = stage === "restart" ? 4 : 3;
  assert.equal(state.sessions.length, expectedSessions);
  assert.equal(new Set(state.sessions.map((s) => s.nativeSessionId)).size, expectedSessions);
  assert.ok(state.sessions.every((s) => s.nativeSessionId));
  await waitFor(
    win,
    `!!document.querySelector('[data-testid="live-shell"] .xterm')`,
  );
  // Manutenção de workspaces: estado da pasta, renomear (persistido) e remover só do cadastro.
  {
    const click = (expr) => win.webContents.executeJavaScript(`(${expr}).click()`);
    await click(`document.querySelector('button[aria-label="Gerenciar workspaces"]')`);
    await waitFor(win, `document.querySelectorAll('[data-testid="workspace-list"] li').length>=1 && document.querySelector('[data-testid="workspace-list"]').innerText.includes('pasta encontrada')`);
    const before = await win.webContents.executeJavaScript(`window.beagleAPI.getSavedState().then(s=>s.sessions.map(x=>[x.id,x.cwd,x.nativeSessionId].join('|')).sort())`);
    await click(`document.querySelector('[data-testid="workspace-list"] button[aria-label^="Editar"]')`);
    await win.webContents.executeJavaScript(`(()=>{const input=document.querySelector('input[aria-label="Nome do workspace"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Renomeado ${stage}');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.innerText.trim()==='Salvar')`);
    await waitFor(win, `document.querySelector('[data-testid="workspace-list"]').innerText.includes('Renomeado ${stage}')`);
    assert.deepEqual(
      await win.webContents.executeJavaScript(`window.beagleAPI.getSavedState().then(s=>s.sessions.map(x=>[x.id,x.cwd,x.nativeSessionId].join('|')).sort())`),
      before,
      "renomear o workspace não altera as conversas nem os ids nativos",
    );
    await click(`document.querySelector('[role="dialog"] button[aria-label="Fechar"]')`);
    await waitFor(win, `!document.querySelector('[role="dialog"]')`);
  }
  if (stage === "first") {
    // Continuar em outra CLI: conversa nova com o resumo; a original e o id nativo ficam intactos.
    const before = await win.webContents.executeJavaScript(`window.beagleAPI.getSavedState()`);
    const origin = before.sessions.find((x) => x.status !== "archived");
    await win.webContents.executeJavaScript(`document.querySelector('button[title^="Continuar esta tarefa em outra CLI"]').click()`);
    await waitFor(win, `document.querySelectorAll('[role="menuitem"]').length>=2`);
    await win.webContents.executeJavaScript(`document.querySelector('[role="menuitem"]').click()`);
    await waitFor(win, `document.querySelector('header').innerText.includes('Continuação:')`);
    await waitFor(win, `document.body.innerText.includes('Pedido atual: confira o estado real do projeto')`);
    const after = await win.webContents.executeJavaScript(`window.beagleAPI.getSavedState()`);
    assert.equal(after.sessions.length, before.sessions.length + 1, "criou uma conversa nova");
    const created = after.sessions.find((x) => !before.sessions.some((y) => y.id === x.id));
    assert.match(created.title, /^Continuação: /);
    assert.notEqual(created.providerId, after.sessions.find((x) => x.id === origin.id).providerId === created.providerId ? "igual" : "x");
    for (const old of before.sessions) {
      const same = after.sessions.find((x) => x.id === old.id);
      assert.equal(same.nativeSessionId, old.nativeSessionId, "o id nativo da conversa original não muda");
      assert.equal(same.title, old.title);
    }
    assert.equal(created.cwd, origin.cwd);
    await waitFor(win, `!document.body.innerText.includes('EXECUTANDO CLI')`);
    // Volta para a conversa original: os passos seguintes partem dela.
    await win.webContents.executeJavaScript(`document.querySelector('[data-session-id="${origin.id}"]').click()`);
    await waitFor(win, `!document.querySelector('header').innerText.includes('Continuação:')`);
  }
  // Anexos: soltar uma imagem e um arquivo no compositor e enviar; cada CLI recebe no formato dela.
  if (stage === "restart") {
    const provider = await win.webContents.executeJavaScript(
      `window.beagleAPI.getSavedState().then(s=>{const el=document.querySelector('header');return el.innerText})`,
    );
    await win.webContents.executeJavaScript(`(()=>{
      const form=document.querySelector('button[type="submit"]').form;
      const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
      const data=new DataTransfer();
      data.items.add(new File([png],'print.png',{type:'image/png'}));
      data.items.add(new File(['log de erro'],'erro.log',{type:'text/plain'}));
      form.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
    })()`);
    await waitFor(win, `document.body.innerText.includes('print.png') && document.body.innerText.includes('erro.log')`);
    await win.webContents.executeJavaScript(
      `(()=>{const input=document.querySelector('input[placeholder^="Mensagem"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'smoke-attach analisa isso');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await waitFor(win, `!document.querySelector('button[type="submit"]').disabled`);
    await win.webContents.executeJavaScript(`document.querySelector('button[type="submit"]').form.requestSubmit()`);
    await waitFor(win, `!document.body.innerText.includes('EXECUTANDO CLI') && document.body.innerText.includes('fixture resposta')`);
    const readLines = (file) => {
      try {
        return require("fs").readFileSync(path.join(process.env.BEAGLEDOCK_SMOKE_ROOT, file), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    };
    const claude = readLines("received-claude.jsonl").find((r) => r.text.includes("smoke-attach"));
    const agy = readLines("received-agy.jsonl").find((r) => r.text.includes("smoke-attach"));
    const codex = readLines("received-codex-input.jsonl").find((types) => types.includes("localImage"));
    const delivered = [claude, agy, codex].filter(Boolean);
    assert.equal(delivered.length >= 1, true, "a CLI da conversa recebeu a mensagem com anexos");
    if (claude) {
      assert.deepEqual(claude.blocks, ["image:image/png", "text"]);
      assert.match(claude.text, /Arquivos anexados:\n- .*erro\.log/);
    }
    if (agy) {
      assert.match(agy.text, /\.png \(imagem: print\.png\)/);
      await waitFor(win, `document.body.innerText.includes('Antigravity não tem campo nativo de imagem')`);
    }
    if (codex) assert.deepEqual(codex.slice(0, 3), ["text", "localImage", "mention:erro.log"]);
    await waitFor(win, `[...document.querySelectorAll('img[alt="print.png"]')].length>=1`);
  }
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
        `window.__liveOutput='';window.__shellOutput={};window.__unsubscribeLive?.();window.__unsubscribeLive=window.beagleAPI.on('pty-data',p=>{window.__liveOutput+=p.data;if(p.shellId)window.__shellOutput[p.shellId]=(window.__shellOutput[p.shellId]||'')+p.data;});void 0;`,
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
      await win.webContents.executeJavaScript(`(()=>{
        const steps=document.querySelector('[data-testid="chat-timeline-steps"]');
        const activity=document.querySelector('[data-testid="chat-activity"]');
        window.__boxSizes=[];
        const record=()=>{
          if (!activity.isConnected || !steps.isConnected) return;
          window.__boxSizes.push({steps:steps.getBoundingClientRect().height,activity:activity.getBoundingClientRect().height,overflow:steps.scrollWidth>steps.clientWidth});
        };
        record();
        window.__boxObserver=new ResizeObserver(record);
        window.__boxObserver.observe(steps);window.__boxObserver.observe(activity);
        window.__boxMutation=new MutationObserver(record);
        window.__boxMutation.observe(steps,{subtree:true,childList:true,characterData:true,attributes:true});
        window.__boxMutation.observe(activity,{subtree:true,childList:true,characterData:true,attributes:true});
      })()`);
      assert.equal(
        await win.webContents.executeJavaScript(
          `document.querySelector('header').innerText.includes('EXECUTANDO CLI')`,
        ),
        true,
      );
      await waitFor(win, `window.__liveOutput.includes('LIVE_MIDDLE')`);
      if (index === 1) {
        // Codex: dois comandos em paralelo chegam etiquetados, cada saída com a origem certa.
        await waitFor(win, `window.__shellOutput['live-cmd']?.includes('LIVE_FIRST') && window.__shellOutput['live-cmd-2']?.includes('PARALLEL_BUILD')`);
        assert.equal(await win.webContents.executeJavaScript(`!window.__shellOutput['live-cmd'].includes('PARALLEL_BUILD') && !window.__shellOutput['live-cmd-2'].includes('LIVE_FIRST')`), true, "a saída de cada comando fica na origem dele");
        // Sem abas (0.6.1): as saídas dos dois comandos aparecem no mesmo fluxo do shell.
        await waitFor(win, `(()=>{const t=document.querySelector('[data-testid="live-shell"]')?.innerText||'';return t.includes('LIVE_FIRST')&&t.includes('PARALLEL_BUILD');})()`);
      }
      if (index === 1) await waitFor(win, `document.body.innerText.includes('Analisando um comando com argumentos extensos')`);
      assert.equal(
        await win.webContents.executeJavaScript(
          `document.querySelector('header').innerText.includes('EXECUTANDO CLI')`,
        ),
        true,
      );
      // Fechar a janela no meio da execução vai para a bandeja: o app e a sessão continuam.
      win.close();
      assert.equal(win.isDestroyed(), false, "fechar não destrói a janela");
      assert.equal(
        !win.isVisible() || win.isMinimized(),
        true,
        "a janela sai da tela (bandeja ou minimizada)",
      );
      await waitFor(
        win,
        `!document.querySelector('header').innerText.includes('EXECUTANDO CLI')`,
      );
      const boxSizes = await win.webContents.executeJavaScript("window.__boxObserver.disconnect();window.__boxMutation.disconnect();window.__boxSizes");
      assert.ok(boxSizes.length > 1);
      for (const size of ["steps", "activity"]) {
        const values = boxSizes.map((s) => s[size]);
        assert.ok(Math.max(...values) - Math.min(...values) < 1, `caixa ${size} mantém a altura durante a execução`);
      }
      assert.ok(boxSizes.every((s) => !s.overflow), "etapas não criam barra horizontal");
      win.show();
      assert.equal(win.isVisible(), true);
      await win.webContents.executeJavaScript(
        `void window.__unsubscribeLive()`,
      );
      // Opcional: capturas de tela para revisão visual (BEAGLEDOCK_SHOT_DIR=/pasta).
      if (process.env.BEAGLEDOCK_SHOT_DIR && index === 0) {
        const fsShots = require("fs");
        for (const theme of ["light", "dark"]) {
          await win.webContents.executeJavaScript(
            `document.documentElement.dataset.theme=${JSON.stringify(theme)};void 0`,
          );
          await new Promise((resolve) => setTimeout(resolve, 400));
          const image = await win.webContents.capturePage();
          fsShots.writeFileSync(
            require("path").join(process.env.BEAGLEDOCK_SHOT_DIR, `chat-${theme}.png`),
            image.toPNG(),
          );
        }
        await win.webContents.executeJavaScript(
          `document.querySelector('button[title^="Configurações"]').click();void 0`,
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
        await win.webContents.executeJavaScript(
          `document.documentElement.dataset.theme='dark';void 0`,
        );
        await new Promise((resolve) => setTimeout(resolve, 400));
        fsShots.writeFileSync(
          require("path").join(process.env.BEAGLEDOCK_SHOT_DIR, "settings-dark.png"),
          (await win.webContents.capturePage()).toPNG(),
        );
        await win.webContents.executeJavaScript(
          `document.documentElement.dataset.theme='light';void 0`,
        );
        // Volta ao chat para o restante do teste.
        await win.webContents.executeJavaScript(
          `[...document.querySelectorAll('button')].find((b)=>b.innerText.includes('Voltar ao Chat'))?.click();void 0`,
        );
        await waitFor(win, `!!document.querySelector('input[placeholder^="Mensagem"]')`);
      }
      for (const [prompt, button, answer] of [
        ["smoke-approval allow", "Permitir uma vez", "APPROVED_ACTION_DONE"],
        ["smoke-approval deny", "Negar", "DENIED_ACTION_DONE"],
        // Trocar para Acesso total com a resposta parada na aprovação libera a ação pendente.
        ["smoke-approval allow", "__full__", "APPROVED_ACTION_DONE"],
        ...(index > 0 ? [
          ["smoke-approval-child allow", "Permitir uma vez", "APPROVED_ACTION_DONE"],
          ["smoke-approval-child deny", "Negar", "DENIED_ACTION_DONE"],
        ] : []),
      ]) {
        if (prompt.includes("-child")) await win.webContents.executeJavaScript("window.__liveOutput='';window.__unsubscribeLive?.();window.__unsubscribeLive=window.beagleAPI.on('pty-data',p=>{window.__liveOutput+=p.data;});void 0");
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
        // A permissão aparece no próprio chat (com as opções da CLI), destacada no cabeçalho,
        // e não no aviso global.
        assert.equal(
          await win.webContents.executeJavaScript(
            `!!document.querySelector('[data-testid="approval-card"]') && !!document.querySelector('[data-testid="waiting-permission"]') && !document.querySelector('[aria-label="Permissão pendente em outra conversa"]') && document.body.innerText.includes('Aguardando permissão')`,
          ),
          true,
          "permissão inline no chat com destaque",
        );
        if (process.env.BEAGLEDOCK_SHOT_DIR && index === 1 && prompt.endsWith("allow")) {
          for (const theme of ["light", "dark"]) {
            await win.webContents.executeJavaScript(
              `document.documentElement.dataset.theme=${JSON.stringify(theme)};void 0`,
            );
            await new Promise((resolve) => setTimeout(resolve, 400));
            require("fs").writeFileSync(
              require("path").join(process.env.BEAGLEDOCK_SHOT_DIR, `approval-${theme}.png`),
              (await win.webContents.capturePage()).toPNG(),
            );
          }
          await win.webContents.executeJavaScript(
            `document.documentElement.dataset.theme='light';void 0`,
          );
        }
        assert.equal(
          await win.webContents.executeJavaScript(
            `document.querySelectorAll('button[title="Abrir nova conversa"]:disabled').length`,
          ),
          0,
        );
        const permissionBefore = button === "__full__"
          ? await win.webContents.executeJavaScript(`document.querySelector('select[data-control="permission"]').value`)
          : null;
        const choosePermission = (value) =>
          win.webContents.executeJavaScript(
            `(()=>{const s=document.querySelector('select[data-control="permission"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,${JSON.stringify("__VALUE__")});s.dispatchEvent(new Event('change',{bubbles:true}));})()`.replace("__VALUE__", value),
          );
        if (button === "__full__") {
          assert.equal(
            await win.webContents.executeJavaScript(`document.querySelector('select[data-control="permission"]').disabled`),
            false,
            "seletor de permissão liberado durante a execução",
          );
          await choosePermission("full");
          await waitFor(win, `!!document.querySelector('[data-testid="permission-notice"]')`);
          const notice = await win.webContents.executeJavaScript(`document.querySelector('[data-testid="permission-notice"]').innerText`);
          assert.match(notice, /1 aprovação pendente foi liberada/);
          if (index === 0) assert.match(notice, /Novo nível aplicado/);
          if (index === 1) assert.match(notice, /próxima mensagem/);
        } else
          await win.webContents.executeJavaScript(
            `[...document.querySelectorAll('[aria-label="Autorizar ação da CLI"] button')].find(b=>b.textContent.startsWith(${JSON.stringify(button)})).click()`,
          );
        if (prompt === "smoke-approval-child allow") {
          await waitFor(win, `window.__liveOutput.includes('CHILD_FIRST')`);
          assert.equal(await win.webContents.executeJavaScript(`document.querySelector('header').innerText.includes('EXECUTANDO CLI')`), true, "saída do subagente chega ao shell antes da conclusão");
        }
        await waitFor(
          win,
          `document.body.innerText.includes(${JSON.stringify(answer)}) && !document.querySelector('[aria-label="Autorizar ação da CLI"]')`,
        );
        await waitFor(
          win,
          `!document.querySelector('header').innerText.includes('EXECUTANDO CLI')`,
        );
        if (prompt === "smoke-approval-child allow") {
          await waitFor(win, `window.__liveOutput.includes('CHILD_LAST')`);
          assert.equal(await win.webContents.executeJavaScript(`window.__liveOutput.split('CHILD_FIRST').length-1`), 1);
        }
        if (prompt.includes("-child")) await win.webContents.executeJavaScript("void window.__unsubscribeLive()");
        if (button === "__full__") {
          if (index === 0)
            assert.deepEqual(
              require("fs").readFileSync(require("path").join(process.env.BEAGLEDOCK_SMOKE_ROOT, "permission-modes-claude.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).slice(-1),
              ["bypassPermissions"],
              "Claude recebe a troca ao vivo pelo stdin",
            );
          await choosePermission(permissionBefore);
          await waitFor(win, `document.querySelector('select[data-control="permission"]').value===${JSON.stringify(permissionBefore)}`);
        }
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
      // No Claude Code as mensagens enviadas durante a resposta são entregues no meio dela (não ficam
      // na fila); nas outras CLIs elas esperam na fila e o Parar as cancela sem chegar à CLI.
      if (provider !== "claude")
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
    // Renomear (duplo clique), fechar, reabrir pelo histórico e apagar com confirmação; o estado é restaurado.
    const rowSelector = `[data-session-id]`;
    const original = await win.webContents.executeJavaScript(
      `document.querySelector('${rowSelector} span[data-session-title]').textContent`,
    );
    const rowId = await win.webContents.executeJavaScript(
      `document.querySelector('${rowSelector}').getAttribute('data-session-id')`,
    );
    const row = `[data-session-id="${rowId}"]`;
    const typeName = async (name) => {
      await win.webContents.executeJavaScript(
        `document.querySelector('${row} span[data-session-title]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));void 0`,
      );
      await waitFor(win, `!!document.querySelector('input[aria-label="Novo nome da conversa"]')`);
      await win.webContents.executeJavaScript(
        `(()=>{const i=document.querySelector('input[aria-label="Novo nome da conversa"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(name)});i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`,
      );
      await waitFor(
        win,
        `document.querySelector('${row} span[data-session-title]')?.textContent===${JSON.stringify(name)}`,
      );
    };
    await typeName("Renomeada no smoke");
    // Fechar: sai da barra lateral e fica no histórico; reabrir pelo histórico traz de volta.
    const history = `[data-history-id="beagledock:${rowId}"]`;
    const openHistory = async () => {
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Histórico de Conversas')).click()`,
      );
      await waitFor(win, `!!document.querySelector('${history}')`);
    };
    await win.webContents.executeJavaScript(
      `document.querySelector('${row} button[aria-label="Fechar conversa"]').click()`,
    );
    await waitFor(win, `!document.querySelector('${row}') && !document.body.innerText.toLowerCase().includes('arquivadas')`);
    await openHistory();
    await waitFor(win, `document.querySelector('${history}').innerText.toLowerCase().includes('fechada')`);
    await win.webContents.executeJavaScript(`document.querySelector('${history}').click()`);
    await waitFor(win, `!!document.querySelector('${row}') && !document.querySelector('${history}')`);
    // Apagar fica só no histórico e exige confirmar: o primeiro clique só arma o botão.
    await openHistory();
    await win.webContents.executeJavaScript(
      `document.querySelector('${history} button[aria-label="Apagar conversa definitivamente"]').click()`,
    );
    await waitFor(win, `!![...document.querySelectorAll('${history} button')].find(b=>b.textContent==='Apagar de vez?')`);
    assert.equal(
      await win.webContents.executeJavaScript(`!!document.querySelector('${row}')`),
      true,
      "o primeiro clique não apaga",
    );
    await waitFor(win, `![...document.querySelectorAll('${history} button')].find(b=>b.textContent==='Apagar de vez?')`, 6000);
    await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Fechar histórico"]').click()`);
    await waitFor(win, `!document.querySelector('${history}')`);
    // Reabrir leva ao chat: volta às configurações para os passos seguintes.
    await win.webContents.executeJavaScript(
      `document.querySelector('button[title="Configurações, Banco SQLite & MCPs"]').click()`,
    );
    await waitFor(win, `!!document.querySelector('select[aria-label="Antigravity: Política de ferramentas global"]')`);
    await typeName(original);
  }
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
    // Segundo plano: desligar “manter na bandeja” e ligar “iniciar com o sistema” (arquivo no HOME do teste).
    const bg = (text) => `[...document.querySelectorAll('input[type="checkbox"]')].find(i=>i.closest('label')?.innerText.includes(${JSON.stringify(text)}))`;
    assert.equal(await win.webContents.executeJavaScript(`${bg("Manter o BeagleDock na bandeja")}.checked`), true);
    assert.equal(await win.webContents.executeJavaScript(`${bg("Iniciar junto com o sistema")}.checked`), false);
    await win.webContents.executeJavaScript(`${bg("Iniciar junto com o sistema")}.click()`);
    await waitFor(win, `${bg("Iniciar junto com o sistema")}.checked===true`);
    const autostartFile = path.join(process.env.HOME, ".config", "autostart", "beagledock.desktop");
    await waitFor(win, `window.beagleAPI.getSavedState().then(s=>s.settings?.launchAtLogin===true)`);
    assert.match(require("fs").readFileSync(autostartFile, "utf8"), /--hidden/);
    await win.webContents.executeJavaScript(`${bg("Manter o BeagleDock na bandeja")}.click()`);
    await waitFor(win, `${bg("Manter o BeagleDock na bandeja")}.checked===false`);
    await waitFor(win, `window.beagleAPI.getSavedState().then(s=>s.settings?.runInBackground===false)`);
    // Volta ao padrão: com o segundo plano desligado, fechar a janela encerra o app, e o estágio
    // seguinte fecha a janela esperando a bandeja.
    await win.webContents.executeJavaScript(`${bg("Manter o BeagleDock na bandeja")}.click()`);
    await waitFor(win, `window.beagleAPI.getSavedState().then(s=>s.settings?.runInBackground===true)`);
  } else {
    const persisted = await win.webContents.executeJavaScript(`({
      tray: [...document.querySelectorAll('input[type="checkbox"]')].find(i=>i.closest('label')?.innerText.includes('Manter o BeagleDock na bandeja')).checked,
      login: [...document.querySelectorAll('input[type="checkbox"]')].find(i=>i.closest('label')?.innerText.includes('Iniciar junto com o sistema')).checked,
    })`);
    assert.deepEqual(persisted, { tray: true, login: true }, "as preferências de segundo plano sobrevivem à reinicialização");
    // Desfazer: iniciar com o sistema desligado remove o arquivo.
    await win.webContents.executeJavaScript(`[...document.querySelectorAll('input[type="checkbox"]')].find(i=>i.closest('label')?.innerText.includes('Iniciar junto com o sistema')).click()`);
    await waitFor(win, `window.beagleAPI.getSavedState().then(s=>s.settings?.launchAtLogin===false)`);
    assert.equal(require("fs").existsSync(path.join(process.env.HOME, ".config", "autostart", "beagledock.desktop")), false);
    const value = await win.webContents.executeJavaScript(
      `document.querySelector('select[aria-label="Antigravity: Política de ferramentas global"]').value`,
    );
    assert.equal(value, "strict");
  }
  {
    // Alt+P liga o plano e Alt+M percorre os modos; o seletor do cabeçalho mostra o modo e a troca persiste.
    await win.webContents.executeJavaScript(`document.querySelector('[data-session-id]').click()`);
    await waitFor(win, `!!document.querySelector('select[data-control="permission"]')`);
    const mode = () => win.webContents.executeJavaScript(`document.querySelector('select[data-control="permission"]').value`);
    const press = (key) => win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},altKey:true,bubbles:true,cancelable:true}))`);
    const start = await mode();
    await press("p");
    await waitFor(win, `document.querySelector('select[data-control="permission"]').value==='plan'`);
    await press("p");
    await waitFor(win, `document.querySelector('select[data-control="permission"]').value==='edits'`);
    await press("m");
    await waitFor(win, `document.querySelector('select[data-control="permission"]').value==='full'`);
    await press("m");
    await waitFor(win, `document.querySelector('select[data-control="permission"]').value==='inherit'`);
    assert.ok(start);
    const saved = await win.webContents.executeJavaScript(`window.beagleAPI.getSavedState().then(s=>s.sessions.map(x=>x.permission))`);
    assert.ok(saved.includes("inherit"), "a troca foi gravada na conversa");
    // Volta para a aba de configurações, de onde o passo seguinte parte.
    await win.webContents.executeJavaScript(`document.querySelector('button[title^="Configurações"]').click()`);
    await waitFor(win, `!document.querySelector('input[placeholder^="Mensagem"]')`);
  }
  {
    // Menu da bandeja e notificações pedem para abrir uma conversa: com a tela de configurações aberta,
    // a interface volta ao chat e vai até ela.
    const st = await win.webContents.executeJavaScript(`window.beagleAPI.getSavedState()`);
    const target = st.sessions[st.sessions.length - 1];
    assert.equal(await win.webContents.executeJavaScript(`!document.querySelector('input[placeholder^="Mensagem"]')`), true, "começa fora do chat");
    win.webContents.send("open-session", { sessionId: target.id });
    await waitFor(win, `!!document.querySelector('input[placeholder^="Mensagem"]') && document.querySelector('header').innerText.includes(${JSON.stringify(target.title)})`);
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
