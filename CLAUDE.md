# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

rustyWings is a browser artificial-life simulation: an open-ended ecosystem of
neural-network birds (sparrows eat seeds, hawks eat sparrows) with energy,
reproduction, death and heritable body traits. The simulation is a Rust crate
compiled both natively (CLI) and to WebAssembly (browser). Design rationale is
in `docs/ARCHITECTURE.md` and `docs/decisions/`.

The repo is mid-rebuild. `crates/` and `web/` are the new code and what is
deployed; `libs/` and `www/` are the original tutorial-derived app, still
compiled by `cargo test --workspace` until milestone 3 deletes them. Do not
extend `libs/` or `www/`.

## Layout

```
crates/rustywings-core   simulation library (no I/O, no threads, wasm-clean)
crates/rustywings-cli    `rustywings` binary: run, bench, verify, arena, config
crates/rustywings-wasm   wasm-bindgen facade: `Sim`, frame packing (frame.rs)
web/                     Vite + TypeScript frontend, no framework; sim on a Worker,
                         WebGL2 renderer, SVG charts. Built wasm lands in web/src/wasm
                         (gitignored). vercel.json at the root builds it on Vercel.
design/mockups/          the HTML mockups the UI was chosen from; D is the reference
docs/                    ARCHITECTURE.md and decision records
libs/, www/              legacy code, slated for removal
```

## Commands

Rust toolchain is pinned by `rust-toolchain.toml` (stable + `wasm32-unknown-unknown`).

```bash
cargo test --workspace                                     # everything, old and new
cargo test -p rustywings-core                              # the new core
cargo test -p rustywings-core -- --ignored                 # slow: 40k-tick learning test
cargo clippy -p rustywings-core -p rustywings-cli --all-targets -- -D warnings
cargo fmt -p rustywings-core -p rustywings-cli -p rustywings-wasm
cargo clippy -p rustywings-wasm --target wasm32-unknown-unknown -- -D warnings

cd web
pnpm install
pnpm build:wasm      # wasm-pack → src/wasm/ (needed before dev, check or test)
pnpm dev             # Vite dev server
pnpm check           # tsc --noEmit
pnpm test            # vitest, includes loading the wasm in Node and checking the golden checksum
pnpm build           # build:wasm + check + vite build → dist/

cargo build --release -p rustywings-cli
./target/release/rustywings run --seed 1 --ticks 60000 --every 500 --out stats.csv
./target/release/rustywings run --config my.json --format jsonl
./target/release/rustywings bench --agents 5000 --ticks 200
./target/release/rustywings verify --seed 1 --ticks 2000 [--expect <hex>]
./target/release/rustywings arena --seeds 3 --ticks 30000     # the learning test CI runs
./target/release/rustywings config > defaults.json            # edit, then pass --config
```

CI (`.github/workflows/ci.yml`) runs fmt, clippy (native and wasm32), tests,
the golden-checksum test on Linux/macOS/Windows, the arena learning test, and
the web job (wasm-pack, tsc, vitest, vite build). Formatting and clippy are
enforced on the new crates only. Rust needs `export PATH="$HOME/.cargo/bin:$PATH"`
in a fresh shell on this machine.

## Rules that keep determinism

The whole design rests on a seed meaning the same thing on every platform.

- Use `crate::math::{sin, cos, atan2, tanh, sqrt}` and `libm::*`, never
  `f32::sin` etc. from `std` (platform libm differs in the last bit).
- Use `crate::Rng`, never the `rand` crate. Adding, removing or reordering an
  RNG call anywhere in a tick changes every checksum.
- No `HashMap`/`HashSet` iteration and no threads inside `World::step`.
  Parallelism belongs in the CLI, across independent worlds.
- The golden checksum test in `world.rs` will fail after any deliberate change
  to simulation behaviour or default parameters. Update it with
  `rustywings verify --seed 1 --ticks 2000` and say so in the commit message.

## Simulation conventions

- World is the unit torus. Heading is radians from +x toward +y. The renderer
  keeps +y up on screen (WebGL clip space), so no flip is needed.
- `Agents` is struct-of-arrays; removing a bird means `Agents::swap_remove`,
  which moves every column. Never remove from one column alone.
- Phases in `World::step` destructure `self` into disjoint field borrows. Keep
  it that way rather than cloning to satisfy the borrow checker.
- `Config` uses `deny_unknown_fields`; every field has a doc comment in
  human units because the UI shows them as tooltips.
- `Species` is stored as `u8` in `Agents::species` so frame packing is a
  straight copy.

## Browser boundary conventions

- Seeds cross as hex strings, ids and ticks as `f64`, never `BigInt`.
- Config crosses as JSON text (`JSON.stringify` on the JS side) because
  `serde_wasm_bindgen` silently drops unknown keys; `serde_json` honours
  `deny_unknown_fields`. Stats and inspections come back as plain objects.
- The frame layout lives in `crates/rustywings-wasm/src/frame.rs` and is
  mirrored by the constants in `web/src/sim/protocol.ts`. Change both.
- The worker samples stats every `SAMPLE_STRIDE` (25) ticks; charts are
  windows in ticks, not wall-clock time.
- UI copy is plain language: sparrows, hawks, seeds; never herbivore/predator.

## Tuning workflow

Default parameters were chosen by sweeping variants with the CLI, judging
60k-tick runs on: no immigration events, sparrows in the low hundreds or more,
hawks a fraction of that, seeds visibly present, and the arena ratio well
above 1. Reproduce with `rustywings config`, edit, `rustywings run --config`,
and compare CSVs. Record notable findings in `docs/decisions/`.
