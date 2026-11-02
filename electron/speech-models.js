// Modelos de voz para o ditado local: catálogo, download verificado (SHA-256) e status.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Readable } = require("stream");

// Parakeet TDT 0.6B v3 (NVIDIA, CC-BY-4.0) convertido para o whisper.cpp: fala português, pontua
// sozinho e roda em ~1 s para alguns segundos de fala numa CPU comum (o Whisper levava 30 s+).
const MODELS = Object.freeze([
  {
    id: "parakeet-tdt-0.6b-v3-q8_0",
    label: "Parakeet TDT 0.6B v3",
    file: "ggml-parakeet-tdt-0.6b-v3-q8_0.bin",
    url: "https://huggingface.co/ggml-org/parakeet-GGUF/resolve/main/ggml-parakeet-tdt-0.6b-v3-q8_0.bin",
    size: 668757119,
    sha256: "4d64e9e96c2792186d072fde0034df0ad670cf680a2f53069052ead827fd600e",
  },
]);
const DEFAULT_MODEL = MODELS[0].id;

function findCatalogModel(id, catalog = MODELS) {
  return catalog.find((m) => m.id === id) || catalog[0];
}

/**
 * Gerencia os arquivos de modelo em `dir`. Só um download por vez; o progresso vai para
 * `onProgress({ id, received, total, done, error })`.
 */
function createSpeechModels({ dir, fetchImpl = fetch, fsApi = fs, onProgress = () => {}, catalog = MODELS }) {
  let active = null; // { id, controller, received, total }
  const findModel = (id) => findCatalogModel(id, catalog);

  const modelPath = (id) => path.join(dir, findModel(id).file);
  const installed = (id) => {
    try {
      return fsApi.statSync(modelPath(id)).size === findModel(id).size;
    } catch {
      return false;
    }
  };

  function status(id) {
    const model = findModel(id);
    const downloading = active?.id === model.id;
    return {
      id: model.id,
      label: model.label,
      size: model.size,
      installed: installed(model.id),
      downloading,
      received: downloading ? active.received : 0,
    };
  }

  async function download(id) {
    const model = findModel(id);
    if (installed(model.id)) return { ok: true, path: modelPath(model.id) };
    if (active) {
      if (active.id === model.id) return active.promise;
      throw new Error("Já há um modelo de voz sendo baixado.");
    }
    const controller = new AbortController();
    const target = modelPath(model.id);
    const partial = `${target}.part`;
    active = { id: model.id, controller, received: 0, total: model.size };
    const job = active;
    job.promise = (async () => {
      fsApi.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const response = await fetchImpl(model.url, {
        signal: controller.signal,
        redirect: "follow",
      });
      if (!response.ok || !response.body)
        throw new Error(`Download do modelo de voz falhou (HTTP ${response.status}).`);
      const hash = crypto.createHash("sha256");
      const out = fsApi.createWriteStream(partial, { mode: 0o600 });
      let lastReport = 0;
      try {
        for await (const chunk of Readable.fromWeb(response.body)) {
          hash.update(chunk);
          job.received += chunk.length;
          if (job.received > model.size) throw new Error("O modelo baixado é maior que o esperado.");
          if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", resolve));
          const now = Date.now();
          if (now - lastReport > 250) {
            lastReport = now;
            onProgress({ id: model.id, received: job.received, total: model.size, done: false });
          }
        }
      } finally {
        await new Promise((resolve) => out.end(resolve));
      }
      if (job.received !== model.size || hash.digest("hex") !== model.sha256)
        throw new Error("O modelo de voz baixado está corrompido. Tente de novo.");
      fsApi.renameSync(partial, target);
      return { ok: true, path: target };
    })()
      .then((result) => {
        onProgress({ id: model.id, received: model.size, total: model.size, done: true });
        return result;
      })
      .catch((error) => {
        try {
          fsApi.rmSync(partial, { force: true });
        } catch {}
        const message =
          error?.name === "AbortError"
            ? "Download do modelo de voz cancelado."
            : error.message || String(error);
        onProgress({ id: model.id, received: job.received, total: model.size, done: true, error: message });
        throw new Error(message);
      })
      .finally(() => {
        if (active === job) active = null;
      });
    return job.promise;
  }

  function cancel() {
    active?.controller.abort();
    return { ok: true };
  }

  function remove(id) {
    const model = findModel(id);
    if (active?.id === model.id) throw new Error("Aguarde o download terminar ou cancele antes.");
    fsApi.rmSync(modelPath(model.id), { force: true });
    return { ok: true };
  }

  return { status, download, cancel, remove, modelPath, installed };
}

module.exports = { MODELS, DEFAULT_MODEL, findModel: findCatalogModel, createSpeechModels };
