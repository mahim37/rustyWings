//! Simulation parameters.
//!
//! `Config` is a plain data structure with validated defaults. It is
//! deserialised from JSON in the browser (typos are rejected thanks to
//! `deny_unknown_fields`) and from files in the CLI. Every numeric knob has a
//! doc comment explaining its unit; the UI reads these comments to build its
//! tooltips, so keep them human.

use core::f32::consts::{PI, TAU};

use serde::{Deserialize, Serialize};

use crate::Error;
use crate::agents::Species;
use crate::genome::{Bound, TraitBounds};

/// Everything that shapes a world. Two worlds built from the same `Config` and
/// seed are identical forever.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    /// Grid size and starting populations.
    pub world: WorldParams,
    /// How seeds grow and where.
    pub plants: PlantParams,
    /// Neural network shape shared by every bird.
    pub brain: BrainParams,
    /// Mutation and rescue.
    pub evolution: EvolutionParams,
    /// Sparrows.
    pub herbivore: SpeciesParams,
    /// Hawks.
    pub predator: SpeciesParams,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            world: WorldParams::default(),
            plants: PlantParams::default(),
            brain: BrainParams::default(),
            evolution: EvolutionParams::default(),
            herbivore: SpeciesParams::herbivore(),
            predator: SpeciesParams::predator(),
        }
    }
}

/// World-level parameters.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct WorldParams {
    /// Spatial hash cells per axis. More cells = cheaper neighbour queries
    /// for small sight ranges, more overhead for large ones.
    pub grid_cells: u32,
    /// Sparrows at tick zero.
    pub initial_herbivores: u32,
    /// Hawks at tick zero.
    pub initial_predators: u32,
    /// Hard cap on living birds of all species. Reproduction pauses at the cap.
    pub max_agents: u32,
}

impl Default for WorldParams {
    fn default() -> Self {
        Self {
            grid_cells: 24,
            initial_herbivores: 400,
            initial_predators: 20,
            max_agents: 20_000,
        }
    }
}

/// Seed growth.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PlantParams {
    /// Seeds at tick zero.
    pub initial: u32,
    /// Carrying capacity. Regrowth slows linearly toward it (logistic growth).
    pub capacity: u32,
    /// Seeds sprouting per tick when the world is empty of seeds.
    pub regrowth: f32,
    /// Number of fertile patches seeds cluster around.
    pub patches: u32,
    /// Gaussian radius of a patch, in world units (the world is 1.0 wide).
    pub patch_radius: f32,
    /// Per-tick random-walk step of each patch centre. Patches wander slowly
    /// so birds cannot simply memorise a spot.
    pub patch_drift: f32,
    /// Fraction of new seeds scattered uniformly instead of in patches.
    pub scatter: f32,
}

impl Default for PlantParams {
    fn default() -> Self {
        Self {
            initial: 3000,
            capacity: 8000,
            regrowth: 12.0,
            patches: 10,
            patch_radius: 0.05,
            patch_drift: 0.0002,
            scatter: 0.1,
        }
    }
}

/// Neural network shape. Changing either value changes the genome length,
/// so these are fixed for the life of a world.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct BrainParams {
    /// Angular cells in each retina channel.
    pub retina_cells: u32,
    /// Hidden neurons.
    pub hidden: u32,
}

impl Default for BrainParams {
    fn default() -> Self {
        Self {
            retina_cells: 9,
            hidden: 8,
        }
    }
}

/// Mutation and population rescue.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct EvolutionParams {
    /// Probability that any given brain weight mutates at birth.
    pub weight_mutation_rate: f32,
    /// Standard deviation of a weight mutation.
    pub weight_mutation_sigma: f32,
    /// Weights are clamped to `[-limit, limit]`.
    pub weight_limit: f32,
    /// Standard deviation of a trait mutation, as a fraction of the trait's
    /// allowed range.
    pub trait_mutation_sigma: f32,
    /// When a species has fewer living members than this, immigrants with
    /// fresh random genomes may arrive.
    pub immigration_floor: u32,
    /// Per-tick chance of one immigrant while below the floor. Set to zero for
    /// a world where extinction is permanent.
    pub immigration_chance: f32,
}

impl Default for EvolutionParams {
    fn default() -> Self {
        Self {
            weight_mutation_rate: 0.05,
            weight_mutation_sigma: 0.3,
            weight_limit: 4.0,
            trait_mutation_sigma: 0.04,
            immigration_floor: 12,
            immigration_chance: 0.02,
        }
    }
}

