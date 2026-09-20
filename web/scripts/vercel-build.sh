#!/usr/bin/env bash
# Vercel build step. Runs from the repository root after vercel-install.sh.
set -euo pipefail

export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export PATH="$(npm config get prefix)/bin:$CARGO_HOME/bin:$PATH"
# Keep compiled Rust inside node_modules so Vercel's build cache can carry it
# between deployments. Harmless if the cache is cold.
export CARGO_TARGET_DIR="$PWD/web/node_modules/.cache/cargo-target"

cd web
pnpm run build   # wasm-pack → tsc → vite
