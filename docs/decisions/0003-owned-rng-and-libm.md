# 3. Own the RNG and route transcendental math through `libm`

**Status:** accepted, 2026-09-06

## Context

A shared URL should replay the same world years later, and the native CLI
should produce the same checksum as the browser so CI can vouch for the wasm
build. The `rand` crate documents that its distributions may change across
major versions, and platform math libraries (Apple's, glibc, MSVC, the wasm
runtime's) differ in the last bit for `sin`, `cos`, `atan2`, `exp`. In a
chaotic many-body system one ulp diverges the trajectory within hundreds of
ticks.

## Decision

Implement xoshiro256++ with SplitMix64 seeding in the crate (about forty lines,
with reference-vector tests). Call every transcendental through the pure-Rust
`libm` crate. Use `sqrt` from `std` because IEEE 754 requires it to be
correctly rounded. Forbid hash maps and threads inside a step.

## Consequences

The crate has two runtime dependencies besides `serde`. Bit-identical
checksums across Linux, macOS, Windows and wasm are tested in CI. `libm`'s
`tanh` and `atan2` are somewhat slower than hardware-backed system calls;
profiling in milestone 3 will decide whether a cheaper approximation is worth
adopting (it would still be deterministic, being pure arithmetic).
