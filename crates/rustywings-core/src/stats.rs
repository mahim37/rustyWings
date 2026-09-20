//! Numbers the UI charts and the CLI prints.

use serde::{Deserialize, Serialize};

use crate::agents::{Agents, Species};

/// Per-species aggregate at one instant.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SpeciesStats {
    /// Living members.
    pub count: u32,
    /// Mean energy.
    pub mean_energy: f32,
    /// Mean age in ticks.
    pub mean_age: f32,
    /// Mean generation number.
    pub mean_generation: f32,
    /// Deepest lineage alive.
    pub max_generation: u32,
    /// Mean field of view, radians.
    pub mean_fov_angle: f32,
    /// Mean sight range.
    pub mean_fov_range: f32,
    /// Mean top speed.
    pub mean_max_speed: f32,
    /// Mean body size.
    pub mean_size: f32,
}

impl SpeciesStats {
    pub(crate) fn compute(agents: &Agents, species: Species) -> Self {
        let mut s = Self::default();
        let (mut e, mut a, mut g, mut fa, mut fr, mut ms, mut sz) =
            (0.0f64, 0.0f64, 0.0f64, 0.0f64, 0.0f64, 0.0f64, 0.0f64);
        for i in 0..agents.len() {
            if agents.species_of(i) != species {
                continue;
            }
            s.count += 1;
            e += f64::from(agents.energy[i]);
            a += f64::from(agents.age[i]);
            g += f64::from(agents.generation[i]);
            s.max_generation = s.max_generation.max(agents.generation[i]);
            let t = &agents.genome[i].traits;
            fa += f64::from(t.fov_angle);
            fr += f64::from(t.fov_range);
            ms += f64::from(t.max_speed);
            sz += f64::from(t.size);
        }
        if s.count > 0 {
            let n = f64::from(s.count);
            s.mean_energy = (e / n) as f32;
            s.mean_age = (a / n) as f32;
            s.mean_generation = (g / n) as f32;
            s.mean_fov_angle = (fa / n) as f32;
            s.mean_fov_range = (fr / n) as f32;
            s.mean_max_speed = (ms / n) as f32;
            s.mean_size = (sz / n) as f32;
        }
        s
    }
}

/// Event counts for one species, either for the last tick or cumulative.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TickCounters {
    /// Births.
    pub births: u32,
    /// Deaths from running out of energy.
    pub deaths_starved: u32,
    /// Deaths from old age.
    pub deaths_aged: u32,
    /// Deaths from being eaten.
    pub deaths_predated: u32,
    /// Meals eaten (seeds for herbivores, herbivores for predators).
    pub meals: u32,
    /// Fresh random individuals added by the rescue rule.
    pub immigrants: u32,
}

impl TickCounters {
    pub(crate) fn add(&mut self, o: &TickCounters) {
        self.births += o.births;
        self.deaths_starved += o.deaths_starved;
        self.deaths_aged += o.deaths_aged;
        self.deaths_predated += o.deaths_predated;
        self.meals += o.meals;
        self.immigrants += o.immigrants;
    }

    /// All deaths.
    pub fn deaths(&self) -> u32 {
        self.deaths_starved + self.deaths_aged + self.deaths_predated
    }
}

/// Snapshot of the world's numbers at one tick.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Stats {
    /// Current tick.
    pub tick: u64,
    /// Living seeds.
    pub plants: u32,
    /// Per-species aggregates, indexed by [`Species::index`].
    pub species: [SpeciesStats; 2],
    /// Events during the most recent tick.
    pub last_tick: [TickCounters; 2],
    /// Events since tick zero.
    pub totals: [TickCounters; 2],
}
