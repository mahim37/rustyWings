# 6. The worker owns the simulation; frames cross as packed buffers

**Status:** accepted, 2026-09-06

## Context

Milestone 1 planned "zero-copy `Float32Array` views over wasm memory uploaded
straight to WebGL". That works only if the simulation and the renderer share
a thread. Sharing a thread means a long tick stalls input and animation, and
"max speed" becomes a frozen page. A Web Worker fixes that but puts wasm
memory on the other side of a thread boundary. `SharedArrayBuffer` could
bridge it, at the price of cross-origin isolation headers on the deployment,
a threads-enabled wasm build, and a main thread that may read half-updated
columns mid-tick.

## Decision

The worker owns the `Sim`. Once per rendered frame it asks the wasm crate to
pack render state into one flat `f32` buffer (header, birds, seeds, patch
centres), copies it into a transferable `ArrayBuffer`, and posts it. The page
uploads slices of the buffer into WebGL2 instance buffers and posts the buffer
back. Two buffers circulate; nothing is allocated in steady state. Stats are
sampled inside the worker every 25 ticks and ride along with the next frame.

## Consequences

One copy per frame, about 200 KB at five thousand birds; measured in the
noise next to drawing. The page never blocks on the simulation and the
simulation never blocks on drawing, so 60 fps rendering holds at any tick
rate. The struct-of-arrays layout still pays: packing is one linear pass. The
zero-copy claim in the milestone-1 architecture notes is withdrawn.
