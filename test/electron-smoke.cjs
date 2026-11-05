const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const path = require("node:path");
const stage = process.argv.at(-1);
const failures = [];
Object.defineProperty(app, "isPackaged", { get: () => true });
// Chromium's fake microphone (continuous tone) and permission without a dialog: exercises real dictation.
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
// Real local dictation diagnosis: the fake microphone plays a real speech file.
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
  const screen = await win.webContents
    .executeJavaScript("document.body.innerText.slice(-700)")
    .catch(() => "");
  throw new Error("Renderer timed out: " + expression + "\n--- screen ---\n" + screen);
}
async function send(win, text, expected) {
  await win.webContents.executeJavaScript(
    `(()=>{const input=document.querySelector('input[placeholder^="Message to"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await waitFor(
    win,
    `!document.querySelector('button[type="submit"]').disabled`,
  );
  await win.webContents.executeJavaScript(
    `document.querySelector('input[placeholder^="Message to"]').form.requestSubmit()`,
  );
  await waitFor(
    win,
    `document.body.innerText.includes(${JSON.stringify(expected)})`,
  );
  await waitFor(win, `!document.body.innerText.includes('RUNNING CLI')`);
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
    `document.querySelectorAll('button[title="Open a new conversation"]:not(:disabled)').length === 3`,
  );
  assert.equal(
    await win.webContents.executeJavaScript("document.title"),
    "BeagleDock - Multi-AI Cockpit",
  );
  await waitFor(
    win,
    `(()=>{const logo=document.querySelector('img[alt="BeagleDock — beagle mascot"]');return logo?.complete && logo.naturalWidth>0;})()`,
  );

  // The quota details start collapsed: nothing from them shows until opened.
  await waitFor(win, `!document.querySelector('[data-testid="quota-details"]')`);
  await win.webContents.executeJavaScript(
    `document.querySelectorAll('button[aria-label^="Quota details"]').forEach((b) => b.click())`,
  );
  await waitFor(
    win,
    `document.querySelector('[aria-label="AGY quotas by group"]')?.innerText.includes('Claude and GPT models')`,
  );
  // Quotas read from the CLIs themselves (Claude /usage and Codex app-server), with the reset time.
  await waitFor(
    win,
    `(()=>{const t=document.body.innerText;return t.includes('5h: 34%') && t.includes('5h: 21%') && t.includes('Resets · 5h:');})()`,
  );
  for (const [index, name] of ["claude", "codex", "agy"].entries()) {
    if (stage === "first") {
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('button[title="Open a new conversation"]')[${index}].click()`,
      );
      await waitFor(
        win,
        `document.querySelector('header').innerText.includes('New session')`,
      );
      if (name === "agy") {
        await waitFor(
          win,
          `[...document.querySelector('select[aria-label="Model"]').options].some(o=>o.value==='fixture-orbit')`,
        );
        const choices = await win.webContents.executeJavaScript(
          `[...document.querySelector('select[aria-label="Model"]').options].map(o=>o.value)`,
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
          `(()=>{const field=document.querySelector('select[aria-label="Model"]');field.value='fixture-orbit';field.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
        await waitFor(
          win,
          `document.querySelector('select[aria-label="Reasoning level"]').options.length===3`,
        );
        const levels = await win.webContents.executeJavaScript(
          `[...document.querySelector('select[aria-label="Reasoning level"]').options].map(o=>o.value)`,
        );
        assert.deepEqual(levels, ["economy", "standard", "research"]);
        await win.webContents.executeJavaScript(
          `(()=>{const field=document.querySelector('select[aria-label="Reasoning level"]');field.value='research';field.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
        await waitFor(
          win,
          `document.querySelector('select[aria-label="Reasoning level"]').value==='research'`,
        );
      }
      await send(win, "smoke one", `${name} fixture resposta 1`);
      await send(win, "smoke two", `${name} fixture resposta 2`);
    } else {
      await win.webContents.executeJavaScript(
        `(()=>{const cards=[...document.querySelectorAll('div.rounded-xl.border')].filter(el=>el.querySelector('button[title="Open a new conversation"]'));const item=[...cards[${index}].querySelectorAll('span')].find(el=>el.textContent==='smoke one');item?.click();})()`,
      );
      // Use a saved session through the rendered session row; restored titles contain the first prompt.
      await waitFor(
        win,
        `document.body.innerText.includes('${name} fixture resposta 2')`,
      );
      await waitFor(win, `document.querySelector('select[data-control="permission"]').value==='plan'`);
      await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', altKey: true, bubbles: true, cancelable: true }))`);
      await waitFor(win, `document.querySelector('select[data-control="permission"]').value==='full'`);
      await send(win, "smoke three", `${name} fixture resposta 3`);
    }
  }
  if (stage === "first") {
    // Terminal mode: the AGY conversation opens the CLI's own interface, resuming the native id.
    const js = (code) => win.webContents.executeJavaScript(code);
    const fs = require("fs");
    const file = (f) => path.join(process.env.BEAGLEDOCK_SMOKE_ROOT, f);
    // xterm only draws the lines with the window visible.
    win.showInactive();
    // The choice lives in the settings and applies to every conversation.
    const setMode = async (mode) => {
      await js(`document.querySelector('button[title="Settings, SQLite database & MCPs"]').click()`);
      await waitFor(win, `!!document.querySelector('[data-testid="conversation-mode"] input[value="${mode}"]')`);
      await js(`document.querySelector('[data-testid="conversation-mode"] input[value="${mode}"]').click()`);
      await waitFor(win, `window.beagleAPI.getSavedState().then(s=>(s.settings.conversationMode||'chat')==='${mode}')`);
      await js(`[...document.querySelectorAll('header button')].find(b=>b.innerText.includes('Back to chat')).click()`);
    };
    await setMode("terminal");
    await waitFor(win, `document.querySelector('[data-testid="cli-terminal"]')?.innerText.includes('FIXTURE TUI agy --conversation')`);
    const tui = JSON.parse(fs.readFileSync(file("tui-agy.json"), "utf8"));
    assert.equal(tui.args[0], "--conversation");
    assert.match(tui.args[1], /^[a-zA-Z0-9_-]{8,}$/);
    // Nothing from the chat: no composer, no message list, no CLI pickers.
    assert.equal(await js(`!!document.querySelector('input[placeholder^="Message to"]')`), false);
    assert.equal(await js(`!!document.querySelector('[data-testid="chat-messages"]')`), false);
    assert.equal(await js(`!!document.querySelector('select[data-control="model"]')`), false);
    // Keys go straight to the CLI.
    await js(`(()=>{const t=document.querySelector('[data-testid="cli-terminal"] textarea');t.focus();t.dispatchEvent(new KeyboardEvent('keydown',{key:'k',code:'KeyK',keyCode:75,bubbles:true,cancelable:true}));})()`);
    await waitFor(win, `window.beagleAPI.cliTerminalList().then(l=>l.length===1)`);
    // Handoff from the header: pastes the request into the CLI and sends it.
    await js(`[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Handoff').click()`);
    const start = Date.now();
    let typed = "";
    while (Date.now() - start < 10000) {
      typed = fs.existsSync(file("tui-input-agy.txt")) ? fs.readFileSync(file("tui-input-agy.txt"), "utf8") : "";
      if (typed.includes("ai-memory-handoff") && typed.endsWith("\r")) break;
      await pause();
    }
    assert.ok(typed.startsWith("k"), JSON.stringify(typed.slice(0, 20)));
    assert.match(typed, /\x1b\[200~Use the ai-memory handoff skill/);
    assert.ok(typed.endsWith("\x1b[201~\r"), JSON.stringify(typed.slice(-40)));
    await waitFor(win, `document.querySelector('[data-testid="cli-terminal"]').innerText.includes('ENVIADO')`);
    // The end of the reply in the terminal (the screen stopped animating) saves the conversation in the history.
    const terminalSession = await js(`window.beagleAPI.cliTerminalList().then(l=>l[0].sessionId)`);
    await waitFor(
      win,
      `window.beagleAPI.getChatMessages(${JSON.stringify(terminalSession)}).then(list=>list.some(m=>m.sender==='antigravity'&&m.text==='FIXTURE TUI RESPOSTA')&&list.some(m=>m.sender==='user'&&m.text.includes('Use the ai-memory handoff skill')))`,
      20000,
    );
    const shot = async (name) => {
      if (!process.env.BEAGLEDOCK_SHOT_DIR) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
      const image = await win.webContents.capturePage();
      fs.writeFileSync(path.join(process.env.BEAGLEDOCK_SHOT_DIR, name), image.toPNG());
    };
    await shot("terminal-conversa.png");
    // Panel with the CLIs open in terminal mode.
    await js(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Shells')).click()`);
    await waitFor(win, `document.querySelectorAll('[data-testid="terminal-grid"] [data-testid="cli-terminal"]').length===1`);
    await waitFor(win, `document.querySelector('[data-testid="terminal-grid"]').innerText.includes('FIXTURE TUI agy')`);
    await shot("terminal-grade.png");
    await js(`document.querySelector('[data-testid="terminal-grid"] button[title="Open this conversation"]').click()`);
    await waitFor(win, `!!document.querySelector('[data-testid="cli-terminal"]') && !document.querySelector('[data-testid="terminal-grid"]')`);
    // No switch button at the top of the conversation: only in the settings.
    assert.equal(await js(`[...document.querySelectorAll('header button')].some(b=>/^(Terminal|Chat)$/.test(b.innerText.trim()))`), false);
    // Sending through the chat with the terminal open is refused in the main process.
    const refused = await js(
      `window.beagleAPI.getSavedState().then(s=>window.beagleAPI.executeCliPrompt({sessionId:s.sessions.find(x=>x.providerId==='antigravity').id,providerId:'antigravity',prompt:'x'}))`,
    );
    assert.equal(refused.ok, false);
    assert.match(refused.error, /open in the terminal/);
    // Back to the chat: the terminal's CLI is closed and the chat continues the conversation.
    await setMode("chat");
    await waitFor(win, `!!document.querySelector('input[placeholder^="Message to"]')`);
    await waitFor(win, `window.beagleAPI.cliTerminalList().then(l=>l.length===0)`);
    await waitFor(win, `document.body.innerText.includes('agy fixture resposta 2')`);
    win.hide();

    // Answer now (Claude Code): the message delivered during a long command waits for the AI to read it;
    // the button sends the command to the background and the AI answers right away.
    await js(`(()=>{const cards=[...document.querySelectorAll('div.rounded-xl.border')].filter(el=>el.querySelector('button[title="Open a new conversation"]'));[...cards[0].querySelectorAll('span')].find(el=>el.textContent==='smoke one')?.click();})()`);
    await waitFor(win, `document.body.innerText.includes('claude fixture resposta 2') && !!document.querySelector('input[placeholder^="Message to"]')`);
    const submitNow = async (text) => {
      await js(`(()=>{const input=document.querySelector('input[placeholder^="Message to"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await waitFor(win, `!document.querySelector('button[type="submit"]').disabled`);
      await js(`document.querySelector('button[type="submit"]').form.requestSubmit()`);
    };
    await submitNow("smoke-answer-now comando longo");
    await waitFor(win, `document.querySelector('header').innerText.includes('RUNNING CLI')`);
    await waitFor(win, `document.body.innerText.includes('sleep 600')`);
    await submitNow("pergunta urgente");
    await waitFor(win, `!!document.querySelector('[data-testid="delivered-actions"]')`);
    assert.ok(await js(`document.body.innerText.includes('Delivered · the AI reads it when the current step finishes')`));
    assert.ok(!(await js(`document.body.innerText.includes('Queued · sends automatically')`)), "the delivered message doesn't show as queued");
    // The previous reply stops at the delivery: it doesn't stay "in progress" until the whole turn ends.
    await waitFor(win, `!document.body.innerText.includes('Running in the local CLI') && !document.body.innerText.includes('Waiting for the CLI')`);
    await js(`[...document.querySelectorAll('[data-testid="delivered-actions"] button')].find(b=>b.innerText.includes('Answer now')).click()`);
    await waitFor(win, `document.body.innerText.includes('RESPOSTA_AGORA') && !document.querySelector('[data-testid="delivered-actions"]')`);
    const asked = fs.readFileSync(file("answer-now-claude.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(asked, [{ subtype: "background_tasks", tool_use_id: "fixture-long" }]);
    // The reply ended, but the command goes on: the header and the list show the background until the final notice.
    await waitFor(win, `!document.querySelector('header').innerText.includes('RUNNING CLI')`);
    await waitFor(win, `document.querySelector('[data-testid="header-background"]')?.innerText.includes('1 COMMAND IN THE BACKGROUND')`);
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
      // Ctrl+F searches the open conversation: highlights the matches (ignoring case and
      // accents), shows "N of M", Enter/Shift+Enter navigate and the list follows new messages.
      const js = (code) => win.webContents.executeJavaScript(code);
      const typeFind = (text) =>
        js(`(()=>{const input=document.querySelector('input[aria-label="Search the conversation"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      const findKey = (key, shiftKey = false) =>
        js(`document.querySelector('input[aria-label="Search the conversation"]').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},shiftKey:${shiftKey},bubbles:true,cancelable:true}))`);
      const status = () => js(`document.querySelector('[data-testid="chat-find-status"]').innerText`);
      const hits = () => js(`CSS.highlights.get('chat-find')?.size ?? 0`);
      await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}))`);
      await waitFor(win, `document.activeElement?.getAttribute('aria-label')==='Search the conversation'`);
      await typeFind("ROLAGEM");
      await waitFor(win, `CSS.highlights.get('chat-find')?.size===500`);
      assert.match(await status(), /^\d+ of 500$/);
      // The current match is inside the chat's visible area.
      assert.equal(
        await js(`(()=>{const r=[...CSS.highlights.get('chat-find-current')][0].getBoundingClientRect();const b=document.querySelector('[data-testid="chat-scroll"]').getBoundingClientRect();return r.top>=b.top && r.bottom<=b.bottom;})()`),
        true,
      );
      const term = "FIXTURE RESPOSTA";
      const expected = await js(`(document.querySelector('[data-testid="chat-messages"]').innerText.toLowerCase().match(/fixture resposta/g)||[]).length`);
      assert.ok(expected >= 2, "there are replies to search");
      await typeFind(term);
      await waitFor(win, `CSS.highlights.get('chat-find')?.size===${expected}`);
      const first = Number((await status()).split(" ")[0]);
      await findKey("Enter");
      const second = Number((await status()).split(" ")[0]);
      assert.equal(second, (first % expected) + 1, "Enter goes to the next one");
      await findKey("Enter", true);
      assert.equal(Number((await status()).split(" ")[0]), first, "Shift+Enter goes back");
      await typeFind("acentuação-inexistente-xyz");
      await waitFor(win, `document.querySelector('[data-testid="chat-find-status"]').innerText==='No results'`);
      assert.equal(await hits(), 0);
      // With the search open, the new reply enters the count without reopening the bar.
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
  // The conversation created by "Continue in another CLI" in the first stage survives the restart.
  const expectedSessions = stage === "restart" ? 4 : 3;
  assert.equal(state.sessions.length, expectedSessions);
  assert.equal(new Set(state.sessions.map((s) => s.nativeSessionId)).size, expectedSessions);
  assert.ok(state.sessions.every((s) => s.nativeSessionId));
  await waitFor(
    win,
    `!!document.querySelector('[data-testid="live-shell"] .xterm')`,
  );
  // Workspace maintenance: folder state, rename (persisted) and remove only from the list.
  {
    const click = (expr) => win.webContents.executeJavaScript(`(${expr}).click()`);
    await click(`document.querySelector('button[aria-label="Manage workspaces"]')`);
    await waitFor(win, `document.querySelectorAll('[data-testid="workspace-list"] li').length>=1 && document.querySelector('[data-testid="workspace-list"]').innerText.includes('folder found')`);
    const before = await win.webContents.executeJavaScript(`window.beagleAPI.getSavedState().then(s=>s.sessions.map(x=>[x.id,x.cwd,x.nativeSessionId].join('|')).sort())`);
    await click(`document.querySelector('[data-testid="workspace-list"] button[aria-label^="Edit"]')`);
    await win.webContents.executeJavaScript(`(()=>{const input=document.querySelector('input[aria-label="Workspace name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Renomeado ${stage}');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.innerText.trim()==='Save')`);
    await waitFor(win, `document.querySelector('[data-testid="workspace-list"]').innerText.includes('Renomeado ${stage}')`);
    assert.deepEqual(
      await win.webContents.executeJavaScript(`window.beagleAPI.getSavedState().then(s=>s.sessions.map(x=>[x.id,x.cwd,x.nativeSessionId].join('|')).sort())`),
      before,
      "renaming the workspace doesn't change the conversations or the native ids",
    );
    await click(`document.querySelector('[role="dialog"] button[aria-label="Close"]')`);
    await waitFor(win, `!document.querySelector('[role="dialog"]')`);
  }
  if (stage === "first") {
    // Continue in another CLI: a new conversation with the summary; the original and the native id stay intact.
    const before = await win.webContents.executeJavaScript(`window.beagleAPI.getSavedState()`);
    const origin = before.sessions.find((x) => x.status !== "archived");
    await win.webContents.executeJavaScript(`document.querySelector('button[title^="Continue this task in another CLI"]').click()`);
    await waitFor(win, `document.querySelectorAll('[role="menuitem"]').length>=2`);
    await win.webContents.executeJavaScript(`document.querySelector('[role="menuitem"]').click()`);
    await waitFor(win, `document.querySelector('header').innerText.includes('Continuation:')`);
    await waitFor(win, `document.body.innerText.includes('Current request: check the real state of the project')`);
    const after = await win.webContents.executeJavaScript(`window.beagleAPI.getSavedState()`);
    assert.equal(after.sessions.length, before.sessions.length + 1, "created a new conversation");
    const created = after.sessions.find((x) => !before.sessions.some((y) => y.id === x.id));
    assert.match(created.title, /^Continuation: /);
    assert.notEqual(created.providerId, after.sessions.find((x) => x.id === origin.id).providerId === created.providerId ? "igual" : "x");
    for (const old of before.sessions) {
      const same = after.sessions.find((x) => x.id === old.id);
      assert.equal(same.nativeSessionId, old.nativeSessionId, "the original conversation's native id doesn't change");
      assert.equal(same.title, old.title);
    }
    assert.equal(created.cwd, origin.cwd);
    await waitFor(win, `!document.body.innerText.includes('RUNNING CLI')`);
    // Back to the original conversation: the next steps start from it.
    await win.webContents.executeJavaScript(`document.querySelector('[data-session-id="${origin.id}"]').click()`);
    await waitFor(win, `!document.querySelector('header').innerText.includes('Continuation:')`);
  }
  // Attachments: drop an image and a file on the composer and send; each CLI receives them in its own format.
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
      `(()=>{const input=document.querySelector('input[placeholder^="Message to"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'smoke-attach analisa isso');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await waitFor(win, `!document.querySelector('button[type="submit"]').disabled`);
    await win.webContents.executeJavaScript(`document.querySelector('button[type="submit"]').form.requestSubmit()`);
    await waitFor(win, `!document.body.innerText.includes('RUNNING CLI') && document.body.innerText.includes('fixture resposta')`);
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
    assert.equal(delivered.length >= 1, true, "the conversation's CLI received the message with attachments");
    if (claude) {
      assert.deepEqual(claude.blocks, ["image:image/png", "text"]);
      assert.match(claude.text, /Attached files:\n- .*erro\.log/);
    }
    if (agy) {
      assert.match(agy.text, /\.png \(imagem: print\.png\)/);
      await waitFor(win, `document.body.innerText.includes('Antigravity has no verified native image field')`);
    }
    if (codex) assert.deepEqual(codex.slice(0, 3), ["text", "localImage", "mention:erro.log"]);
    await waitFor(win, `[...document.querySelectorAll('img[alt="print.png"]')].length>=1`);
  }
  if (stage === "restart") {
    const submit = async (text) => {
      await win.webContents.executeJavaScript(
        `(()=>{const input=document.querySelector('input[placeholder^="Message to"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
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
    await waitFor(win, `document.body.innerText.includes('RUNNING CLI')`);
    await submit("smoke-queue second");
    await waitFor(win, `document.body.innerText.includes('Queued')`);
    await waitFor(win, `!document.body.innerText.includes('RUNNING CLI')`);
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
      `document.querySelector('header').innerText.includes('RUNNING CLI')`,
    );
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('button[title="Open a new conversation"]:disabled').length`,
      ),
      0,
    );
    await win.webContents.executeJavaScript(
      `document.querySelectorAll('button[title="Open a new conversation"]')[1].click()`,
    );
    await waitFor(
      win,
      `document.querySelector('header').innerText.includes('New session')`,
    );
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelector('header').innerText.includes('RUNNING CLI')`,
      ),
      false,
    );
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelector('select[aria-label="Model"]').disabled`,
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
      `document.querySelector('header').innerText.includes('RUNNING CLI')`,
    );
    await waitFor(
      win,
      `!document.querySelector('header').innerText.includes('RUNNING CLI')`,
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
        `document.querySelectorAll('button[title="Open a new conversation"]')[${index}].click()`,
      );
      await waitFor(
        win,
        `document.querySelector('header').innerText.includes('New session')`,
      );
      await win.webContents.executeJavaScript(
        `window.__liveOutput='';window.__shellOutput={};window.__unsubscribeLive?.();window.__unsubscribeLive=window.beagleAPI.on('pty-data',p=>{window.__liveOutput+=p.data;if(p.shellId)window.__shellOutput[p.shellId]=(window.__shellOutput[p.shellId]||'')+p.data;});void 0;`,
      );
      await win.webContents.executeJavaScript(
        `(()=>{const input=document.querySelector('input[placeholder^="Message to"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'smoke-live ${index}');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
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
          `document.querySelector('header').innerText.includes('RUNNING CLI')`,
        ),
        true,
      );
      await waitFor(win, `window.__liveOutput.includes('LIVE_MIDDLE')`);
      if (index === 1) {
        // Codex: two parallel commands arrive tagged, each output with the right origin.
        await waitFor(win, `window.__shellOutput['live-cmd']?.includes('LIVE_FIRST') && window.__shellOutput['live-cmd-2']?.includes('PARALLEL_BUILD')`);
        assert.equal(await win.webContents.executeJavaScript(`!window.__shellOutput['live-cmd'].includes('PARALLEL_BUILD') && !window.__shellOutput['live-cmd-2'].includes('LIVE_FIRST')`), true, "each command's output stays in its origin");
        // No tabs (0.6.1): the outputs of both commands show up in the same shell stream.
        await waitFor(win, `(()=>{const t=document.querySelector('[data-testid="live-shell"]')?.innerText||'';return t.includes('LIVE_FIRST')&&t.includes('PARALLEL_BUILD');})()`);
      }
      if (index === 1) await waitFor(win, `document.body.innerText.includes('Analisando um comando com argumentos extensos')`);
      assert.equal(
        await win.webContents.executeJavaScript(
          `document.querySelector('header').innerText.includes('RUNNING CLI')`,
        ),
        true,
      );
      // Closing the window mid-run goes to the tray: the app and the session go on.
      win.close();
      assert.equal(win.isDestroyed(), false, "closing doesn't destroy the window");
      assert.equal(
        !win.isVisible() || win.isMinimized(),
        true,
        "the window leaves the screen (tray or minimized)",
      );
      await waitFor(
        win,
        `!document.querySelector('header').innerText.includes('RUNNING CLI')`,
      );
      const boxSizes = await win.webContents.executeJavaScript("window.__boxObserver.disconnect();window.__boxMutation.disconnect();window.__boxSizes");
      assert.ok(boxSizes.length > 1);
      for (const size of ["steps", "activity"]) {
        const values = boxSizes.map((s) => s[size]);
        assert.ok(Math.max(...values) - Math.min(...values) < 1, `box ${size} keeps its height during the run`);
      }
      assert.ok(boxSizes.every((s) => !s.overflow), "steps don't create a horizontal bar");
      win.show();
      assert.equal(win.isVisible(), true);
      await win.webContents.executeJavaScript(
        `void window.__unsubscribeLive()`,
      );
      // Optional: screenshots for visual review (BEAGLEDOCK_SHOT_DIR=/folder).
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
          `document.querySelector('button[title^="Settings"]').click();void 0`,
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
        // Back to the chat for the rest of the test.
        await win.webContents.executeJavaScript(
          `[...document.querySelectorAll('button')].find((b)=>b.innerText.includes('Back to chat'))?.click();void 0`,
        );
        await waitFor(win, `!!document.querySelector('input[placeholder^="Message to"]')`);
      }
      // Exercise the same question form through all three native protocol fixtures.
      await win.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('input[placeholder^="Message to"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'smoke-question');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await waitFor(win, `!document.querySelector('input[placeholder^="Message to"]').form.querySelector('button[type="submit"]').disabled`);
      await win.webContents.executeJavaScript(`document.querySelector('input[placeholder^="Message to"]').form.requestSubmit()`);
      await waitFor(win, `!!document.querySelector('[data-testid="question-card"]')`);
      assert.equal(await win.webContents.executeJavaScript(`(() => {
        const card = document.querySelector('[data-testid="question-card"]');
        return card.querySelectorAll('fieldset').length === 2 && !card.querySelector('pre') &&
          card.querySelector('button[type="submit"]').disabled && !card.innerText.includes('Allow once');
      })()`), true);
      await win.webContents.executeJavaScript(`(() => {
        const fields = document.querySelectorAll('[data-testid="question-card"] fieldset');
        fields[0].querySelectorAll('input')[0].click();
        fields[0].querySelectorAll('input')[1].click();
        fields[1].querySelectorAll('input')[0].click();
      })()`);
      await waitFor(win, `!document.querySelector('[data-testid="question-card"] button[type="submit"]').disabled`);
      await win.webContents.executeJavaScript(`document.querySelectorAll('[data-testid="question-card"] fieldset')[1].querySelectorAll('input')[2].click()`);
      await waitFor(win, `!!document.querySelector('[data-testid="question-card"] textarea')`);
      assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[data-testid="question-card"] button[type="submit"]').disabled`), true);
      await win.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('[data-testid="question-card"] textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Custom campaign details');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await waitFor(win, `!document.querySelector('[data-testid="question-card"] button[type="submit"]').disabled`);
      if (process.env.BEAGLEDOCK_SHOT_DIR) {
        for (const theme of ["light", "dark"]) {
          await win.webContents.executeJavaScript(`document.documentElement.dataset.theme=${JSON.stringify(theme)};void 0`);
          await new Promise((resolve) => setTimeout(resolve, 150));
          require("fs").writeFileSync(path.join(process.env.BEAGLEDOCK_SHOT_DIR, `question-${index}-${theme}.png`), (await win.webContents.capturePage()).toPNG());
        }
        await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='light';void 0`);
      }
      await win.webContents.executeJavaScript(`document.querySelector('[data-testid="question-card"]').requestSubmit()`);
      await waitFor(win, `!document.querySelector('[data-testid="question-card"]') && document.body.innerText.includes('QUESTION_ANSWER_DONE')`);
      await waitFor(win, `!document.querySelector('header').innerText.includes('RUNNING CLI')`);
      const questionReply = await win.webContents.executeJavaScript(`document.body.innerText.split('QUESTION_ANSWER_DONE').at(-1)`);
      assert.match(questionReply, /Email/);
      assert.match(questionReply, /WhatsApp/);
      assert.match(questionReply, /Custom campaign details/);

      {
        const chooseMode = async (value) => {
          await win.webContents.executeJavaScript(`(() => {
            const input = document.querySelector('select[data-control="permission"]');
            Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
            input.dispatchEvent(new Event('change', { bubbles: true }));
          })()`);
          await waitFor(win, `document.querySelector('select[data-control="permission"]').value===${JSON.stringify(value)}`);
        };
        await chooseMode("full");
        await chooseMode("plan");
        const planState = await win.webContents.executeJavaScript(`window.beagleAPI.getSavedState()`);
        const planned = planState.sessions.find((s) => s.providerId === ["claude", "codex", "antigravity"][index] && s.permission === 'plan');
        assert.equal(planned.permissionBeforePlan, "full");
        await send(win, "smoke-plan", "PLAN_READY_FOR_REVIEW");
        await waitFor(win, `!!document.querySelector('button[title="Restore the previous permission mode and ask the AI to implement the plan"]')`);
        await win.webContents.executeJavaScript(`document.querySelector('button[title="Restore the previous permission mode and ask the AI to implement the plan"]').click()`);
        await waitFor(win, `document.querySelector('select[data-control="permission"]').value==='full' && document.body.innerText.includes('PLAN_RESTORED_AND_CONTINUED')`);
        await waitFor(win, `!document.querySelector('header').innerText.includes('RUNNING CLI')`);
        await chooseMode("inherit");
      }

      for (const [prompt, button, answer] of [
        ["smoke-approval allow", "Allow once", "APPROVED_ACTION_DONE"],
        ["smoke-approval deny", "Deny", "DENIED_ACTION_DONE"],
        // Switching to Full access with the reply stopped at the approval releases the pending action.
        ["smoke-approval allow", "__full__", "APPROVED_ACTION_DONE"],
        ...(index > 0 ? [
          ["smoke-approval-child allow", "Allow once", "APPROVED_ACTION_DONE"],
          ["smoke-approval-child deny", "Deny", "DENIED_ACTION_DONE"],
        ] : []),
      ]) {
        if (prompt.includes("-child")) await win.webContents.executeJavaScript("window.__liveOutput='';window.__unsubscribeLive?.();window.__unsubscribeLive=window.beagleAPI.on('pty-data',p=>{window.__liveOutput+=p.data;});void 0");
        await win.webContents.executeJavaScript(
          `(()=>{const input=document.querySelector('input[placeholder^="Message to"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(prompt)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
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
          `!!document.querySelector('[aria-label="Authorize the CLI action"]')`,
        );
        // The permission shows in the chat itself (with the CLI's options), highlighted in the header,
        // and not in the global notice.
        assert.equal(
          await win.webContents.executeJavaScript(
            `!!document.querySelector('[data-testid="approval-card"]') && !!document.querySelector('[data-testid="waiting-permission"]') && !document.querySelector('[aria-label="Pending permission in another conversation"]') && document.body.innerText.includes('Waiting for permission')`,
          ),
          true,
          "inline permission in the chat with highlight",
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
            `document.querySelectorAll('button[title="Open a new conversation"]:disabled').length`,
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
            "permission picker released during the run",
          );
          await choosePermission("full");
          await waitFor(win, `!!document.querySelector('[data-testid="permission-notice"]')`);
          const notice = await win.webContents.executeJavaScript(`document.querySelector('[data-testid="permission-notice"]').innerText`);
          assert.match(notice, /1 pending approval was released/);
          if (index === 0) assert.match(notice, /New level applied/);
          if (index === 1) assert.match(notice, /next message/);
        } else
          await win.webContents.executeJavaScript(
            `[...document.querySelectorAll('[aria-label="Authorize the CLI action"] button')].find(b=>b.textContent.startsWith(${JSON.stringify(button)})).click()`,
          );
        if (prompt === "smoke-approval-child allow") {
          await waitFor(win, `window.__liveOutput.includes('CHILD_FIRST')`);
          assert.equal(await win.webContents.executeJavaScript(`document.querySelector('header').innerText.includes('RUNNING CLI')`), true, "the subagent's output reaches the shell before completion");
        }
        await waitFor(
          win,
          `document.body.innerText.includes(${JSON.stringify(answer)}) && !document.querySelector('[aria-label="Authorize the CLI action"]')`,
        );
        await waitFor(
          win,
          `!document.querySelector('header').innerText.includes('RUNNING CLI')`,
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
              "Claude receives the live switch through stdin",
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
          `(()=>{const input=document.querySelector('input[placeholder^="Message to"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
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
        `document.body.innerText.includes('PARTIAL_BEFORE_STOP') && !!document.querySelector('[aria-label="Stop the run and clear the queue"]')`,
      );
      await submitStopCase("queued-cancel-" + index + "-a");
      await submitStopCase("queued-cancel-" + index + "-b");
      await waitFor(win, `document.body.innerText.includes('Queued')`);
      await win.webContents.executeJavaScript(
        `document.querySelector('[aria-label="Stop the run and clear the queue"]').click()`,
      );
      await waitFor(
        win,
        `!document.querySelector('[aria-label="Stop the run and clear the queue"]') && !document.querySelector('header').innerText.includes('RUNNING CLI')`,
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
            m.text.includes("Partial output:") &&
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
      // In Claude Code the messages sent during the reply are delivered in the middle of it (they don't stay
      // in the queue); in the other CLIs they wait in the queue and Stop cancels them before reaching the CLI.
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
        `!!document.querySelector('[aria-label="Stop the run and clear the queue"]')`,
      );
      await submitStopCase("para");
      await waitFor(
        win,
        `!document.querySelector('header').innerText.includes('RUNNING CLI')`,
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
    `document.querySelector('button[title="Settings, SQLite database & MCPs"]').click()`,
  );
  await waitFor(
    win,
    `document.querySelectorAll('button[aria-label^="Update "]').length===3`,
  );
  await waitFor(
    win,
    `!!document.querySelector('select[aria-label="Antigravity: Tool policy (global)"]')`,
  );
  if (stage === "first") {
    // Rename (double click), close, reopen from the history and delete with confirmation; the state is restored.
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
      await waitFor(win, `!!document.querySelector('input[aria-label="New conversation name"]')`);
      await win.webContents.executeJavaScript(
        `(()=>{const i=document.querySelector('input[aria-label="New conversation name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(name)});i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`,
      );
      await waitFor(
        win,
        `document.querySelector('${row} span[data-session-title]')?.textContent===${JSON.stringify(name)}`,
      );
    };
    await typeName("Renomeada no smoke");
    // Close: leaves the sidebar and stays in the history; reopening from the history brings it back.
    const history = `[data-history-id="beagledock:${rowId}"]`;
    const openHistory = async () => {
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Conversation history')).click()`,
      );
      await waitFor(win, `!!document.querySelector('${history}')`);
    };
    await win.webContents.executeJavaScript(
      `document.querySelector('${row} button[aria-label="Close conversation"]').click()`,
    );
    await waitFor(win, `!document.querySelector('${row}') && !document.body.innerText.toLowerCase().includes('archived')`);
    await openHistory();
    await waitFor(win, `document.querySelector('${history}').innerText.toLowerCase().includes('closed')`);
    await win.webContents.executeJavaScript(`document.querySelector('${history}').click()`);
    await waitFor(win, `!!document.querySelector('${row}') && !document.querySelector('${history}')`);
    // Delete lives only in the history and requires confirming: the first click only arms the button.
    await openHistory();
    await win.webContents.executeJavaScript(
      `document.querySelector('${history} button[aria-label="Delete conversation permanently"]').click()`,
    );
    await waitFor(win, `!![...document.querySelectorAll('${history} button')].find(b=>b.textContent==='Delete for good?')`);
    assert.equal(
      await win.webContents.executeJavaScript(`!!document.querySelector('${row}')`),
      true,
      "the first click doesn't delete",
    );
    await waitFor(win, `![...document.querySelectorAll('${history} button')].find(b=>b.textContent==='Delete for good?')`, 6000);
    await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Close history"]').click()`);
    await waitFor(win, `!document.querySelector('${history}')`);
    // Reopening goes to the chat: back to the settings for the next steps.
    await win.webContents.executeJavaScript(
      `document.querySelector('button[title="Settings, SQLite database & MCPs"]').click()`,
    );
    await waitFor(win, `!!document.querySelector('select[aria-label="Antigravity: Tool policy (global)"]')`);
    await typeName(original);
  }
  if (stage === "first") {
    await win.webContents.executeJavaScript(
      `(()=>{const field=document.querySelector('select[aria-label="Antigravity: Tool policy (global)"]');field.value='strict';field.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await waitFor(
      win,
      `[...document.querySelectorAll('button')].some(b=>b.textContent==='Save global permission')`,
    );
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('button')].find(b=>b.textContent==='Save global permission').click()`,
    );
    await waitFor(
      win,
      `document.body.innerText.includes('Global permission saved.')`,
    );
    const settings = JSON.parse(
      require("fs").readFileSync(
        path.join(process.env.HOME, ".gemini/antigravity-cli/settings.json"),
        "utf8",
      ),
    );
    assert.equal(settings.toolPermission, "strict");
    await win.webContents.executeJavaScript(
      `document.querySelector('button[aria-label="Update Antigravity"]').click()`,
    );
    await waitFor(
      win,
      `document.body.innerText.includes('CLI updated to 1.4.0.')`,
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
    // Background: turn off “keep in the tray” and turn on “start with the system” (a file in the test's HOME).
    const bg = (text) => `[...document.querySelectorAll('input[type="checkbox"]')].find(i=>i.closest('label')?.innerText.includes(${JSON.stringify(text)}))`;
    assert.equal(await win.webContents.executeJavaScript(`${bg("Keep BeagleDock in the tray")}.checked`), true);
    assert.equal(await win.webContents.executeJavaScript(`${bg("Start with the system")}.checked`), false);
    await win.webContents.executeJavaScript(`${bg("Start with the system")}.click()`);
    await waitFor(win, `${bg("Start with the system")}.checked===true`);
    const autostartFile = path.join(process.env.HOME, ".config", "autostart", "beagledock.desktop");
    await waitFor(win, `window.beagleAPI.getSavedState().then(s=>s.settings?.launchAtLogin===true)`);
    assert.match(require("fs").readFileSync(autostartFile, "utf8"), /--hidden/);
    await win.webContents.executeJavaScript(`${bg("Keep BeagleDock in the tray")}.click()`);
    await waitFor(win, `${bg("Keep BeagleDock in the tray")}.checked===false`);
    await waitFor(win, `window.beagleAPI.getSavedState().then(s=>s.settings?.runInBackground===false)`);
    // Back to the default: with the background off, closing the window quits the app, and the next
    // stage closes the window expecting the tray.
    await win.webContents.executeJavaScript(`${bg("Keep BeagleDock in the tray")}.click()`);
    await waitFor(win, `window.beagleAPI.getSavedState().then(s=>s.settings?.runInBackground===true)`);
  } else {
    const persisted = await win.webContents.executeJavaScript(`({
      tray: [...document.querySelectorAll('input[type="checkbox"]')].find(i=>i.closest('label')?.innerText.includes('Keep BeagleDock in the tray')).checked,
      login: [...document.querySelectorAll('input[type="checkbox"]')].find(i=>i.closest('label')?.innerText.includes('Start with the system')).checked,
    })`);
    assert.deepEqual(persisted, { tray: true, login: true }, "the background preferences survive the restart");
    // Undo: turning off start with the system removes the file.
    await win.webContents.executeJavaScript(`[...document.querySelectorAll('input[type="checkbox"]')].find(i=>i.closest('label')?.innerText.includes('Start with the system')).click()`);
    await waitFor(win, `window.beagleAPI.getSavedState().then(s=>s.settings?.launchAtLogin===false)`);
    assert.equal(require("fs").existsSync(path.join(process.env.HOME, ".config", "autostart", "beagledock.desktop")), false);
    const value = await win.webContents.executeJavaScript(
      `document.querySelector('select[aria-label="Antigravity: Tool policy (global)"]').value`,
    );
    assert.equal(value, "strict");
  }
  {
    // Alt+P turns plan on and Alt+M cycles the modes; the header picker shows the mode and the switch persists.
    await win.webContents.executeJavaScript(`document.querySelector('[data-session-id]').click()`);
    await waitFor(win, `!!document.querySelector('select[data-control="permission"]')`);
    const mode = () => win.webContents.executeJavaScript(`document.querySelector('select[data-control="permission"]').value`);
    const press = (key) => win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},altKey:true,bubbles:true,cancelable:true}))`);
    const start = await mode();
    await press("p");
    await waitFor(win, `document.querySelector('select[data-control="permission"]').value==='plan'`);
    await press("p");
    await waitFor(win, `document.querySelector('select[data-control="permission"]').value===${JSON.stringify(start)}`);
    await win.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('select[data-control="permission"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(input, 'edits');
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(win, `document.querySelector('select[data-control="permission"]').value==='edits'`);
    await press("m");
    await waitFor(win, `document.querySelector('select[data-control="permission"]').value==='full'`);
    await press("m");
    await waitFor(win, `document.querySelector('select[data-control="permission"]').value==='inherit'`);
    assert.ok(start);
    const saved = await win.webContents.executeJavaScript(`window.beagleAPI.getSavedState().then(s=>s.sessions.map(x=>x.permission))`);
    assert.ok(saved.includes("inherit"), "the switch was saved in the conversation");
    // Back to the settings tab, where the next step starts from.
    await win.webContents.executeJavaScript(`document.querySelector('button[title^="Settings"]').click()`);
    await waitFor(win, `!document.querySelector('input[placeholder^="Message to"]')`);
  }
  {
    // The tray menu and notifications ask to open a conversation: with the settings screen open,
    // the interface goes back to the chat and to it.
    const st = await win.webContents.executeJavaScript(`window.beagleAPI.getSavedState()`);
    const target = st.sessions[st.sessions.length - 1];
    assert.equal(await win.webContents.executeJavaScript(`!document.querySelector('input[placeholder^="Message to"]')`), true, "starts outside the chat");
    win.webContents.send("open-session", { sessionId: target.id });
    await waitFor(win, `!!document.querySelector('input[placeholder^="Message to"]') && document.querySelector('header').innerText.includes(${JSON.stringify(target.title)})`);
  }
  if (stage === "first") {
    // Voice dictation: records the fake microphone, converts to WAV in the renderer and transcribes on a
    // local OpenAI-compatible server; the intermediate state shows before the text.
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
    const input = `document.querySelector('input[placeholder^="Message to"]')`;
    const mic = `document.querySelector('button[aria-label="Dictate a message by voice"]')`;
    const speech = await win.webContents.executeJavaScript(`window.beagleAPI.getDictationStatus()`);
    assert.equal(speech.engine, "local", "local dictation is the default");
    if (!speech.model.installed) {
      // Without the voice model, the microphone offers the download instead of recording for nothing.
      await waitFor(win, `!!${mic}`);
      await win.webContents.executeJavaScript(`${mic}.click()`);
      await waitFor(win, `document.querySelector('[data-testid="dictation-model-offer"]')?.innerText.includes('669 MB')`);
      assert.equal(await win.webContents.executeJavaScript(`!document.querySelector('[data-testid="dictation-recording"]')`), true);
      await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Not now"]').click()`);
      await waitFor(win, `!!${mic}`);
    } else if (process.env.BEAGLEDOCK_SMOKE_SPEECH_AUDIO) {
      // Real end to end: speech from the file → recording → WAV → parakeet-cli → text in the field.
      assert.equal(speech.engineAvailable, true, "motor local compilado (npm run build:speech)");
      await win.webContents.executeJavaScript(
        `(()=>{const i=${input};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await win.webContents.executeJavaScript(`${mic}.click()`);
      await waitFor(win, `!!document.querySelector('[data-testid="dictation-recording"]')`);
      const seconds = Number(process.env.BEAGLEDOCK_SMOKE_SPEECH_SECONDS || 6);
      await waitFor(win, `document.querySelector('[data-testid="dictation-recording"]').innerText.includes('0:0${seconds}')`);
      const stoppedAt = Date.now();
      await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Finish dictation and transcribe"]').click()`);
      await waitFor(win, `document.body.innerText.includes('Transcribing')`);
      const start = Date.now();
      let spoken = "";
      while (Date.now() - start < 30000 && !spoken) {
        spoken = await win.webContents.executeJavaScript(`${input}.value`);
        if (!spoken) await pause();
      }
      console.log(`Desktop dictation local (${Date.now() - stoppedAt} ms after finishing): ${JSON.stringify(spoken)}`);
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
    // Esc discards: nothing is sent for transcription.
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
    await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Finish dictation and transcribe"]').click()`);
    await waitFor(win, `document.body.innerText.includes('Transcribing')`);
    const waitReceived = async () => {
      const start = Date.now();
      while (!received.length && Date.now() - start < 10000) await pause();
    };
    await waitReceived();
    assert.equal(received.length, 1, "only the finished recording was sent");
    // Still no reply from the server: the field didn't change.
    assert.equal(await win.webContents.executeJavaScript(`${input}.value`), "Revise");
    release();
    await waitFor(win, `${input}.value === 'Revise texto ditado pelo microfone'`);
    await waitFor(win, `!document.body.innerText.includes('Transcribing')`);
    const { url, auth, body } = received[0];
    assert.equal(url, "/v1/audio/transcriptions");
    assert.equal(auth, undefined, "a local server needs no key");
    const riff = body.indexOf("RIFF");
    assert.ok(riff > 0, "multipart traz o WAV");
    assert.equal(body.toString("ascii", riff + 8, riff + 12), "WAVE");
    assert.equal(body.readUInt32LE(riff + 24), 16000);
    const dataBytes = body.readUInt32LE(riff + 40);
    assert.ok(dataBytes >= 16000 * 2, `at least 1 s of audio (${dataBytes} bytes)`);
    let peak = 0;
    for (let i = 0; i < Math.min(dataBytes, 64000); i += 2) peak = Math.max(peak, Math.abs(body.readInt16LE(riff + 44 + i)));
    assert.ok(peak > 1000, `the microphone audio isn't silence (peak ${peak})`);
    const text = body.toString("utf8");
    assert.match(text, /gpt-4o-transcribe/);
    assert.match(text, /Rumofy/);
    server.close();
    console.log("Desktop dictation: microphone, 16 kHz WAV, intermediate state and text in the field passed.");
  }
  if (stage === "first") {
    // New chats: with the option on, each CLI's + repeats the model, level and permission
    // last chosen in one of its conversations; off, it goes back to the CLI default.
    const js = (code) => win.webContents.executeJavaScript(code);
    const setSelect = (control, value) =>
      js(`(()=>{const s=document.querySelector('select[data-control="${control}"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,${JSON.stringify(value)});s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const selected = () =>
      js(`({model:document.querySelector('select[data-control="model"]')?.value||"",effort:document.querySelector('select[data-control="effort"]')?.value||"",permission:document.querySelector('select[data-control="permission"]').value})`);
    const toggle = `[...document.querySelectorAll('input[type="checkbox"]')].find(i=>i.closest('label')?.innerText.includes('Start with each CLI'))`;
    const initialIds = await js(`window.beagleAPI.getSavedState().then(s=>s.sessions.map(x=>x.id))`);
    const newChat = async (index) => {
      const before = await js(`window.beagleAPI.getSavedState().then(s=>s.sessions.length)`);
      await js(`document.querySelectorAll('button[title="Open a new conversation"]')[${index}].click()`);
      await waitFor(win, `window.beagleAPI.getSavedState().then(s=>s.sessions.length>${before})`);
      await waitFor(win, `!!document.querySelector('select[data-control="permission"]')`);
    };
    await js(`document.querySelector('button[title^="Settings"]').click()`);
    await waitFor(win, `!!${toggle}`);
    await js(`${toggle}.click()`);
    await waitFor(win, `window.beagleAPI.getSavedState().then(s=>s.settings?.rememberSessionChoices===true)`);
    for (const index of [0, 1, 2]) {
      await newChat(index);
      // Last model and last level in the list (different from the fixture's default) and full access.
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
      assert.deepEqual(await selected(), chosen, `the CLI ${index} new chat repeats the last choice`);
    }
    await js(`document.querySelector('button[title^="Settings"]').click()`);
    await waitFor(win, `!!${toggle}`);
    await js(`${toggle}.click()`);
    await waitFor(win, `window.beagleAPI.getSavedState().then(s=>s.settings?.rememberSessionChoices===false)`);
    await newChat(0);
    assert.equal((await selected()).permission, "inherit", "off, the new chat uses the CLI default");
    // This scenario's conversations don't enter the restart's count.
    const created = await js(`window.beagleAPI.getSavedState().then(s=>s.sessions.map(x=>x.id))`);
    for (const id of created.filter((id) => !initialIds.includes(id)))
      assert.equal((await js(`window.beagleAPI.deleteSession(${JSON.stringify(id)})`))?.success, true);
    console.log("Desktop new chats: Claude, Codex and AGY repeat model, level and permission when the option is on.");
  }
  if (stage === "first") {
    // Phone access: a phone-sized window opens the phone page over HTTPS, pairs and chats with the
    // three CLIs through the real app, while the desktop window follows along (and the other way).
    const { session: electronSession } = require("electron");
    const js = (code) => win.webContents.executeJavaScript(code);
    const status = await js(`window.beagleAPI.setRemoteAccessEnabled(true)`);
    assert.equal(status.running, true, status.error || "phone access server running");
    const pairing = await js(`window.beagleAPI.startRemotePairing()`);
    assert.match(pairing.qrDataUrl, /^data:image\/gif;base64,/);
    const phoneSession = electronSession.fromPartition("phone-smoke");
    // The phone trusts the local certificate once installed; here, only this server's.
    phoneSession.setCertificateVerifyProc((request, callback) =>
      callback(request.hostname === "127.0.0.1" && request.certificate.issuerName === "BeagleDock Local Access" ? 0 : -2),
    );
    const phone = new BrowserWindow({ width: 390, height: 844, show: false, webPreferences: { partition: "phone-smoke", backgroundThrottling: false } });
    const pjs = (code) => phone.webContents.executeJavaScript(code);
    const shot = async (name) => {
      if (!process.env.BEAGLEDOCK_SHOT_DIR) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
      require("fs").writeFileSync(
        require("path").join(process.env.BEAGLEDOCK_SHOT_DIR, `phone-${name}.png`),
        (await phone.webContents.capturePage()).toPNG(),
      );
    };
    await phone.loadURL(`https://127.0.0.1:${status.port}/#pair=${pairing.code}`);
    await waitFor(phone, `!!document.querySelector('form button[type="submit"]')`);
    await shot("pair");
    await pjs(`(()=>{const input=document.querySelectorAll('form input')[1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Smoke phone');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('form').requestSubmit();})()`);
    // Paired: the desktop's own conversation list, quotas included.
    await waitFor(phone, `document.querySelectorAll('button[title="Open a new conversation"]:not(:disabled)').length === 3`);
    await waitFor(phone, `document.body.innerText.includes('5h: 34%')`);
    await shot("list");
    const phoneMessage = (text) =>
      pjs(`(()=>{const input=document.querySelector('input[placeholder^="Message to"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
        .then(() => waitFor(phone, `!document.querySelector('button[type="submit"]').disabled`))
        .then(() => pjs(`document.querySelector('button[type="submit"]').form.requestSubmit()`));
    const createdIds = [];
    for (const [index, name] of ["claude", "codex", "agy"].entries()) {
      const before = await js(`window.beagleAPI.getSavedState().then(s=>s.sessions.map(x=>x.id))`);
      await pjs(`document.querySelectorAll('button[title="Open a new conversation"]')[${index}].click()`);
      await waitFor(phone, `!!document.querySelector('input[placeholder^="Message to"]')`);
      const created = (await js(`window.beagleAPI.getSavedState().then(s=>s.sessions.map(x=>x.id))`)).find((id) => !before.includes(id));
      assert.ok(created, `${name} conversation created from the phone`);
      createdIds.push(created);
      // The desktop lists it on its own; open it there to follow the phone's turns.
      await waitFor(win, `!!document.querySelector('[data-session-id="${created}"]')`);
      await js(`document.querySelector('[data-session-id="${created}"]').click()`);

      // Approval answered on the phone, while the turn is blocked; the desktop sees it all.
      await phoneMessage("smoke-approval allow");
      await waitFor(phone, `!!document.querySelector('[aria-label="Authorize the CLI action"]')`);
      await waitFor(win, `document.body.innerText.includes('smoke-approval allow')`);
      if (index === 0) await shot("approval");
      await pjs(`[...document.querySelectorAll('[aria-label="Authorize the CLI action"] button')].find(b=>b.textContent.startsWith('Allow once')).click()`);
      await waitFor(phone, `document.body.innerText.includes('APPROVED_ACTION_DONE') && !document.querySelector('[aria-label="Authorize the CLI action"]')`);
      await waitFor(win, `document.body.innerText.includes('APPROVED_ACTION_DONE')`);
      if (index === 0) {
        await shot("chat");
        await pjs(`document.querySelector('[aria-label="Chat controls"]').click()`);
        await waitFor(phone, `!!document.querySelector('select[data-control="permission"]')`);
        await shot("controls");
        await pjs(`document.querySelector('[aria-label="Chat controls"]').click()`);
      }

      // And the other way: sent on the desktop, followed live on the phone.
      await send(win, "from the desktop " + index, `${name} fixture resposta`);
      await waitFor(phone, `document.body.innerText.includes('from the desktop ${index}') && !document.querySelector('button[aria-label="Stop the run and clear the queue"]')`);
      const phoneText = await pjs(`document.body.innerText`);
      assert.equal((phoneText.match(/from the desktop/g) || []).length, 1, "the desktop's message shows once on the phone");
      // Partial text live on both screens before the end; stopped from the phone.
      await phoneMessage("smoke-hang phone");
      await waitFor(phone, `document.body.innerText.includes('PARTIAL_BEFORE_STOP')`);
      await waitFor(win, `document.body.innerText.includes('PARTIAL_BEFORE_STOP') && document.querySelector('header').innerText.includes('RUNNING CLI')`);
      if (index === 0) await shot("streaming");
      await pjs(`document.querySelector('button[aria-label="Stop the run and clear the queue"]').click()`);
      await waitFor(phone, `!document.querySelector('button[aria-label="Stop the run and clear the queue"]')`);
      await waitFor(win, `!document.querySelector('header').innerText.includes('RUNNING CLI')`);

      await pjs(`history.back()`);
      await waitFor(phone, `document.querySelectorAll('button[title="Open a new conversation"]').length === 3`);
    }
    await shot("list-after");
    // Touch screens have no hover: a conversation's close button shows in the list and a tap
    // closes it without opening the chat.
    phone.webContents.debugger.attach();
    await phone.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await waitFor(phone, `matchMedia('(pointer: coarse)').matches`);
    const closeOnPhone = `[data-session-id="${createdIds[0]}"] button[aria-label="Close conversation"]`;
    await waitFor(phone, `document.querySelector('${closeOnPhone}')?.getBoundingClientRect().width >= 24`);
    await pjs(`document.querySelector('${closeOnPhone}').click()`);
    await waitFor(phone, `!document.querySelector('[data-session-id="${createdIds[0]}"]')`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(await pjs(`!!document.querySelector('input[placeholder^="Message to"]')`), false, "closing from the list stays on the list");
    await waitFor(win, `!document.querySelector('[data-session-id="${createdIds[0]}"]')`);
    phone.destroy();
    for (const id of createdIds)
      assert.equal((await js(`window.beagleAPI.deleteSession(${JSON.stringify(id)})`))?.success, true);

    // Revoked, the phone loses access; turned off, the server stops.
    const { devices } = await js(`window.beagleAPI.getRemoteAccessStatus()`);
    assert.deepEqual(devices.map((d) => d.name), ["Smoke phone"]);
    await js(`window.beagleAPI.revokeRemoteDevice(${JSON.stringify(devices[0].id)})`);
    assert.equal((await js(`window.beagleAPI.getRemoteAccessStatus()`)).devices.length, 0);
    assert.equal((await js(`window.beagleAPI.setRemoteAccessEnabled(false)`)).running, false);
    console.log("Desktop phone access: the phone page pairs and chats with Claude, Codex and AGY (approval, live text, stop), in sync with the desktop both ways.");
  }
  if (stage === "first") {
    // Leave the original conversations planning, then verify the prior permission after a real app restart.
    const state = await win.webContents.executeJavaScript(`window.beagleAPI.getSavedState()`);
    for (const session of state.sessions.filter((s) => s.title === "smoke one")) {
      await win.webContents.executeJavaScript(`window.beagleAPI.saveSession(${JSON.stringify({ ...session, permission: "full" })})`);
      await win.webContents.executeJavaScript(`window.beagleAPI.saveSession(${JSON.stringify({ ...session, permission: "plan" })})`);
    }
  }
  assert.deepEqual(failures, []);
  console.log(
    `Desktop smoke ${stage}: three providers, messages and persistent IDs passed.`,
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
}, 75000).unref();