/// Everything that differs between sparrows and hawks. Energy is in abstract
/// units where `max_energy` is "full".
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpeciesParams {
    /// Energy burned per tick just for being alive.
    pub basal_cost: f32,
    /// Energy burned per tick when moving at the species' initial top speed
    /// with body size 1. Scales with speed squared and with size.
    pub move_cost: f32,
    /// Energy burned per tick for a 180 degree field of view at the initial
    /// sight range. Scales with angle and range: eyes are not free.
    pub sense_cost: f32,
    /// Energy ceiling.
    pub max_energy: f32,
    /// Energy gained per meal (a seed for sparrows, a sparrow for hawks).
    pub food_energy: f32,
    /// Distance within which food is eaten, at body size 1. Scales with size.
    pub eat_radius: f32,
    /// A bird with at least this much energy (and old enough) reproduces.
    pub reproduce_threshold: f32,
    /// Energy handed to the child.
    pub child_energy: f32,
    /// Extra energy the parent spends giving birth.
    pub birth_cost: f32,
    /// Minimum age (ticks) before reproducing.
    pub maturity_age: u32,
    /// Ticks after which a bird dies of old age.
    pub max_age: u32,
    /// Maximum heading change per tick, radians.
    pub max_turn: f32,
    /// Maximum speed change per tick as a fraction of the bird's top speed.
    pub max_accel: f32,
    /// Allowed ranges and starting values of the evolvable body traits.
    pub traits: TraitBounds,
}

impl SpeciesParams {
    /// Default sparrow.
    pub fn herbivore() -> Self {
        Self {
            basal_cost: 0.00025,
            move_cost: 0.0009,
            sense_cost: 0.0002,
            max_energy: 1.0,
            food_energy: 0.25,
            eat_radius: 0.006,
            reproduce_threshold: 0.85,
            child_energy: 0.35,
            birth_cost: 0.08,
            maturity_age: 300,
            max_age: 8000,
            max_turn: 0.3,
            max_accel: 0.15,
            traits: TraitBounds {
                fov_angle: Bound {
                    min: 0.3,
                    init: PI,
                    max: TAU,
                },
                fov_range: Bound {
                    min: 0.02,
                    init: 0.07,
                    max: 0.25,
                },
                max_speed: Bound {
                    min: 0.0005,
                    init: 0.0025,
                    max: 0.005,
                },
                size: Bound {
                    min: 0.5,
                    init: 1.0,
                    max: 2.0,
                },
            },
        }
    }

    /// Default hawk.
    pub fn predator() -> Self {
        Self {
            basal_cost: 0.0012,
            move_cost: 0.001,
            sense_cost: 0.0002,
            max_energy: 1.0,
            food_energy: 0.2,
            eat_radius: 0.0025,
            reproduce_threshold: 0.92,
            child_energy: 0.3,
            birth_cost: 0.05,
            maturity_age: 800,
            max_age: 7000,
            max_turn: 0.25,
            max_accel: 0.15,
            traits: TraitBounds {
                fov_angle: Bound {
                    min: 0.3,
                    init: 0.6 * PI,
                    max: TAU,
                },
                fov_range: Bound {
                    min: 0.02,
                    init: 0.12,
                    max: 0.3,
                },
                max_speed: Bound {
                    min: 0.0005,
                    init: 0.003,
                    max: 0.005,
                },
                size: Bound {
                    min: 0.5,
                    init: 1.0,
                    max: 2.0,
                },
            },
        }
    }
}

fn positive(field: &'static str, v: f32) -> Result<(), Error> {
    if v.is_finite() && v > 0.0 {
        Ok(())
    } else {
        Err(Error::InvalidConfig {
            field,
            reason: format!("must be a positive finite number, got {v}"),
        })
    }
}

fn non_negative(field: &'static str, v: f32) -> Result<(), Error> {
    if v.is_finite() && v >= 0.0 {
        Ok(())
    } else {
        Err(Error::InvalidConfig {
            field,
            reason: format!("must be a non-negative finite number, got {v}"),
        })
    }
}

fn unit(field: &'static str, v: f32) -> Result<(), Error> {
    if v.is_finite() && (0.0..=1.0).contains(&v) {
        Ok(())
    } else {
        Err(Error::InvalidConfig {
            field,
            reason: format!("must be within [0, 1], got {v}"),
        })
    }
}

fn at_least(field: &'static str, v: u32, min: u32) -> Result<(), Error> {
    if v >= min {
        Ok(())
    } else {
        Err(Error::InvalidConfig {
            field,
            reason: format!("must be at least {min}, got {v}"),
        })
    }
}

fn bound(field: &'static str, b: &Bound, lo: f32, hi: f32) -> Result<(), Error> {
    let ok = b.min.is_finite()
        && b.init.is_finite()
        && b.max.is_finite()
        && lo <= b.min
        && b.min <= b.init
        && b.init <= b.max
        && b.max <= hi;
    if ok {
        Ok(())
    } else {
        Err(Error::InvalidConfig {
            field,
            reason: format!(
                "need {lo} <= min <= init <= max <= {hi}, got min={} init={} max={}",
                b.min, b.init, b.max
            ),
        })
    }
}

