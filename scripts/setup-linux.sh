#!/bin/sh
# Installs BeagleDock on Debian/Ubuntu from source, with everything it needs, in one step:
#
#   curl -fsSL https://raw.githubusercontent.com/rumofy/BeagleDock/main/scripts/setup-linux.sh | sh
#   # or, from a checkout:
#   sh scripts/setup-linux.sh
#
# 1. Installs the missing build tools through apt (git, g++/make, Python, curl, tar).
# 2. Installs Node.js LTS for the current user under ~/.local when there is none or it is older
#    than 22.12, checking the download against the release's SHASUMS256.txt.
# 3. Clones the repository into ~/BeagleDock (or uses the checkout it runs from).
# 4. Runs `npm run update`: dependencies, build (app, dictation engine, .deb) and the install,
#    which upgrades a previous version in place.
#
# apt asks for sudo (steps 1 and 4); nothing else runs as root. Running it again only does what
# is still missing, then updates BeagleDock. Environment (optional): BEAGLEDOCK_DIR.
set -eu

NODE_MAJOR=24
say() { printf 'BeagleDock setup: %s\n' "$*"; }
fail() { printf 'BeagleDock setup: error: %s\n' "$*" >&2; exit 1; }

command -v apt-get >/dev/null 2>&1 || fail "apt-get not found: this script supports Debian and Ubuntu."
[ "$(uname -m)" = "x86_64" ] || fail "BeagleDock is built for x86_64 only."

# --- Build tools
missing=""
for pair in git:git g++:g++ make:make python3:python3 curl:curl tar:tar xz:xz-utils; do
  cmd=${pair%%:*}
  pkg=${pair#*:}
  command -v "$cmd" >/dev/null 2>&1 || missing="$missing $pkg"
done
dpkg -s ca-certificates >/dev/null 2>&1 || missing="$missing ca-certificates"
if [ -n "$missing" ]; then
  say "installing with apt:$missing"
  sudo apt-get update
  # shellcheck disable=SC2086
  sudo apt-get install -y $missing
fi

# --- Node.js (per user, under ~/.local)
node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)'
}
if ! node_ok; then
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  file=$(grep -o "node-v[0-9.]*-linux-x64.tar.xz" "$tmp/SHASUMS256.txt" | head -n1)
  [ -n "$file" ] || fail "couldn't find the Node.js ${NODE_MAJOR} download."
  say "installing $file into ~/.local/lib/nodejs"
  curl -fsSL "$base/$file" -o "$tmp/$file"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -) || fail "Node.js checksum mismatch."
  mkdir -p "$HOME/.local/lib/nodejs" "$HOME/.local/bin"
  rm -rf "$HOME/.local/lib/nodejs/current"
  tar -xJf "$tmp/$file" -C "$HOME/.local/lib/nodejs"
  mv "$HOME/.local/lib/nodejs/${file%.tar.xz}" "$HOME/.local/lib/nodejs/current"
  for bin in node npm npx; do ln -sf "$HOME/.local/lib/nodejs/current/bin/$bin" "$HOME/.local/bin/$bin"; done
  PATH="$HOME/.local/bin:$PATH"
  export PATH
  node_ok || fail "Node.js was installed but doesn't run."
  case ":$(printenv PATH):" in *":$HOME/.local/bin:"*) ;; *) say "add ~/.local/bin to your PATH to use node in new terminals." ;; esac
fi

# --- The checkout
dir=${BEAGLEDOCK_DIR:-}
here=$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)
if [ -z "$dir" ] && [ -n "$here" ] && [ -f "$here/../package.json" ] && grep -q '"name": "beagledock"' "$here/../package.json"; then
  dir=$(cd "$here/.." && pwd)
fi
dir=${dir:-$HOME/BeagleDock}
if [ ! -f "$dir/package.json" ]; then
  say "cloning into $dir"
  git clone https://github.com/rumofy/BeagleDock.git "$dir"
fi

# --- Build and install (npm run update)
cd "$dir"
node scripts/update.mjs
say "done. Open BeagleDock from the application menu or run: beagledock. To update later: npm run update (in the checkout) or run this again."
