// Loads a frontend TypeScript module (and the relative modules it imports) for unit tests, without
// a bundler: each file is transpiled to CommonJS and run in its own VM context. JSON files are
// parsed, and `.mjs` files (shared/) are transpiled the same way. Package imports use Node's require.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const EXTENSIONS = ["", ".ts", ".tsx", ".mjs", ".js", ".json", "/index.ts"];

function resolveFile(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const ext of EXTENSIONS) {
    const file = base + ext;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  throw new Error(`load-ts: cannot resolve ${spec} from ${from}`);
}

function createLoader({ globals = {} } = {}) {
  const cache = new Map();
  function load(file) {
    const full = path.resolve(file);
    if (cache.has(full)) return cache.get(full).exports;
    if (full.endsWith(".json")) {
      const module = { exports: JSON.parse(fs.readFileSync(full, "utf8")) };
      cache.set(full, module);
      return module.exports;
    }
    const module = { exports: {} };
    cache.set(full, module);
    const out = ts.transpileModule(fs.readFileSync(full, "utf8"), {
      // `.mjs` would force ESM output; transpile it as an ordinary module.
      fileName: full.endsWith(".mjs") ? full.replace(/\.mjs$/, ".ts") : full,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    const localRequire = (spec) =>
      spec.startsWith(".") ? load(resolveFile(full, spec)) : require(spec);
    vm.runInNewContext(out, { ...globals, module, exports: module.exports, require: localRequire });
    return module.exports;
  }
  return load;
}

/** Loads one module with a fresh module cache (so i18n state is not shared between files). */
const loadTs = (file, options) => createLoader(options)(file);

module.exports = { loadTs, createLoader };
