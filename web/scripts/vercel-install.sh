#!/usr/bin/env bash
# Vercel install step. Runs from the repository root.
#
# Vercel's build image ships Node but no Rust, and nothing compiled is
# committed (docs/decisions/0005-ci-builds-wasm.md), so the toolchain is
# installed here: rustup with the channel and wasm32 target named in
# rust-toolchain.toml, wasm-pack, and the web dependencies.
set -euo pipefail

export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export PATH="$CARGO_HOME/bin:$PATH"

if ! command -v rustup >/dev/null 2>&1; then
  echo "== installing rustup"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain none --no-modify-path
fi
echo "== toolchain from rust-toolchain.toml"
rustup show active-toolchain || rustup toolchain install

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "== installing wasm-pack"
  curl -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh \
    || cargo install wasm-pack --locked
fi
wasm-pack --version

if ! command -v pnpm >/dev/null 2>&1; then
  echo "== installing pnpm"
  npm install -g pnpm@10
fi
echo "== web dependencies"
(cd web && pnpm install --frozen-lockfile)
