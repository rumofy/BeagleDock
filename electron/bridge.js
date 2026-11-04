// HTTP bridge to run BeagleDock's backend (electron/main.js) outside Electron,
// e.g. when opening http://localhost:5173 in a browser. It uses the same real IPC handlers.
const Module = require("module");
const path = require("path");

function createBridge() {
  let backend;
  for (const file of ["main.js", "preload.js"])
    delete require.cache[require.resolve(path.join(__dirname, file))];
  const handlers = new Map();
  const listeners = new Set();
  const emit = (channel, payload) =>
    listeners.forEach((fn) => {
      try {
        fn(channel, payload);
      } catch (e) {}
    });

  const fakeWindow = {
    webContents: {
      send: emit,
      on() {},
      openDevTools() {},
      setWindowOpenHandler() {},
    },
    isDestroyed: () => false,
    loadURL() {
      return Promise.resolve();
    },
    loadFile() {
      return Promise.resolve();
    },
    on() {},
    once() {},
    show() {},
    focus() {},
    setMenu() {},
    setMenuBarVisibility() {},
  };
  function BrowserWindow() {
    return fakeWindow;
  }
  BrowserWindow.getAllWindows = () => [fakeWindow];

  const electronStub = {
    app: {
      whenReady: () => Promise.resolve(),
      on() {},
      quit() {},
      getPath: () => require("os").homedir(),
    },
    BrowserWindow,
    ipcMain: { handle: (ch, fn) => handlers.set(ch, fn), on() {} },
    contextBridge: {
      exposeInMainWorld: (_n, api) => {
        electronStub.__api = api;
      },
    },
    ipcRenderer: {
      invoke: (ch, ...args) => {
        const h = handlers.get(ch);
        if (!h)
          return Promise.reject(new Error("Unknown IPC channel: " + ch));
        return Promise.resolve(h({ sender: fakeWindow.webContents }, ...args));
      },
      on() {},
      removeListener() {},
    },
    shell: { openExternal() {} },
    dialog: {},
    Menu: { setApplicationMenu() {} },
    screen: {},
  };

  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "electron") return electronStub;
    return origLoad.call(this, request, ...rest);
  };
  try {
    backend = require(path.join(__dirname, "main.js"));
    require(path.join(__dirname, "preload.js"));
  } finally {
    Module._load = origLoad;
  }
  const api = electronStub.__api || {};

  return {
    methods: Object.keys(api).filter((k) => k !== "on"),
    invoke: async (method, args) => {
      await backend.ready;
      if (
        !Object.hasOwn(api, method) ||
        method === "on" ||
        typeof api[method] !== "function"
      )
        throw new Error("Unknown method: " + method);
      return await api[method](...(args || []));
    },
    close: () => {
      backend.shutdown();
      listeners.clear();
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

module.exports = { createBridge };
