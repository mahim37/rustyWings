//! Bird state in struct-of-arrays form.
//!
//! Hot per-tick data (position, heading, speed, energy, species) lives in
//! parallel `Vec`s so the inner loops stream through memory and so the
//! browser can render straight from `Float32Array` views of wasm memory.
//! Cold data (genomes, lineage) sits alongside in ordinary vectors.

use serde::{Deserialize, Serialize};

use crate::genome::{Genome, Traits};

/// Which kind of bird. Stored as `u8` in [`Agents::species`] for zero-copy export.
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Species {
    /// Eats seeds. "Sparrow" in the UI.
    Herbivore = 0,
    /// Eats herbivores. "Hawk" in the UI.
    Predator = 1,
}

impl Species {
    /// Both species, in index order.
    pub const ALL: [Species; 2] = [Species::Herbivore, Species::Predator];

    /// Array index for per-species tables.
    #[inline]
    pub const fn index(self) -> usize {
        self as usize
    }

    /// Inverse of `as u8`. Anything but zero is a predator.
    #[inline]
    pub const fn from_u8(v: u8) -> Species {
        if v == 0 {
            Species::Herbivore
        } else {
            Species::Predator
        }
    }

    /// Human name used by the UI and CLI.
    pub const fn name(self) -> &'static str {
        match self {
            Species::Herbivore => "herbivore",
            Species::Predator => "predator",
        }
    }
}

/// All living birds. Every `Vec` has the same length; index `i` is one bird.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Agents {
    /// Position, `[0, 1)`.
    pub x: Vec<f32>,
    /// Position, `[0, 1)`.
    pub y: Vec<f32>,
    /// Heading in radians from +x toward +y, `[-π, π)`.
    pub heading: Vec<f32>,
    /// Current speed, world units per tick.
    pub speed: Vec<f32>,
    /// Energy, `[0, max_energy]`.
    pub energy: Vec<f32>,
    /// Ticks lived.
    pub age: Vec<u32>,
    /// `Species as u8`.
    pub species: Vec<u8>,
    /// Unique id, never reused within a world.
    pub id: Vec<u64>,
    /// Parent id, or 0 for founders and immigrants.
    pub parent: Vec<u64>,
    /// Founders are generation 0.
    pub generation: Vec<u32>,
    /// Offspring produced so far.
    pub children: Vec<u32>,
    /// Meals eaten so far.
    pub meals: Vec<u32>,
    /// Tick of the last meal, or 0.
    pub last_meal: Vec<u64>,
    /// Heritable material.
    pub genome: Vec<Genome>,
    /// Last retina activation, `inputs` floats per bird. Scratch, rebuilt each
    /// tick; skipped in snapshots.
    #[serde(skip)]
    pub retina: Vec<f32>,
    inputs: usize,
}

/// One bird copied out for inspection (UI inspector, CLI dumps).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AgentView {
    /// Unique id.
    pub id: u64,
    /// Kind.
    pub species: Species,
    /// Position.
    pub x: f32,
    /// Position.
    pub y: f32,
    /// Heading, radians.
    pub heading: f32,
    /// Speed, world units per tick.
    pub speed: f32,
    /// Energy.
    pub energy: f32,
    /// Ticks lived.
    pub age: u32,
    /// Generation number.
    pub generation: u32,
    /// Offspring count.
    pub children: u32,
    /// Meals eaten.
    pub meals: u32,
    /// Tick of last meal, or 0.
    pub last_meal: u64,
    /// Parent id or 0.
    pub parent: u64,
    /// Body traits.
    pub traits: Traits,
}

/// Everything needed to add a bird.
#[derive(Clone, Debug)]
pub(crate) struct NewAgent {
    pub species: Species,
    pub x: f32,
    pub y: f32,
    pub heading: f32,
    pub energy: f32,
    pub id: u64,
    pub parent: u64,
    pub generation: u32,
    pub genome: Genome,
}

impl Agents {
    /// Empty table for brains with `inputs` inputs.
    pub(crate) fn new(inputs: usize) -> Self {
        Self {
            inputs,
            ..Default::default()
        }
    }

    /// Number of living birds.
    #[inline]
    pub fn len(&self) -> usize {
        self.x.len()
    }

    /// `true` when no birds are alive.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.x.is_empty()
    }

    /// Retina floats per bird.
    #[inline]
    pub fn inputs_per_agent(&self) -> usize {
        self.inputs
    }

    /// Species of bird `i`.
    #[inline]
    pub fn species_of(&self, i: usize) -> Species {
        Species::from_u8(self.species[i])
    }

    /// Last retina activation of bird `i`.
    #[inline]
    pub fn retina_of(&self, i: usize) -> &[f32] {
        &self.retina[i * self.inputs..(i + 1) * self.inputs]
    }

    /// Copy bird `i` out.
    pub fn view(&self, i: usize) -> AgentView {
        AgentView {
            id: self.id[i],
            species: self.species_of(i),
            x: self.x[i],
            y: self.y[i],
            heading: self.heading[i],
            speed: self.speed[i],
            energy: self.energy[i],
            age: self.age[i],
            generation: self.generation[i],
            children: self.children[i],
            meals: self.meals[i],
            last_meal: self.last_meal[i],
            parent: self.parent[i],
            traits: self.genome[i].traits,
        }
    }

    /// Index of the bird with `id`, if alive. Linear scan; ids are for
    /// inspection, not hot paths.
    pub fn index_of(&self, id: u64) -> Option<usize> {
        self.id.iter().position(|&v| v == id)
    }

    /// Count living birds per species.
    pub fn counts(&self) -> [u32; 2] {
        let mut c = [0u32; 2];
        for &s in &self.species {
            c[Species::from_u8(s).index()] += 1;
        }
        c
    }

    pub(crate) fn push(&mut self, a: NewAgent) {
        self.x.push(a.x);
        self.y.push(a.y);
        self.heading.push(a.heading);
        self.speed.push(0.0);
        self.energy.push(a.energy);
        self.age.push(0);
        self.species.push(a.species as u8);
        self.id.push(a.id);
        self.parent.push(a.parent);
        self.generation.push(a.generation);
        self.children.push(0);
        self.meals.push(0);
        self.last_meal.push(0);
        self.genome.push(a.genome);
        self.retina.resize(self.x.len() * self.inputs, 0.0);
    }

    /// Remove bird `i` by swapping the last bird into its slot. O(1), keeps
    /// every column aligned.
    pub(crate) fn swap_remove(&mut self, i: usize) {
        let last = self.len() - 1;
        self.x.swap_remove(i);
        self.y.swap_remove(i);
        self.heading.swap_remove(i);
        self.speed.swap_remove(i);
        self.energy.swap_remove(i);
        self.age.swap_remove(i);
        self.species.swap_remove(i);
        self.id.swap_remove(i);
        self.parent.swap_remove(i);
        self.generation.swap_remove(i);
        self.children.swap_remove(i);
        self.meals.swap_remove(i);
        self.last_meal.swap_remove(i);
        self.genome.swap_remove(i);
        if i != last {
            let n = self.inputs;
            let (head, tail) = self.retina.split_at_mut(last * n);
            head[i * n..(i + 1) * n].copy_from_slice(&tail[..n]);
        }
        self.retina.truncate(last * self.inputs);
    }

    /// After deserialisation the retina scratch is empty; size it.
    pub(crate) fn ensure_retina(&mut self) {
        self.retina.resize(self.len() * self.inputs, 0.0);
    }
}
