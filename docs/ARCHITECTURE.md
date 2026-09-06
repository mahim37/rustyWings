# Architecture

rustyWings is an artificial-life simulation: an open-ended ecosystem of
neural-network birds that runs identically in a native CLI and in the browser.
This document explains how it is built and why. Individual decisions are
recorded in [`docs/decisions/`](decisions/).

## The model

The world is a unit torus. Three kinds of things live on it:

| Thing | Role | State |
|---|---|---|
| Seeds (plants) | Energy source. Sprout near slowly drifting patches with logistic regrowth toward a capacity. | position |
| Sparrows (herbivores) | Eat seeds. | position, heading, speed, energy, age, genome |
| Hawks (predators) | Eat sparrows. | same |

There are no generations and no fitness function. A bird's energy falls every
tick (a basal cost, a movement cost that scales with speed squared and body
size, and a sensing cost that scales with field of view and sight range). Eating
restores energy. A bird whose energy crosses its species' reproduction
threshold, and that is old enough, spends energy to create one child with a
mutated copy of its genome. A bird whose energy reaches zero, or that exceeds
its maximum age, dies. Selection is whatever survives that.

A genome is two things:

* **Brain weights** for a fixed-shape feed-forward network (`tanh` hidden and
  output layers). Inputs are the retina, three channels of `N` angular cells
  each (seeds, sparrows, hawks) where each visible thing adds
  `(range - distance) / range` to the cell it falls in, plus two internal
  senses: normalised energy and normalised speed. Outputs are a turn and an
  acceleration in `[-1, 1]`.
* **Body traits**: field-of-view angle, sight range, top speed, body size. Each
  has a cost, so evolution trades them off rather than maximising them.

Because sensing costs energy, "how much should this species see?" is a
question the simulation answers rather than one the config sets. In default
runs sparrows widen their field of view while hawks narrow theirs.

When a species falls below a small floor, a fresh random individual may
"immigrate" each tick. This keeps a browser demo alive after a crash. It can
be disabled, and the default parameters are tuned so it is never triggered in
a normal run; the CLI reports immigrant counts so this is checkable.

## One tick

```
build spatial grids → sense → think → eat → move → metabolise → cull → reproduce → immigrate → regrow
```

Each phase is a method on `World` that destructures the struct-of-arrays agent
table into exactly the columns it reads and writes. The borrow checker then
proves the phases do not alias, and each phase is a tight loop over contiguous
`Vec<f32>`s.

* **Grids.** Two uniform spatial hashes (agents, seeds) are rebuilt every tick
  with a counting sort: O(n), allocation-free after warm-up, and deterministic
  in the order it visits neighbours. Queries visit the `(2·span + 1)²` cells
  covering the query radius, falling back to a full scan when the radius
  exceeds half the world.
* **Sense** fills each bird's retina row from the two grids.
* **Think** runs the network and updates heading and speed.
* **Eat** resolves contacts against pre-move positions so the grid built at
  the start of the tick stays valid. Contested food goes to the lower agent
  index, deterministically.
* **Cull** removes the dead with `swap_remove`, walking indices downward so a
  moved bird has always already been processed.
* **Reproduce** collects births into a scratch list and appends them after the
  loop, so newborns never act in the tick they are born.

## Determinism

Two worlds built from the same seed and config produce the same checksum after
any number of ticks on Linux, macOS, Windows and inside WebAssembly. This is
what makes a shared URL (`?seed=…`) a faithful replay and what lets CI pin a
golden checksum. It rests on three choices:

1. **An owned RNG.** `Rng` is xoshiro256++ seeded through SplitMix64,
   implemented in the crate. Third-party RNG crates legitimately change their
   float distributions between versions; ours does not.
2. **`libm` for transcendentals.** `sin`, `cos`, `atan2`, `tanh`, `log`,
   `floor` all go through the pure-Rust `libm` crate, which computes the same
   bits everywhere. Platform math libraries differ in the last ulp, and one
   ulp is enough to diverge a chaotic system within a few hundred ticks.
   `sqrt` is exempt because IEEE 754 requires it to be correctly rounded.
3. **No hash maps, no threads in the step.** Iteration order is always array
   order. The CLI parallelises across independent worlds, never inside one.

`World::checksum` is FNV-1a over the bit patterns of every position, heading,
speed, energy, id, seed position and the RNG state.

## Data layout and the browser boundary

Hot agent state is struct-of-arrays (`Agents`: `x`, `y`, `heading`, `speed`,
`energy`, `species`, …). Cold state (genomes, lineage) sits alongside. Removing
a bird swap-removes every column in lock step. The per-tick loops stream
through contiguous arrays, and exporting a frame is one linear pass.

