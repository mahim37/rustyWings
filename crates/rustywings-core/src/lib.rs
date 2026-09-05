//! # rustywings-core
//!
//! A deterministic, data-oriented artificial-life simulation.
//!
//! Plants ("seeds") regrow in drifting patches on a unit torus. Herbivore birds
//! ("sparrows") eat plants; predator birds ("hawks") eat herbivores. Every bird
//! carries a genome: a small feed-forward neural network that maps what its
//! retina sees onto steering, plus a handful of evolvable body traits (field of
//! view, sight range, top speed, size). There are no generations: a bird that
//! accumulates enough energy reproduces, a bird that runs out of energy dies,
//! and selection is whatever survives that.
//!
//! ## Design goals
//!
//! * **Bit-identical results everywhere.** The crate owns its RNG
//!   ([`Rng`], xoshiro256++) and routes every transcendental function through
//!   [`libm`], so a run with a given seed produces the same checksum on native
//!   Linux, macOS and inside WebAssembly. The headless CLI and the browser
//!   agree on every bit.
//! * **Data-oriented layout.** Hot agent state lives in struct-of-arrays
//!   ([`Agents`]) so the browser can render straight from slices of wasm
//!   memory without copying, and so the per-tick loops stay cache-friendly.
//! * **No panics on user input.** [`Config`] is validated with
//!   [`Config::validate`], and every public constructor returns a
//!   [`Result`] with a descriptive [`Error`].
//! * **Small dependency surface.** `serde` + `postcard` for snapshots, `libm`
//!   for math. Nothing else. The wasm binary stays small and the behaviour
//!   stays stable across dependency upgrades.

#![forbid(unsafe_code)]
#![warn(missing_docs, clippy::all)]

mod agents;
mod arena;
mod brain;
mod config;
mod error;
mod genome;
mod grid;
pub mod math;
mod plants;
mod retina;
mod rng;
mod stats;
mod world;

pub use agents::{AgentView, Agents, Species};
pub use arena::{ARENA_PREY, ArenaReport, arena_score, arena_score_many, arena_score_random};
pub use brain::{Brain, Topology};
pub use config::{BrainParams, Config, EvolutionParams, PlantParams, SpeciesParams, WorldParams};
pub use error::Error;
pub use genome::{Bound, Genome, TraitBounds, Traits};
pub use grid::Grid;
pub use plants::Plants;
pub use retina::{CHANNELS, Retina};
pub use rng::Rng;
pub use stats::{SpeciesStats, Stats, TickCounters};
pub use world::World;

/// Crate version, exposed so snapshots and the UI can report it.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
