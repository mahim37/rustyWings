# 4. A standardised arena is the measure of learning

**Status:** accepted, 2026-09-06

## Context

The project's headline claim is that the birds learn. In an open-ended
ecosystem, population counts cannot demonstrate that: more sparrows might mean
more seeds, fewer hawks, or luck. We need a measurement that isolates
behaviour from ecology, is deterministic, and is cheap enough for CI.

## Decision

`arena_score` drops a single genome into a fresh world with a fixed seed,
disables reproduction and death, runs a fixed number of ticks and counts
meals. `rustywings arena` evolves several worlds in parallel, samples genomes
evenly through each surviving herbivore population, scores them and an equal
number of freshly random genomes in the same arena, and fails if the median
ratio of evolved to random mean meals is below a threshold. CI runs this on
every push.

## Consequences

"It learns" is a tested property with a number attached, reported in the
README from real CI runs. The test is sensitive to the default parameters, so
tuning that breaks learning breaks the build, which is the point.
