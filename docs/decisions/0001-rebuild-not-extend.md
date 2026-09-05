# 1. Rebuild the simulation rather than extend the tutorial port

**Status:** accepted, 2026-09-06

## Context

The original code base was a close port of Patryk Wychowaniec's "Learning to
Fly" tutorial (the shorelark project): a fixed-generation genetic algorithm
over birds with a single food type, with matching crate layout, tests and UI.
Its architecture (deep copies across the wasm boundary every frame, per-frame
canvas resizing, brute-force collision, `rand`-based nondeterminism, no CI)
also limited how far it could be pushed.

## Decision

Start a new set of crates under `crates/` and a new frontend under `web/`,
crediting the tutorial as inspiration. Keep the old code building and deployed
until the replacement ships, then delete it.

## Consequences

The new core shares no code with the tutorial. The concept lineage is
acknowledged in the README. Milestone 1 lands the core and CLI alongside the
old code; milestone 2 replaces the deployment; milestone 3 removes `libs/` and
`www/`.
