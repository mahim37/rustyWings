# 2. Open-ended evolution instead of a generational genetic algorithm

**Status:** accepted, 2026-09-06

## Context

A generational GA (evaluate everyone for N ticks, select by fitness, breed a
new population) is simple and converges fast, but it bakes in what "good"
means, resets the world every generation, and can only ever show birds getting
better at the one thing the fitness function names.

## Decision

Model energy explicitly. Birds reproduce when they have enough of it and die
when they run out. There is no fitness function and no generation boundary.
Add a second trophic level (predators) so selection pressure on herbivores
comes from two directions, and make body traits (field of view, sight range,
speed, size) heritable with energy costs.

## Consequences

Dynamics are emergent and harder to tune: the first default parameters
produced a predator overshoot that repeatedly crashed herbivores to the rescue
floor. Tuning needed a headless runner and a parameter sweep, which the CLI now
provides. In return the simulation produces predator-prey cycles, trait arms
races and lineage depth that a GA cannot, and "did it learn?" needs its own
instrument (decision 4).
