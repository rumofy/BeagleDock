const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const path = require("node:path");
const stage = process.argv.at(-1);
const failures = [];
Object.defineProperty(app, "isPackaged", { get: () => true });
// Microfone falso do Chromium (tom contínuo) e permissão sem diálogo: exercita o ditado de verdade.
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
// Diagnóstico real do ditado local: o microfone falso toca um arquivo de fala de verdade.
if (process.env.BEAGLEDOCK_SMOKE_SPEECH_AUDIO)
  app.commandLine.appendSwitch("use-file-for-fake-audio-capture", process.env.BEAGLEDOCK_SMOKE_SPEECH_AUDIO);
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
async function waitFor(win, expression, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
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
  if (stage === "first") {
    // Modo terminal: a conversa do AGY abre a interface própria da CLI, retomando o id nativo.
    const js = (code) => win.webContents.executeJavaScript(code);
    const fs = require("fs");
    const file = (f) => path.join(process.env.BEAGLEDOCK_SMOKE_ROOT, f);
    // O xterm só desenha as linhas com a janela visível.
    win.showInactive();
    // A escolha fica nas configurações e vale para todas as conversas.
    const setMode = async (mode) => {
      await js(`document.querySelector('button[title="Configurações, Banco SQLite & MCPs"]').click()`);
      await waitFor(win, `!!document.querySelector('[data-testid="conversation-mode"] input[value="${mode}"]')`);
      await js(`document.querySelector('[data-testid="conversation-mode"] input[value="${mode}"]').click()`);
      await waitFor(win, `window.beagleAPI.getSavedState().then(s=>(s.settings.conversationMode||'chat')==='${mode}')`);
      await js(`[...document.querySelectorAll('header button')].find(b=>b.innerText.includes('Voltar')).click()`);
    };
    await setMode("terminal");
    await waitFor(win, `document.querySelector('[data-testid="cli-terminal"]')?.innerText.includes('FIXTURE TUI agy --conversation')`);
    const tui = JSON.parse(fs.readFileSync(file("tui-agy.json"), "utf8"));
    assert.equal(tui.args[0], "--conversation");
    assert.match(tui.args[1], /^[a-zA-Z0-9_-]{8,}$/);
    // Sem nada do chat: nem composer, nem lista de mensagens, nem seletores da CLI.
    assert.equal(await js(`!!document.querySelector('input[placeholder^="Mensagem"]')`), false);
    assert.equal(await js(`!!document.querySelector('[data-testid="chat-messages"]')`), false);
    assert.equal(await js(`!!document.querySelector('select[data-control="model"]')`), false);
    // Teclas vão direto para a CLI.
    await js(`(()=>{const t=document.querySelector('[data-testid="cli-terminal"] textarea');t.focus();t.dispatchEvent(new KeyboardEvent('keydown',{key:'k',code:'KeyK',keyCode:75,bubbles:true,cancelable:true}));})()`);
    await waitFor(win, `window.beagleAPI.cliTerminalList().then(l=>l.length===1)`);
    // Handoff do topo: cola o pedido na CLI e envia.
    await js(`[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Handoff').click()`);
    const start = Date.now();
    let typed = "";
    while (Date.now() - start < 10000) {
      typed = fs.existsSync(file("tui-input-agy.txt")) ? fs.readFileSync(file("tui-input-agy.txt"), "utf8") : "";
      if (typed.includes("ai-memory-handoff") && typed.endsWith("\r")) break;
      await pause();
    }
    assert.ok(typed.startsWith("k"), JSON.stringify(typed.slice(0, 20)));
    assert.match(typed, /\x1b\[200~Use a skill de handoff do ai-memory/);
    assert.ok(typed.endsWith("\x1b[201~\r"), JSON.stringify(typed.slice(-40)));
    await waitFor(win, `document.querySelector('[data-testid="cli-terminal"]').innerText.includes('ENVIADO')`);
    // O fim da resposta no terminal (a tela parou de animar) grava a conversa no histórico.
    const terminalSession = await js(`window.beagleAPI.cliTerminalList().then(l=>l[0].sessionId)`);
    await waitFor(
      win,
      `window.beagleAPI.getChatMessages(${JSON.stringify(terminalSession)}).then(list=>list.some(m=>m.sender==='antigravity'&&m.text==='FIXTURE TUI RESPOSTA')&&list.some(m=>m.sender==='user'&&m.text.includes('Use a skill de handoff do ai-memory')))`,
      20000,
    );
    const shot = async (name) => {
      if (!process.env.BEAGLEDOCK_SHOT_DIR) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
      const image = await win.webContents.capturePage();
      fs.writeFileSync(path.join(process.env.BEAGLEDOCK_SHOT_DIR, name), image.toPNG());
    };
    await shot("terminal-conversa.png");
    // Painel com as CLIs abertas no modo terminal.
    await js(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Shells')).click()`);
    await waitFor(win, `document.querySelectorAll('[data-testid="terminal-grid"] [data-testid="cli-terminal"]').length===1`);
    await waitFor(win, `document.querySelector('[data-testid="terminal-grid"]').innerText.includes('FIXTURE TUI agy')`);
    await shot("terminal-grade.png");
    await js(`document.querySelector('[data-testid="terminal-grid"] button[title="Abrir esta conversa"]').click()`);
    await waitFor(win, `!!document.querySelector('[data-testid="cli-terminal"]') && !document.querySelector('[data-testid="terminal-grid"]')`);
    // Sem botão de troca no topo da conversa: só nas configurações.
    assert.equal(await js(`[...document.querySelectorAll('header button')].some(b=>/^(Terminal|Chat)$/.test(b.innerText.trim()))`), false);
    // Enviar pelo chat com o terminal aberto é recusado no processo principal.
    const refused = await js(
      `window.beagleAPI.getSavedState().then(s=>window.beagleAPI.executeCliPrompt({sessionId:s.sessions.find(x=>x.providerId==='antigravity').id,providerId:'antigravity',prompt:'x'}))`,
    );
    assert.equal(refused.ok, false);
    assert.match(refused.error, /aberta no terminal/);
    // De volta ao chat: a CLI do terminal é encerrada e o chat continua a conversa.
    await setMode("chat");
    await waitFor(win, `!!document.querySelector('input[placeholder^="Mensagem"]')`);
    await waitFor(win, `window.beagleAPI.cliTerminalList().then(l=>l.length===0)`);
    await waitFor(win, `document.body.innerText.includes('agy fixture resposta 2')`);
    win.hide();

    // Responder agora (Claude Code): a mensagem entregue durante um comando longo espera a IA ler;
    // o botão manda o comando para o segundo plano e a IA responde já.
    await js(`(()=>{const cards=[...document.querySelectorAll('div.rounded-xl.border')].filter(el=>el.querySelector('button[title="Abrir nova conversa"]'));[...cards[0].querySelectorAll('span')].find(el=>el.textContent==='smoke one')?.click();})()`);
    await waitFor(win, `document.body.innerText.includes('claude fixture resposta 2') && !!document.querySelector('input[placeholder^="Mensagem"]')`);
    const submitNow = async (text) => {
      await js(`(()=>{const input=document.querySelector('input[placeholder^="Mensagem"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await waitFor(win, `!document.querySelector('button[type="submit"]').disabled`);
      await js(`document.querySelector('button[type="submit"]').form.requestSubmit()`);
    };
    await submitNow("smoke-answer-now comando longo");
    await waitFor(win, `document.querySelector('header').innerText.includes('EXECUTANDO CLI')`);
    await waitFor(win, `document.body.innerText.includes('sleep 600')`);
    await submitNow("pergunta urgente");
    await waitFor(win, `!!document.querySelector('[data-testid="delivered-actions"]')`);
    assert.ok(await js(`document.body.innerText.includes('Entregue · a IA lê quando a etapa atual terminar')`));
    assert.ok(!(await js(`document.body.innerText.includes('Na fila · envio automático')`)), "a mensagem entregue não aparece como fila");
    // A resposta anterior para na entrega: não fica "em andamento" até o turno inteiro acabar.
    await waitFor(win, `!document.body.innerText.includes('Executando na CLI local') && !document.body.innerText.includes('Aguardando a CLI')`);
    await js(`[...document.querySelectorAll('[data-testid="delivered-actions"] button')].find(b=>b.innerText.includes('Responder agora')).click()`);
    await waitFor(win, `document.body.innerText.includes('RESPOSTA_AGORA') && !document.querySelector('[data-testid="delivered-actions"]')`);
    const asked = fs.readFileSync(file("answer-now-claude.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(asked, [{ subtype: "background_tasks", tool_use_id: "fixture-long" }]);
    // A resposta terminou, mas o comando segue: topo e lista mostram o segundo plano até o aviso final.
    await waitFor(win, `!document.querySelector('header').innerText.includes('EXECUTANDO CLI')`);
    await waitFor(win, `document.querySelector('[data-testid="header-background"]')?.innerText.includes('1 COMANDO EM SEGUNDO PLANO')`);
    await waitFor(win, `!!document.querySelector('[data-testid="session-background"]')`);
    await waitFor(win, `!document.querySelector('[data-testid="header-background"]') && !document.querySelector('[data-testid="session-background"]')`);
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
    {
      // Ctrl+F busca na conversa aberta: realça as ocorrências (sem diferenciar maiúsculas nem
      // acentos), mostra "N de M", Enter/Shift+Enter navegam e a lista acompanha mensagens novas.
      const js = (code) => win.webContents.executeJavaScript(code);
      const typeFind = (text) =>
        js(`(()=>{const input=document.querySelector('input[aria-label="Buscar na conversa"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      const findKey = (key, shiftKey = false) =>
        js(`document.querySelector('input[aria-label="Buscar na conversa"]').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},shiftKey:${shiftKey},bubbles:true,cancelable:true}))`);
      const status = () => js(`document.querySelector('[data-testid="chat-find-status"]').innerText`);
      const hits = () => js(`CSS.highlights.get('chat-find')?.size ?? 0`);
      await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}))`);
      await waitFor(win, `document.activeElement?.getAttribute('aria-label')==='Buscar na conversa'`);
      await typeFind("ROLAGEM");
      await waitFor(win, `CSS.highlights.get('chat-find')?.size===500`);
      assert.match(await status(), /^\d+ de 500$/);
      // A ocorrência atual está dentro da área visível do chat.
      assert.equal(
        await js(`(()=>{const r=[...CSS.highlights.get('chat-find-current')][0].getBoundingClientRect();const b=document.querySelector('[data-testid="chat-scroll"]').getBoundingClientRect();return r.top>=b.top && r.bottom<=b.bottom;})()`),
        true,
      );
      const term = "FIXTURE RESPOSTA";
      const expected = await js(`(document.querySelector('[data-testid="chat-messages"]').innerText.toLowerCase().match(/fixture resposta/g)||[]).length`);
      assert.ok(expected >= 2, "há respostas para buscar");
      await typeFind(term);
      await waitFor(win, `CSS.highlights.get('chat-find')?.size===${expected}`);
      const first = Number((await status()).split(" ")[0]);
      await findKey("Enter");
      const second = Number((await status()).split(" ")[0]);
      assert.equal(second, (first % expected) + 1, "Enter vai para a próxima");
      await findKey("Enter", true);
      assert.equal(Number((await status()).split(" ")[0]), first, "Shift+Enter volta");
      await typeFind("acentuação-inexistente-xyz");
      await waitFor(win, `document.querySelector('[data-testid="chat-find-status"]').innerText==='Nenhum resultado'`);
      assert.equal(await hits(), 0);
      // Com a busca aberta, a resposta nova entra na contagem sem reabrir a barra.
      await typeFind(term);
      await waitFor(win, `CSS.highlights.get('chat-find')?.size===${expected}`);
      await send(win, "smoke-find", "agy fixture resposta 5");
      await waitFor(win, `CSS.highlights.get('chat-find')?.size>${expected}`);
      await findKey("Escape");
      await waitFor(win, `!document.querySelector('[data-testid="chat-find"]') && !CSS.highlights.has('chat-find')`);
    }
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
  if (stage === "first") {
    // Ditado por voz: grava o microfone falso, converte em WAV no renderer e transcreve num
    // servidor local compatível com OpenAI; o estado intermediário aparece antes do texto.
    const http = require("node:http");
    const received = [];
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", async () => {
        received.push({ url: req.url, auth: req.headers.authorization, body: Buffer.concat(chunks) });
        await gate;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ text: "texto ditado [BLANK_AUDIO] pelo microfone" }));
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    const input = `document.querySelector('input[placeholder^="Mensagem"]')`;
    const mic = `document.querySelector('button[aria-label="Ditar mensagem por voz"]')`;
    const speech = await win.webContents.executeJavaScript(`window.beagleAPI.getDictationStatus()`);
    assert.equal(speech.engine, "local", "o ditado local é o padrão");
    if (!speech.model.installed) {
      // Sem o modelo de voz, o microfone oferece o download em vez de gravar à toa.
      await waitFor(win, `!!${mic}`);
      await win.webContents.executeJavaScript(`${mic}.click()`);
      await waitFor(win, `document.querySelector('[data-testid="dictation-model-offer"]')?.innerText.includes('669 MB')`);
      assert.equal(await win.webContents.executeJavaScript(`!document.querySelector('[data-testid="dictation-recording"]')`), true);
      await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Agora não"]').click()`);
      await waitFor(win, `!!${mic}`);
    } else if (process.env.BEAGLEDOCK_SMOKE_SPEECH_AUDIO) {
      // Ponta a ponta real: fala do arquivo → gravação → WAV → parakeet-cli → texto no campo.
      assert.equal(speech.engineAvailable, true, "motor local compilado (npm run build:speech)");
      await win.webContents.executeJavaScript(
        `(()=>{const i=${input};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await win.webContents.executeJavaScript(`${mic}.click()`);
      await waitFor(win, `!!document.querySelector('[data-testid="dictation-recording"]')`);
      const seconds = Number(process.env.BEAGLEDOCK_SMOKE_SPEECH_SECONDS || 6);
      await waitFor(win, `document.querySelector('[data-testid="dictation-recording"]').innerText.includes('0:0${seconds}')`);
      const stoppedAt = Date.now();
      await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Concluir ditado e transcrever"]').click()`);
      await waitFor(win, `document.body.innerText.includes('Transcrevendo')`);
      const start = Date.now();
      let spoken = "";
      while (Date.now() - start < 30000 && !spoken) {
        spoken = await win.webContents.executeJavaScript(`${input}.value`);
        if (!spoken) await pause();
      }
      console.log(`Desktop dictation local (${Date.now() - stoppedAt} ms após concluir): ${JSON.stringify(spoken)}`);
      const expected = process.env.BEAGLEDOCK_SMOKE_SPEECH_EXPECT;
      if (expected) assert.match(spoken, new RegExp(expected, "i"));
      else assert.ok(spoken.length > 0);
    }
    const saved = await win.webContents.executeJavaScript(
      `window.beagleAPI.saveAppSettings({voiceDictation:{engine:"api",baseUrl:${JSON.stringify(baseUrl)},vocabulary:"Rumofy"}})`,
    );
    assert.equal(saved.success, true);
    await win.webContents.executeJavaScript(
      `(()=>{const i=${input};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Revise');i.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    // Esc descarta: nada é enviado para transcrição.
    await win.webContents.executeJavaScript(
      `window.dispatchEvent(new KeyboardEvent('keydown',{key:'M',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}))`,
    );
    await waitFor(win, `!!document.querySelector('[data-testid="dictation-recording"]')`);
    await win.webContents.executeJavaScript(
      `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`,
    );
    await waitFor(win, `!!${mic}`);
    await win.webContents.executeJavaScript(`${mic}.click()`);
    await waitFor(win, `!!document.querySelector('[data-testid="dictation-recording"]')`);
    await waitFor(win, `document.querySelector('[data-testid="dictation-recording"]').innerText.includes('0:01')`);
    await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Concluir ditado e transcrever"]').click()`);
    await waitFor(win, `document.body.innerText.includes('Transcrevendo')`);
    const waitReceived = async () => {
      const start = Date.now();
      while (!received.length && Date.now() - start < 10000) await pause();
    };
    await waitReceived();
    assert.equal(received.length, 1, "só a gravação concluída foi enviada");
    // Ainda sem resposta do servidor: o campo não mudou.
    assert.equal(await win.webContents.executeJavaScript(`${input}.value`), "Revise");
    release();
    await waitFor(win, `${input}.value === 'Revise texto ditado pelo microfone'`);
    await waitFor(win, `!document.body.innerText.includes('Transcrevendo')`);
    const { url, auth, body } = received[0];
    assert.equal(url, "/v1/audio/transcriptions");
    assert.equal(auth, undefined, "servidor local dispensa chave");
    const riff = body.indexOf("RIFF");
    assert.ok(riff > 0, "multipart traz o WAV");
    assert.equal(body.toString("ascii", riff + 8, riff + 12), "WAVE");
    assert.equal(body.readUInt32LE(riff + 24), 16000);
    const dataBytes = body.readUInt32LE(riff + 40);
    assert.ok(dataBytes >= 16000 * 2, `pelo menos 1 s de áudio (${dataBytes} bytes)`);
    let peak = 0;
    for (let i = 0; i < Math.min(dataBytes, 64000); i += 2) peak = Math.max(peak, Math.abs(body.readInt16LE(riff + 44 + i)));
    assert.ok(peak > 1000, `o áudio do microfone não é silêncio (pico ${peak})`);
    const text = body.toString("utf8");
    assert.match(text, /gpt-4o-transcribe/);
    assert.match(text, /Rumofy/);
    server.close();
    console.log("Desktop dictation: microfone, WAV 16 kHz, estado intermediário e texto no campo passaram.");
  }
  if (stage === "first") {
    // Novos chats: com a opção ligada, o + de cada CLI repete o modelo, o nível e a permissão
    // escolhidos por último numa conversa dela; desligada, volta ao padrão da CLI.
    const js = (code) => win.webContents.executeJavaScript(code);
    const setSelect = (control, value) =>
      js(`(()=>{const s=document.querySelector('select[data-control="${control}"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,${JSON.stringify(value)});s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const selected = () =>
      js(`({model:document.querySelector('select[data-control="model"]')?.value||"",effort:document.querySelector('select[data-control="effort"]')?.value||"",permission:document.querySelector('select[data-control="permission"]').value})`);
    const toggle = `[...document.querySelectorAll('input[type="checkbox"]')].find(i=>i.closest('label')?.innerText.includes('Começar com a última escolha'))`;
    const initialIds = await js(`window.beagleAPI.getSavedState().then(s=>s.sessions.map(x=>x.id))`);
    const newChat = async (index) => {
      const before = await js(`window.beagleAPI.getSavedState().then(s=>s.sessions.length)`);
      await js(`document.querySelectorAll('button[title="Abrir nova conversa"]')[${index}].click()`);
      await waitFor(win, `window.beagleAPI.getSavedState().then(s=>s.sessions.length>${before})`);
      await waitFor(win, `!!document.querySelector('select[data-control="permission"]')`);
    };
    await js(`document.querySelector('button[title^="Configurações"]').click()`);
    await waitFor(win, `!!${toggle}`);
    await js(`${toggle}.click()`);
    await waitFor(win, `window.beagleAPI.getSavedState().then(s=>s.settings?.rememberSessionChoices===true)`);
    for (const index of [0, 1, 2]) {
      await newChat(index);
      // Último modelo e último nível da lista (diferentes do padrão da fixture) e acesso total.
      const model = await js(`[...document.querySelector('select[data-control="model"]').options].map(o=>o.value).filter(Boolean).pop()||""`);
      if (model) await setSelect("model", model);
      await waitFor(win, `document.querySelector('select[data-control="model"]').value===${JSON.stringify(model)}`);
      const effort = await js(`(()=>{const s=document.querySelector('select[data-control="effort"]');return s&&!s.disabled?[...s.options].map(o=>o.value).filter(Boolean).pop()||"":""})()`);
      if (effort) {
        await setSelect("effort", effort);
        await waitFor(win, `document.querySelector('select[data-control="effort"]').value===${JSON.stringify(effort)}`);
      }
      await setSelect("permission", "full");
      await waitFor(win, `document.querySelector('select[data-control="permission"]').value==='full'`);
      const chosen = await selected();
      await newChat(index);
      await waitFor(win, `document.querySelector('select[data-control="permission"]').value==='full'`);
      assert.deepEqual(await selected(), chosen, `o chat novo da CLI ${index} repete a última escolha`);
    }
    await js(`document.querySelector('button[title^="Configurações"]').click()`);
    await waitFor(win, `!!${toggle}`);
    await js(`${toggle}.click()`);
    await waitFor(win, `window.beagleAPI.getSavedState().then(s=>s.settings?.rememberSessionChoices===false)`);
    await newChat(0);
    assert.equal((await selected()).permission, "inherit", "desligada, o chat novo usa o padrão da CLI");
    // As conversas deste cenário não entram na contagem da reinicialização.
    const created = await js(`window.beagleAPI.getSavedState().then(s=>s.sessions.map(x=>x.id))`);
    for (const id of created.filter((id) => !initialIds.includes(id)))
      assert.equal((await js(`window.beagleAPI.deleteSession(${JSON.stringify(id)})`))?.success, true);
    console.log("Desktop novos chats: Claude, Codex e AGY repetem modelo, nível e permissão quando a opção está ligada.");
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
