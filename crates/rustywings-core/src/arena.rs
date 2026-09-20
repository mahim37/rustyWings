//! A standardised test for "did anything actually learn?"
//!
//! Population counts alone cannot prove that brains improved: more sparrows
//! could just mean more seeds. The arena removes that confound. It drops a
//! single genome into a fresh world with a fixed seed, switches off
//! reproduction and death, runs for a fixed number of ticks and counts meals.
//! Comparing evolved genomes against freshly randomised ones in the *same*
//! arena isolates the effect of evolution on behaviour. CI runs this.

use crate::Error;
use crate::agents::Species;
use crate::brain::Topology;
use crate::config::Config;
use crate::genome::Genome;
use crate::retina::Retina;
use crate::rng::Rng;
use crate::world::World;

/// Random-walking herbivores placed in the arena when the subject is a predator.
pub const ARENA_PREY: u32 = 150;

/// Scores of several genomes in the same arena.
#[derive(Clone, Debug, PartialEq)]
pub struct ArenaReport {
    /// One score (meals eaten) per genome, in input order.
    pub scores: Vec<f32>,
    /// Arithmetic mean.
    pub mean: f32,
    /// Median.
    pub median: f32,
}

impl ArenaReport {
    fn from_scores(scores: Vec<f32>) -> Self {
        let mut sorted = scores.clone();
        sorted.sort_by(f32::total_cmp);
        let n = sorted.len();
        let median = if n == 0 {
            0.0
        } else if n % 2 == 0 {
            (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0
        } else {
            sorted[n / 2]
        };
        let mean = if n == 0 {
            0.0
        } else {
            sorted.iter().sum::<f32>() / n as f32
        };
        Self {
            scores,
            mean,
            median,
        }
    }
}

fn arena_config(config: &Config) -> Config {
    let mut cfg = config.clone();
    cfg.world.initial_herbivores = 0;
    cfg.world.initial_predators = 0;
    cfg.evolution.immigration_chance = 0.0;
    cfg
}

/// Meals eaten by `genome` alone in a fixed-seed world over `ticks` ticks.
pub fn arena_score(
    config: &Config,
    species: Species,
    genome: &Genome,
    seed: u64,
    ticks: u32,
) -> Result<f32, Error> {
    let mut world = World::new(arena_config(config), seed)?;
    if species == Species::Predator {
        world.spawn_founders(Species::Herbivore, ARENA_PREY);
    }
    let id = world.introduce(species, genome.clone())?;
    world.set_arena_subject(id);
    world.run(u64::from(ticks));
    let i = world
        .agents()
        .index_of(id)
        .ok_or_else(|| Error::Snapshot("arena subject vanished".into()))?;
    Ok(world.agents().meals[i] as f32)
}

/// Score every genome in the same arena.
pub fn arena_score_many(
    config: &Config,
    species: Species,
    genomes: &[Genome],
    seed: u64,
    ticks: u32,
) -> Result<ArenaReport, Error> {
    let scores = genomes
        .iter()
        .map(|g| arena_score(config, species, g, seed, ticks))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ArenaReport::from_scores(scores))
}

/// Baseline: `samples` freshly randomised founders in the same arena.
pub fn arena_score_random(
    config: &Config,
    species: Species,
    seed: u64,
    ticks: u32,
    samples: u32,
) -> Result<ArenaReport, Error> {
    let topology = Topology::new(
        Retina::input_count(config.brain.retina_cells as usize),
        config.brain.hidden as usize,
    );
    let bounds = &config.species(species).traits;
    let genomes: Vec<Genome> = (0..samples)
        .map(|k| {
            let mut rng =
                Rng::from_seed(seed ^ (u64::from(k) + 1).wrapping_mul(0x9E37_79B9_7F4A_7C15));
            Genome::founder(&mut rng, bounds, &topology)
        })
        .collect();
    arena_score_many(config, species, &genomes, seed, ticks)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arena_is_deterministic_and_subject_survives() {
        let cfg = Config::default();
        let r1 = arena_score_random(&cfg, Species::Herbivore, 4, 300, 3).unwrap();
        let r2 = arena_score_random(&cfg, Species::Herbivore, 4, 300, 3).unwrap();
        assert_eq!(r1, r2);
        assert_eq!(r1.scores.len(), 3);
    }

    #[test]
    fn predator_arena_has_prey() {
        let cfg = Config::default();
        let r = arena_score_random(&cfg, Species::Predator, 4, 200, 2).unwrap();
        assert_eq!(r.scores.len(), 2);
    }

    #[test]
    fn report_statistics() {
        let r = ArenaReport::from_scores(vec![3.0, 1.0, 2.0, 10.0]);
        assert_eq!(r.median, 2.5);
        assert_eq!(r.mean, 4.0);
        let r = ArenaReport::from_scores(vec![]);
        assert_eq!(r.mean, 0.0);
    }

    /// The headline claim of the project, checked slowly. `cargo test -- --ignored`.
    #[test]
    #[ignore = "slow: runs an ecosystem for 40k ticks"]
    fn evolved_sparrows_out_forage_random_ones() {
        let cfg = Config::default();
        let mut world = World::new(cfg.clone(), 1).unwrap();
        world.run(40_000);
        let a = world.agents();
        let evolved: Vec<Genome> = (0..a.len())
            .filter(|&i| a.species_of(i) == Species::Herbivore)
            .step_by(8)
            .take(24)
            .map(|i| a.genome[i].clone())
            .collect();
        assert!(evolved.len() >= 8, "not enough herbivores alive to sample");
        let ev = arena_score_many(&cfg, Species::Herbivore, &evolved, 99, 1500).unwrap();
        let rnd = arena_score_random(&cfg, Species::Herbivore, 99, 1500, 24).unwrap();
        assert!(ev.mean > rnd.mean * 1.5, "evolved {ev:?} vs random {rnd:?}");
    }
}
