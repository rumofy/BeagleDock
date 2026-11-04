const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { createSpeechModels, MODELS, DEFAULT_MODEL } = require("../electron/speech-models");

const sha = (data) => crypto.createHash("sha256").update(data).digest("hex");
function setup(content, { status = 200, chunks = 4 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bd-models-"));
  const model = { ...MODELS[0], size: content.length, sha256: sha(content) };
  const catalog = [model];
  const progress = [];
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push(url);
    const step = Math.ceil(content.length / chunks);
    const body = new ReadableStream({
      async pull(controller) {
        if (init.signal.aborted) return controller.error(Object.assign(new Error("abort"), { name: "AbortError" }));
        const offset = (this.offset ||= 0);
        if (offset >= content.length) return controller.close();
        controller.enqueue(new Uint8Array(content.subarray(offset, offset + step)));
        this.offset = offset + step;
        await new Promise((r) => setTimeout(r, 5));
      },
    });
    return new Response(status === 200 ? body : "falhou", { status });
  };
  const models = createSpeechModels({ dir, fetchImpl, catalog, onProgress: (p) => progress.push(p) });
  return { dir, models, progress, requests, model, catalog, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const original = MODELS[0];

test("the default catalog is ggml-org's Parakeet v3 with a fixed SHA-256", () => {
  assert.equal(DEFAULT_MODEL, "parakeet-tdt-0.6b-v3-q8_0");
  assert.match(original.url, /^https:\/\/huggingface\.co\/ggml-org\/parakeet-GGUF\/resolve\/main\/ggml-parakeet-tdt-0\.6b-v3-q8_0\.bin$/);
  assert.match(original.sha256, /^[0-9a-f]{64}$/);
});

test("the download checks the hash, reports progress and leaves the model ready", async () => {
  const content = crypto.randomBytes(4096);
  const { models, progress, requests, model, dir, cleanup } = setup(content);
  try {
    assert.equal(models.status().installed, false);
    const result = await models.download();
    assert.equal(result.path, path.join(dir, model.file));
    assert.equal(sha(fs.readFileSync(result.path)), model.sha256);
    assert.equal(fs.existsSync(`${result.path}.part`), false);
    assert.equal(models.status().installed, true);
    assert.deepEqual(progress.at(-1), { id: model.id, received: 4096, total: 4096, done: true });
    // Already installed: doesn't download again.
    await models.download();
    assert.equal(requests.length, 1);
    models.remove();
    assert.equal(models.status().installed, false);
  } finally {
    cleanup();
  }
});

test("a corrupted file or an HTTP error leave no model or partial file", async () => {
  const content = crypto.randomBytes(2048);
  const corrupt = setup(content);
  try {
    corrupt.catalog[0] = { ...corrupt.model, sha256: "0".repeat(64) };
    await assert.rejects(corrupt.models.download(), /corrupted/);
    assert.deepEqual(fs.readdirSync(corrupt.dir), []);
    assert.match(corrupt.progress.at(-1).error, /corrupted/);
  } finally {
    corrupt.cleanup();
  }
  const http = setup(content, { status: 404 });
  try {
    await assert.rejects(http.models.download(), /HTTP 404/);
    assert.equal(http.models.status().installed, false);
  } finally {
    http.cleanup();
  }
});

test("cancelling stops the download; two simultaneous requests share the same one", async () => {
  const content = crypto.randomBytes(64 * 1024);
  const { models, cleanup, dir } = setup(content, { chunks: 64 });
  try {
    const first = models.download();
    const second = models.download();
    assert.equal(models.status().downloading, true);
    assert.throws(() => models.remove(), /Wait for the download/);
    setTimeout(() => models.cancel(), 20);
    await assert.rejects(first, /cancelled/);
    await assert.rejects(second, /cancelled/);
    assert.equal(models.status().downloading, false);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    cleanup();
  }
});
