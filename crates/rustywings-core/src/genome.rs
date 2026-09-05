//! What a bird inherits: brain weights plus evolvable body traits.

use serde::{Deserialize, Serialize};

use crate::brain::{Brain, Topology};
use crate::config::EvolutionParams;
use crate::math::clamp;
use crate::rng::Rng;

/// Allowed range and starting value of one trait.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Bound {
    /// Lower clamp.
    pub min: f32,
    /// Value founders start near.
    pub init: f32,
    /// Upper clamp.
    pub max: f32,
}

impl Bound {
    #[inline]
    fn span(&self) -> f32 {
        self.max - self.min
    }
    #[inline]
    fn clamp(&self, v: f32) -> f32 {
        clamp(v, self.min, self.max)
    }
}

/// Bounds for every evolvable trait of a species.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TraitBounds {
    /// Field of view, radians.
    pub fov_angle: Bound,
    /// Sight range, world units.
    pub fov_range: Bound,
    /// Top speed, world units per tick.
    pub max_speed: Bound,
    /// Body size multiplier (affects eat radius and movement cost).
    pub size: Bound,
}

/// A bird's body plan. Every trait has a cost, so none is free to maximise.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Traits {
    /// Field of view, radians.
    pub fov_angle: f32,
    /// Sight range, world units.
    pub fov_range: f32,
    /// Top speed, world units per tick.
    pub max_speed: f32,
    /// Body size multiplier.
    pub size: f32,
}

impl Traits {
    /// Founder traits: the configured `init` values with a little jitter so
    /// the founding population is not a clone army.
    pub fn founder(rng: &mut Rng, b: &TraitBounds) -> Self {
        let jitter = |rng: &mut Rng, bound: &Bound| {
            bound.clamp(bound.init + rng.normal() * 0.05 * bound.span())
        };
        Self {
            fov_angle: jitter(rng, &b.fov_angle),
            fov_range: jitter(rng, &b.fov_range),
            max_speed: jitter(rng, &b.max_speed),
            size: jitter(rng, &b.size),
        }
    }

    /// Mutated copy. `sigma` is relative to each trait's allowed span.
    pub fn mutated(&self, rng: &mut Rng, sigma: f32, b: &TraitBounds) -> Self {
        let m = |rng: &mut Rng, v: f32, bound: &Bound| {
            bound.clamp(v + rng.normal() * sigma * bound.span())
        };
        Self {
            fov_angle: m(rng, self.fov_angle, &b.fov_angle),
            fov_range: m(rng, self.fov_range, &b.fov_range),
            max_speed: m(rng, self.max_speed, &b.max_speed),
            size: m(rng, self.size, &b.size),
        }
    }
}

/// Heritable material: traits plus a flat weight vector laid out as
/// [`Topology`] dictates.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Genome {
    /// Body traits.
    pub traits: Traits,
    /// Brain weights.
    pub weights: Vec<f32>,
}

impl Genome {
    /// A founder: jittered initial traits and a freshly initialised brain.
    pub fn founder(rng: &mut Rng, bounds: &TraitBounds, topology: &Topology) -> Self {
        Self {
            traits: Traits::founder(rng, bounds),
            weights: Brain::random_weights(rng, topology),
        }
    }

    /// Offspring genome: each weight mutates independently with the configured
    /// probability; every trait drifts a little.
    pub fn mutated(&self, rng: &mut Rng, evo: &EvolutionParams, bounds: &TraitBounds) -> Self {
        let limit = evo.weight_limit;
        let weights = self
            .weights
            .iter()
            .map(|&w| {
                if rng.chance(evo.weight_mutation_rate) {
                    clamp(w + rng.normal() * evo.weight_mutation_sigma, -limit, limit)
                } else {
                    w
                }
            })
            .collect();
        Self {
            traits: self.traits.mutated(rng, evo.trait_mutation_sigma, bounds),
            weights,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::SpeciesParams;

    fn topo() -> Topology {
        Topology::new(5, 3)
    }

    #[test]
    fn founder_traits_stay_within_bounds_and_near_init() {
        let mut rng = Rng::from_seed(1);
        let b = SpeciesParams::herbivore().traits;
        for _ in 0..1000 {
            let t = Traits::founder(&mut rng, &b);
            assert!(t.fov_angle >= b.fov_angle.min && t.fov_angle <= b.fov_angle.max);
            assert!((t.size - b.size.init).abs() < 0.5 * b.size.span());
        }
    }

    #[test]
    fn zero_rate_mutation_keeps_weights() {
        let mut rng = Rng::from_seed(2);
        let b = SpeciesParams::herbivore().traits;
        let g = Genome::founder(&mut rng, &b, &topo());
        let evo = EvolutionParams {
            weight_mutation_rate: 0.0,
            trait_mutation_sigma: 0.0,
            ..Default::default()
        };
        let child = g.mutated(&mut rng, &evo, &b);
        assert_eq!(child.weights, g.weights);
        assert_eq!(child.traits, g.traits);
    }

    #[test]
    fn full_rate_mutation_changes_most_weights_and_respects_limit() {
        let mut rng = Rng::from_seed(3);
        let b = SpeciesParams::herbivore().traits;
        let g = Genome::founder(&mut rng, &b, &topo());
        let evo = EvolutionParams {
            weight_mutation_rate: 1.0,
            weight_mutation_sigma: 10.0,
            weight_limit: 1.0,
            ..Default::default()
        };
        let child = g.mutated(&mut rng, &evo, &b);
        let changed = child
            .weights
            .iter()
            .zip(&g.weights)
            .filter(|(a, b)| a != b)
            .count();
        assert!(changed > g.weights.len() * 9 / 10);
        assert!(child.weights.iter().all(|w| w.abs() <= 1.0));
    }
}
