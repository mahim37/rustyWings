# 5. CI builds the wasm; no compiled artifacts in git

**Status:** accepted, 2026-09-06

## Context

The original deployment committed `wasm-pack` output because Vercel's build
image has no Rust toolchain. Committed binaries drift from source silently and
bloat history.

## Decision

GitHub Actions runs fmt, clippy, tests, the wasm check, the cross-platform
determinism test and the arena learning test on every push. The Vercel install
step installs `rustup` and `wasm-pack` itself and builds the wasm during
deployment (milestone 2). Nothing compiled is committed; `Cargo.lock` is.

## Consequences

Deploys take a couple of minutes longer. The deployed wasm is always built
from the commit it claims to be. The existing production URL is kept.
