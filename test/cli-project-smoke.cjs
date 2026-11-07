const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
Object.defineProperty(app, "isPackaged", { get: () => true });
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith("file:") })));
const backend = require("../electron/main");
let win;
const js = (code) => win.webContents.executeJavaScript(code);
async function waitFor(expression) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    if (await js(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("Timed out: " + expression);
}
(async () => {
  await backend.ready;
  win = BrowserWindow.getAllWindows()[0];
  win.showInactive();
  if (win.webContents.isLoading()) await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  await waitFor(`document.querySelectorAll('button[title="Open a new conversation"]:not(:disabled)').length===3`);
  const folders = ["project-one", "project-two"].map((name) => path.join(process.env.BEAGLEDOCK_SMOKE_ROOT, name));
  for (const [i, folder] of folders.entries()) {
    fs.mkdirSync(folder, { recursive: true });
    await js(`window.beagleAPI.saveWorkspace({id:'project-${i}',name:'Project ${i}',path:${JSON.stringify(folder)},hasAIMemory:false})`);
  }
  const loaded = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  win.webContents.reload();
  await loaded;
  await waitFor(`document.querySelectorAll('button[title="Open a new conversation"]:not(:disabled)').length===3`);
  for (const [index, provider] of ["claude", "codex", "antigravity"].entries()) {
    const before = await js(`window.beagleAPI.getSavedState().then(s=>s.sessions.map(x=>x.id))`);
    const openBefore = await js(`window.beagleAPI.cliTerminalList().then(l=>l.length)`);
    await js(`document.querySelectorAll('button[title="Open a new conversation"]')[${index}].click()`);
    await waitFor(`!!document.querySelector('[data-testid="cli-terminal-start"]') && !!document.querySelector('[data-testid="start-cli"]')`);
    assert.equal(await js(`window.beagleAPI.cliTerminalList().then(l=>l.length)`), openBefore, "no process starts before the button");
    const original = await js(`document.querySelector('[data-testid="conversation-workspace"]').value`);
    let folder = folders.find((f) => f !== original);
    await js(`(()=>{const field=document.querySelector('[data-testid="conversation-workspace"]');field.value=${JSON.stringify(folder)};field.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await waitFor(`document.querySelector('[data-testid="conversation-workspace"]').value===${JSON.stringify(folder)} && !document.querySelector('[data-testid="start-cli"]').disabled`);
    let saved = await js(`window.beagleAPI.getSavedState().then(s=>s.sessions.find(x=>!${JSON.stringify(before)}.includes(x.id)))`);
    assert.equal(saved.cwd, folder);
    // The registered folder disappears before startup: no claim or process must trap the picker.
    fs.rmdirSync(folder);
    await js(`document.querySelector('[data-testid="start-cli"]').click()`);
    await waitFor(`!!document.querySelector('[data-testid="cli-terminal-start"]') && !document.querySelector('[data-testid="conversation-workspace"]').disabled`);
    assert.equal(await js(`window.beagleAPI.cliTerminalList().then(l=>l.length)`), openBefore);
    assert.equal(await js(`window.beagleAPI.getSavedState().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(saved.id)}).cwdLocked)`), false);
    fs.mkdirSync(folder);
    folder = folders.find((f) => f !== folder);
    await js(`(()=>{const field=document.querySelector('[data-testid="conversation-workspace"]');field.value=${JSON.stringify(folder)};field.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await waitFor(`document.querySelector('[data-testid="conversation-workspace"]').value===${JSON.stringify(folder)} && !document.querySelector('[data-testid="start-cli"]').disabled`);
    saved = await js(`window.beagleAPI.getSavedState().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(saved.id)}))`);
    assert.equal(saved.cwd, folder);
    await js(`document.querySelector('[data-testid="start-cli"]').click()`);
    const bin = provider === "antigravity" ? "agy" : provider;
    await waitFor(`document.querySelector('[data-testid="cli-terminal"]')?.innerText.includes('FIXTURE TUI ${bin}')`);
    assert.equal(await js(`document.querySelector('[data-testid="conversation-workspace"]').disabled`), true);
    const terminal = await js(`window.beagleAPI.cliTerminalList().then(l=>l.find(x=>x.sessionId===${JSON.stringify(saved.id)}))`);
    assert.equal(terminal.cwd, folder);
    const attempt = await js(`window.beagleAPI.saveSession({...${JSON.stringify(saved)},cwd:${JSON.stringify(folders.find((f) => f !== folder))}})`);
    assert.equal(attempt.success, false, "backend also refuses moving the running conversation");
    const refreshed = await js(`window.beagleAPI.getSavedState().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(saved.id)}))`);
    assert.equal(refreshed.cwd, folder);
    assert.equal(refreshed.cwdLocked, true);
    console.log(`Desktop CLI project selection: ${provider} waits for Start CLI, opens the chosen folder and locks it.`);
  }
  backend.shutdown();
  app.quit();
})().catch((error) => { console.error(error); backend.shutdown(); app.exit(1); });