In the browser the simulation runs on a Web Worker and the renderer on the
main thread, so render state crosses a thread boundary once per frame. The
wasm crate packs it into one flat `f32` buffer (`frame.rs`: a four-float
header, then eight floats per bird, two per seed, two per patch centre); the
worker copies that into a transferable `ArrayBuffer` and posts it. The page
uploads slices of it straight into WebGL2 instance buffers and sends the
buffer back to be reused, so two buffers circulate and nothing is allocated in
steady state. That is one copy per frame, about 200 KB at five thousand birds,
which is far cheaper than the alternative: `SharedArrayBuffer` would need
cross-origin isolation headers and a threaded wasm build for a view that the
main thread could only read mid-tick. See decision 0006.

Everything else crosses as plain values: stats and inspections as objects,
configuration as JSON text (so unknown fields are rejected by name), seeds as
hex strings, ids and ticks as doubles.

## Configuration

`Config` is a nested plain struct with validated defaults. It is `serde`
(`deny_unknown_fields`) so a typo in a URL parameter or config file is an
error with a dotted field path, never a silent default. `Config::validate`
runs on every path that constructs a world. The browser fetches the defaults
from wasm, so there is exactly one source of truth for every knob and its
documentation.

## Snapshots

`World::to_snapshot` serialises the entire world with `postcard` behind a
magic number and the crate version. Transient state (grids, scratch buffers,
retina activations) is rebuilt on load. A restored world continues
bit-for-bit identically to the original.

## Verification

* **Unit tests** for the RNG (reference vectors from the C implementation),
  torus maths, the spatial grid (against brute force over thousands of random
  points and radii), the retina (table-driven ASCII renderings), the network,
  mutation bounds, plant regrowth, and world invariants (energy bounds,
  torus bounds, id uniqueness, retina sizing).
* **Determinism tests**: same seed same checksum; snapshot round trip
  continues identically; a golden checksum pinned in the test suite and run
  on three operating systems in CI.
* **The arena.** Population growth alone cannot prove brains improved, so the
  crate provides a standardised test: drop one genome into a fresh
  fixed-seed world with reproduction and death disabled, run a fixed number
  of ticks, count meals. `rustywings arena` evolves several worlds in
  parallel, samples genomes from each, scores them against freshly random
  genomes in the same arena, and fails if the median ratio is below a
  threshold. CI runs it on every push.
* **`rustywings bench`** reports ticks per second and agent-updates per second
  at a chosen population, so performance regressions are numbers, not
  impressions.

## Crates and the frontend

```
crates/rustywings-core   the simulation (no I/O, no threads, wasm-clean)
crates/rustywings-cli    native runner: run, bench, verify, arena, config
crates/rustywings-wasm   wasm-bindgen facade: Sim, frame packing, JSON config
web/                     Vite + TypeScript frontend; no framework
libs/, www/              the original tutorial-derived code, kept building
                         until milestone 3 removes it
```

### Frontend

`web/src/sim/worker.ts` owns the `Sim`. It runs a fixed-timestep accumulator
at the requested rate (1×, 4×, 16× real time, or flat out with a 12 ms budget
per turn), samples `stats()` every 25 ticks regardless of speed, and posts a
frame whenever a recycled buffer is free and 15 ms have passed. A slow machine
therefore slows the world down; it never freezes the page. `client.ts` is the
typed handle the page talks to; `protocol.ts` is the message contract and
mirrors the frame layout constants from `frame.rs`.

`render/renderer.ts` draws with WebGL2 in five instanced draw calls: seed
patches, seeds, vision wedges, illustrated bird sprites from a Canvas-drawn
atlas, and the selection ring. The camera is a centre and a zoom on the unit
torus; positions are wrapped relative to the centre in the vertex shader, so
panning across an edge is seamless. World `+y` is up on screen.

`ui/history.ts` keeps the sampled stats and serves windowed, bucket-averaged
series to the SVG charts (`ui/charts.ts`), which share a linked crosshair.
The inspector shows a bird's retina activation and hidden-layer weights;
the four plain-language sliders write into the real config (`ui/settings.ts`)
and the world adopts it live through `World::set_config`.

State that matters is in the URL: `?seed=<hex>` and, when settings differ from
the defaults, `&cfg=<base64url JSON diff>`. The same link replays the same
world. The status bar shows the world checksum; `rustywings verify --seed S
--ticks T` prints the same digits natively, and the vitest suite loads the
built wasm in Node and asserts the golden value from the Rust tests.
