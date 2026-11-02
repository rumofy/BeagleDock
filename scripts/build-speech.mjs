#!/usr/bin/env node
// Compila o motor de ditado local (parakeet-cli do whisper.cpp) otimizado para esta CPU.
// A distribuição é local: o binário vai para vendor/speech e entra no pacote como recurso.
// Downloads com SHA-256 fixo; o CMake oficial é baixado só se não houver um no PATH.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "vendor", "speech");
const CACHE = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "beagledock-build");
const WHISPER = {
  version: "1.9.5",
  url: "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.5.tar.gz",
  sha256: "ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720",
};
const CMAKE = {
  version: "4.4.5",
  url: "https://github.com/Kitware/CMake/releases/download/v4.4.5/cmake-4.4.5-linux-x86_64.tar.gz",
  sha256: "ed85135c5a5135b45e50423cb406dea04ca3338da0b8ef3c9ede963559680be0",
};
const STAMP = `whisper.cpp ${WHISPER.version} parakeet-cli native ${os.cpus()[0]?.model || ""}`;

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (result.status !== 0)
    throw new Error(`${path.basename(cmd)} ${args.slice(0, 2).join(" ")} falhou (${result.status ?? result.error?.message}).`);
}

function has(cmd) {
  return spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
}

async function fetchVerified({ url, sha256 }, file) {
  if (fs.existsSync(file) && createHash("sha256").update(fs.readFileSync(file)).digest("hex") === sha256)
    return file;
  console.log(`Baixando ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Download falhou (HTTP ${response.status}): ${url}`);
  const data = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== sha256) throw new Error(`SHA-256 inesperado para ${url}: ${actual}`);
  fs.writeFileSync(file, data);
  return file;
}

async function cmakeBinary() {
  if (process.env.CMAKE) return process.env.CMAKE;
  if (has("cmake")) return "cmake";
  const dir = path.join(CACHE, `cmake-${CMAKE.version}-linux-x86_64`);
  const bin = path.join(dir, "bin", "cmake");
  if (!fs.existsSync(bin)) {
    const tarball = await fetchVerified(CMAKE, path.join(CACHE, `cmake-${CMAKE.version}.tar.gz`));
    run("tar", ["xzf", tarball, "-C", CACHE]);
  }
  return bin;
}

async function main() {
  if (process.platform !== "linux" || process.arch !== "x64") {
    console.log("Ditado local: build disponível só para Linux x64; pulando.");
    return;
  }
  const target = path.join(OUT_DIR, "parakeet-cli");
  const stampFile = path.join(OUT_DIR, "BUILD");
  if (!process.argv.includes("--force") && fs.existsSync(target) && fs.readFileSync(stampFile, "utf8").trim() === STAMP) {
    console.log(`Motor de ditado já compilado (${STAMP}).`);
    return;
  }
  for (const tool of ["g++", "make", "tar"])
    if (!has(tool)) throw new Error(`Ferramenta ausente para compilar o ditado local: ${tool}`);
  fs.mkdirSync(CACHE, { recursive: true });
  const cmake = await cmakeBinary();
  const tarball = await fetchVerified(WHISPER, path.join(CACHE, `whisper.cpp-${WHISPER.version}.tar.gz`));
  const src = path.join(CACHE, `whisper.cpp-${WHISPER.version}`);
  fs.rmSync(src, { recursive: true, force: true });
  run("tar", ["xzf", tarball, "-C", CACHE]);
  const build = path.join(src, "build");
  run(cmake, [
    "-S", src, "-B", build,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DBUILD_SHARED_LIBS=OFF",
    "-DGGML_NATIVE=ON", // AVX2/FMA/VNNI desta máquina: sem isso o modelo roda dezenas de vezes mais devagar
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_BUILD_SERVER=OFF",
    "-DWHISPER_SDL2=OFF",
  ]);
  run(cmake, ["--build", build, "-j", String(Math.max(1, os.cpus().length)), "--target", "parakeet-cli"]);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.copyFileSync(path.join(build, "bin", "parakeet-cli"), target);
  fs.chmodSync(target, 0o755);
  fs.copyFileSync(path.join(src, "LICENSE"), path.join(OUT_DIR, "LICENSE.whisper.cpp"));
  fs.writeFileSync(stampFile, `${STAMP}\n`);
  console.log(`Motor de ditado compilado em ${path.relative(ROOT, target)}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