impl SpeciesParams {
    fn validate(&self, prefix: &'static str) -> Result<(), Error> {
        // `prefix` is only used to pick the right static field names below;
        // keeping them `&'static str` keeps `Error` allocation-free on the hot path.
        macro_rules! f {
            ($name:literal) => {
                if prefix == "herbivore" {
                    concat!("herbivore.", $name)
                } else {
                    concat!("predator.", $name)
                }
            };
        }
        non_negative(f!("basal_cost"), self.basal_cost)?;
        non_negative(f!("move_cost"), self.move_cost)?;
        non_negative(f!("sense_cost"), self.sense_cost)?;
        positive(f!("max_energy"), self.max_energy)?;
        positive(f!("food_energy"), self.food_energy)?;
        positive(f!("eat_radius"), self.eat_radius)?;
        positive(f!("reproduce_threshold"), self.reproduce_threshold)?;
        positive(f!("child_energy"), self.child_energy)?;
        non_negative(f!("birth_cost"), self.birth_cost)?;
        positive(f!("max_turn"), self.max_turn)?;
        positive(f!("max_accel"), self.max_accel)?;
        at_least(f!("max_age"), self.max_age, 1)?;
        if self.reproduce_threshold > self.max_energy {
            return Err(Error::InvalidConfig {
                field: f!("reproduce_threshold"),
                reason: "cannot exceed max_energy, no bird would ever reproduce".into(),
            });
        }
        if self.child_energy + self.birth_cost > self.reproduce_threshold {
            return Err(Error::InvalidConfig {
                field: f!("child_energy"),
                reason: "child_energy + birth_cost must not exceed reproduce_threshold".into(),
            });
        }
        bound(f!("traits.fov_angle"), &self.traits.fov_angle, 0.01, TAU)?;
        bound(f!("traits.fov_range"), &self.traits.fov_range, 0.001, 0.5)?;
        bound(f!("traits.max_speed"), &self.traits.max_speed, 0.0, 0.05)?;
        bound(f!("traits.size"), &self.traits.size, 0.05, 10.0)?;
        Ok(())
    }
}

impl Config {
    /// Check every field. Returns the first problem found with a dotted field
    /// path, so the UI can highlight the offending control.
    pub fn validate(&self) -> Result<(), Error> {
        at_least("world.grid_cells", self.world.grid_cells, 2)?;
        at_least("world.max_agents", self.world.max_agents, 1)?;
        if self.world.initial_herbivores + self.world.initial_predators > self.world.max_agents {
            return Err(Error::InvalidConfig {
                field: "world.max_agents",
                reason: "initial populations exceed max_agents".into(),
            });
        }
        at_least("plants.capacity", self.plants.capacity, 1)?;
        if self.plants.initial > self.plants.capacity {
            return Err(Error::InvalidConfig {
                field: "plants.initial",
                reason: "exceeds plants.capacity".into(),
            });
        }
        non_negative("plants.regrowth", self.plants.regrowth)?;
        at_least("plants.patches", self.plants.patches, 1)?;
        positive("plants.patch_radius", self.plants.patch_radius)?;
        non_negative("plants.patch_drift", self.plants.patch_drift)?;
        unit("plants.scatter", self.plants.scatter)?;
        at_least("brain.retina_cells", self.brain.retina_cells, 1)?;
        at_least("brain.hidden", self.brain.hidden, 1)?;
        if self.brain.retina_cells > 64 || self.brain.hidden > 256 {
            return Err(Error::InvalidConfig {
                field: "brain",
                reason: "retina_cells <= 64 and hidden <= 256".into(),
            });
        }
        unit(
            "evolution.weight_mutation_rate",
            self.evolution.weight_mutation_rate,
        )?;
        non_negative(
            "evolution.weight_mutation_sigma",
            self.evolution.weight_mutation_sigma,
        )?;
        positive("evolution.weight_limit", self.evolution.weight_limit)?;
        non_negative(
            "evolution.trait_mutation_sigma",
            self.evolution.trait_mutation_sigma,
        )?;
        unit(
            "evolution.immigration_chance",
            self.evolution.immigration_chance,
        )?;
        self.herbivore.validate("herbivore")?;
        self.predator.validate("predator")?;
        Ok(())
    }

    /// Parameters for one species.
    #[inline]
    pub fn species(&self, species: Species) -> &SpeciesParams {
        match species {
            Species::Herbivore => &self.herbivore,
            Species::Predator => &self.predator,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_validate() {
        Config::default()
            .validate()
            .expect("defaults must be valid");
    }

    #[test]
    fn rejects_inconsistent_values_with_a_field_path() {
        let mut c = Config::default();
        c.herbivore.child_energy = 5.0;
        let err = c.validate().unwrap_err();
        assert!(
            matches!(
                err,
                Error::InvalidConfig {
                    field: "herbivore.child_energy",
                    ..
                }
            ),
            "{err}"
        );

        let mut c = Config::default();
        c.plants.initial = c.plants.capacity + 1;
        assert!(matches!(
            c.validate(),
            Err(Error::InvalidConfig {
                field: "plants.initial",
                ..
            })
        ));

        let mut c = Config::default();
        c.predator.traits.fov_angle.init = 100.0;
        assert!(matches!(
            c.validate(),
            Err(Error::InvalidConfig {
                field: "predator.traits.fov_angle",
                ..
            })
        ));
    }

    #[test]
    fn round_trips_through_postcard() {
        let c = Config::default();
        let bytes = postcard::to_allocvec(&c).unwrap();
        let back: Config = postcard::from_bytes(&bytes).unwrap();
        assert_eq!(c, back);
    }
}
