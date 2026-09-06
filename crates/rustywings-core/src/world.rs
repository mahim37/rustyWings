//! The world: every tick, in order.
//!
//! ```text
//! build grids → sense → think → eat → move → metabolise → cull → reproduce → immigrate → regrow
//! ```
//!
//! Each phase is a separate method that borrows only the columns it needs, so
//! the borrow checker proves the phases do not alias and each stays a tight
//! loop over contiguous arrays.

use core::f32::consts::PI;

use serde::{Deserialize, Serialize};

use crate::agents::{AgentView, Agents, NewAgent, Species};
use crate::brain::{Brain, Topology};
use crate::config::Config;
use crate::genome::Genome;
use crate::grid::Grid;
use crate::math::{Checksum, clamp, cos, sin, torus_delta, wrap_angle, wrap01};
use crate::plants::Plants;
use crate::retina::{CHANNELS, Retina};
use crate::rng::Rng;
use crate::stats::{SpeciesStats, Stats, TickCounters};
use crate::{Error, VERSION};

const ALIVE: u8 = 0;
const STARVED: u8 = 1;
const AGED: u8 = 2;
const PREDATED: u8 = 3;

/// Per-tick scratch space. Never serialised; sized lazily.
#[derive(Clone, Debug, Default)]
struct Scratch {
    hidden: Vec<f32>,
    out: [f32; 2],
    eaten: Vec<bool>,
    dead: Vec<u8>,
    births: Vec<NewAgent>,
}

/// A running ecosystem.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct World {
    config: Config,
    seed: u64,
    rng: Rng,
    tick: u64,
    next_id: u64,
    topology: Topology,
    plants: Plants,
    agents: Agents,
    totals: [TickCounters; 2],
    last: [TickCounters; 2],
    /// When set, this world is a standardised test arena: nobody dies of
    /// hunger or age, nobody reproduces, nobody immigrates. See [`crate::arena`].
    arena_subject: Option<u64>,
    #[serde(skip)]
    agent_grid: Grid,
    #[serde(skip)]
    plant_grid: Grid,
    #[serde(skip)]
    scratch: Scratch,
}

impl World {
    /// Build a world at tick zero. Fails only if the config is invalid.
    pub fn new(config: Config, seed: u64) -> Result<Self, Error> {
        config.validate()?;
        let mut rng = Rng::from_seed(seed);
        let topology = Topology::new(
            Retina::input_count(config.brain.retina_cells as usize),
            config.brain.hidden as usize,
        );
        let plants = Plants::new(&mut rng, &config.plants);
        let cells = config.world.grid_cells as usize;
        let (herbivores, predators) = (
            config.world.initial_herbivores,
            config.world.initial_predators,
        );
        let mut world = Self {
            agents: Agents::new(topology.inputs),
            config,
            seed,
            rng,
            tick: 0,
            next_id: 1,
            topology,
            plants,
            totals: Default::default(),
            last: Default::default(),
            arena_subject: None,
            agent_grid: Grid::new(cells),
            plant_grid: Grid::new(cells),
            scratch: Scratch::default(),
        };
        world.spawn_founders(Species::Herbivore, herbivores);
        world.spawn_founders(Species::Predator, predators);
        Ok(world)
    }

    /// The configuration this world was built with.
    pub fn config(&self) -> &Config {
        &self.config
    }
    /// The seed this world was built with.
    pub fn seed(&self) -> u64 {
        self.seed
    }
    /// Ticks simulated so far.
    pub fn tick(&self) -> u64 {
        self.tick
    }
    /// Brain shape shared by every bird.
    pub fn topology(&self) -> &Topology {
        &self.topology
    }
    /// Living birds.
    pub fn agents(&self) -> &Agents {
        &self.agents
    }
    /// Living seeds.
    pub fn plants(&self) -> &Plants {
        &self.plants
    }

    /// Replace the configuration of a running world. This is what the UI's
    /// live sliders call. The brain shape is rejected if it differs (it fixes
    /// the genome length); a new grid resolution rebuilds the spatial hashes;
    /// everything else takes effect from the next tick. The number of seed
    /// patches is fixed at creation and ignored here.
    pub fn set_config(&mut self, config: Config) -> Result<(), Error> {
        config.validate()?;
        if config.brain != self.config.brain {
            return Err(Error::InvalidConfig {
                field: "brain",
                reason: "brain shape is fixed for the life of a world".into(),
            });
        }
        if config.world.grid_cells != self.config.world.grid_cells {
            let cells = config.world.grid_cells as usize;
            self.agent_grid = Grid::new(cells);
            self.plant_grid = Grid::new(cells);
        }
        self.config = config;
        Ok(())
    }

    /// Advance one tick.
    pub fn step(&mut self) {
        self.last = [TickCounters::default(); 2];
        let n = self.agents.len();
        self.scratch.dead.clear();
        self.scratch.dead.resize(n, ALIVE);
        self.agent_grid.build(&self.agents.x, &self.agents.y);
        self.plant_grid.build(&self.plants.x, &self.plants.y);
        self.sense();
        self.think();
        self.eat();
        self.advance();
        self.metabolize();
        self.cull();
        if self.arena_subject.is_none() {
            self.reproduce();
            self.immigrate();
        }
        self.plants.regrow(&mut self.rng, &self.config.plants);
        for s in 0..2 {
            self.totals[s].add(&self.last[s]);
        }
        self.tick += 1;
    }

    /// Advance `ticks` ticks.
    pub fn run(&mut self, ticks: u64) {
        for _ in 0..ticks {
            self.step();
        }
    }

    /// Add `n` birds with fresh random genomes at random positions. Returns
    /// how many were added (fewer if the population cap was hit).
    pub fn spawn_founders(&mut self, species: Species, n: u32) -> u32 {
        let mut added = 0;
        for _ in 0..n {
            if self.agents.len() >= self.config.world.max_agents as usize {
                break;
            }
            let p = self.config.species(species);
            let genome = Genome::founder(&mut self.rng, &p.traits, &self.topology);
            let energy = 0.6 * p.max_energy;
            let (x, y, heading) = (self.rng.f32(), self.rng.f32(), self.rng.angle());
            self.push_agent(NewAgent {
                species,
                x,
                y,
                heading,
                energy,
                id: 0,
                parent: 0,
                generation: 0,
                genome,
            });
            added += 1;
        }
        added
    }

    /// Add one bird with a specific genome at a random position. Used by the
    /// arena and by "import genome". Fails if the genome does not fit this
    /// world's brain topology.
    pub fn introduce(&mut self, species: Species, genome: Genome) -> Result<u64, Error> {
        let expected = self.topology.weight_count();
        if genome.weights.len() != expected {
            return Err(Error::GenomeShape {
                expected,
                actual: genome.weights.len(),
            });
        }
        let p = self.config.species(species);
        let energy = 0.6 * p.max_energy;
        let (x, y, heading) = (self.rng.f32(), self.rng.f32(), self.rng.angle());
        Ok(self.push_agent(NewAgent {
            species,
            x,
            y,
            heading,
            energy,
            id: 0,
            parent: 0,
            generation: 0,
            genome,
        }))
    }

    pub(crate) fn set_arena_subject(&mut self, id: u64) {
        self.arena_subject = Some(id);
    }

    fn push_agent(&mut self, mut a: NewAgent) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        a.id = id;
        self.agents.push(a);
        id
    }

    // ----- phases -------------------------------------------------------

    fn sense(&mut self) {
        let Self {
            agents,
            plants,
            agent_grid,
            plant_grid,
            config,
            topology,
            ..
        } = self;
        let cells = config.brain.retina_cells as usize;
        let inputs = topology.inputs;
        let Agents {
            x,
            y,
            heading,
            speed,
            energy,
            species,
            genome,
            retina,
            ..
        } = agents;
        let xs: &[f32] = x;
        let ys: &[f32] = y;
        for i in 0..xs.len() {
            let row = &mut retina[i * inputs..(i + 1) * inputs];
            row.fill(0.0);
            let t = &genome[i].traits;
            let (px, py, h) = (xs[i], ys[i], heading[i]);
            plant_grid.for_each_within(
                &plants.x,
                &plants.y,
                px,
                py,
                t.fov_range,
                |_, dx, dy, d2| {
                    if let Some((c, w)) =
                        Retina::observe(cells, t.fov_angle, t.fov_range, h, dx, dy, d2)
                    {
                        row[c] += w;
                    }
                },
            );
            agent_grid.for_each_within(xs, ys, px, py, t.fov_range, |j, dx, dy, d2| {
                let j = j as usize;
                if j == i {
                    return;
                }
                if let Some((c, w)) =
                    Retina::observe(cells, t.fov_angle, t.fov_range, h, dx, dy, d2)
                {
                    row[(1 + Species::from_u8(species[j]).index()) * cells + c] += w;
                }
            });
            for v in &mut row[..CHANNELS * cells] {
                if *v > 2.0 {
                    *v = 2.0;
                }
            }
            let sp = config.species(Species::from_u8(species[i]));
            row[CHANNELS * cells] = energy[i] / sp.max_energy;
            row[CHANNELS * cells + 1] = if t.max_speed > 0.0 {
                speed[i] / t.max_speed
            } else {
                0.0
            };
        }
    }

    fn think(&mut self) {
        let Self {
            agents,
            config,
            topology,
            scratch,
            ..
        } = self;
        let inputs = topology.inputs;
        scratch.hidden.resize(topology.hidden, 0.0);
        let Agents {
            heading,
            speed,
            species,
            genome,
            retina,
            ..
        } = agents;
        for i in 0..heading.len() {
            let g = &genome[i];
            Brain::forward(
                topology,
                &g.weights,
                &retina[i * inputs..(i + 1) * inputs],
                &mut scratch.hidden,
                &mut scratch.out,
            );
            let sp = config.species(Species::from_u8(species[i]));
            heading[i] = wrap_angle(heading[i] + scratch.out[0] * sp.max_turn);
            speed[i] = clamp(
                speed[i] + scratch.out[1] * sp.max_accel * g.traits.max_speed,
                0.0,
                g.traits.max_speed,
            );
        }
    }

    fn eat(&mut self) {
        let Self {
            agents,
            plants,
            agent_grid,
            plant_grid,
            config,
            scratch,
            tick,
            last,
            ..
        } = self;
        scratch.eaten.clear();
        scratch.eaten.resize(plants.len(), false);
        let Scratch { eaten, dead, .. } = scratch;
        let Agents {
            x,
            y,
            energy,
            species,
            genome,
            meals,
            last_meal,
            ..
        } = agents;
        let xs: &[f32] = x;
        let ys: &[f32] = y;
        for i in 0..xs.len() {
            if dead[i] != ALIVE {
                continue;
            }
            let sp = Species::from_u8(species[i]);
            let p = config.species(sp);
            let r = p.eat_radius * genome[i].traits.size;
            let mut best: Option<(usize, f32)> = None;
            match sp {
                Species::Herbivore => {
                    plant_grid.for_each_within(
                        &plants.x,
                        &plants.y,
                        xs[i],
                        ys[i],
                        r,
                        |j, _, _, d2| {
                            let j = j as usize;
                            if !eaten[j] && best.is_none_or(|(_, bd)| d2 < bd) {
                                best = Some((j, d2));
                            }
                        },
                    );
                    match best {
                        Some((j, _)) => eaten[j] = true,
                        None => continue,
                    }
                }
                Species::Predator => {
                    agent_grid.for_each_within(xs, ys, xs[i], ys[i], r, |j, _, _, d2| {
                        let j = j as usize;
                        if j != i
                            && dead[j] == ALIVE
                            && species[j] == Species::Herbivore as u8
                            && best.is_none_or(|(_, bd)| d2 < bd)
                        {
                            best = Some((j, d2));
                        }
                    });
                    match best {
                        Some((j, _)) => dead[j] = PREDATED,
                        None => continue,
                    }
                }
            }
            energy[i] = (energy[i] + p.food_energy).min(p.max_energy);
            meals[i] += 1;
            last_meal[i] = *tick;
            last[sp.index()].meals += 1;
        }
        plants.remove_marked(eaten);
    }

    fn advance(&mut self) {
        let Agents {
            x,
            y,
            heading,
            speed,
            ..
        } = &mut self.agents;
        let dead = &self.scratch.dead;
        for i in 0..x.len() {
            if dead[i] != ALIVE {
                continue;
            }
            x[i] = wrap01(x[i] + cos(heading[i]) * speed[i]);
            y[i] = wrap01(y[i] + sin(heading[i]) * speed[i]);
        }
    }

    fn metabolize(&mut self) {
        let Self {
            agents,
            config,
            scratch,
            arena_subject,
            ..
        } = self;
        let arena = arena_subject.is_some();
        let Agents {
            speed,
            energy,
            age,
            species,
            genome,
            ..
        } = agents;
        for i in 0..energy.len() {
            if scratch.dead[i] != ALIVE {
                continue;
            }
            let p = config.species(Species::from_u8(species[i]));
            let t = &genome[i].traits;
            let speed_ratio = speed[i] / p.traits.max_speed.init;
            let range_ratio = t.fov_range / p.traits.fov_range.init;
            let cost = p.basal_cost
                + p.move_cost * speed_ratio * speed_ratio * t.size
                + p.sense_cost * (t.fov_angle / PI) * range_ratio;
            energy[i] -= cost;
            age[i] += 1;
            if arena {
                if energy[i] < 0.0 {
                    energy[i] = 0.0;
                }
                continue;
            }
            if energy[i] <= 0.0 {
                scratch.dead[i] = STARVED;
            } else if age[i] > p.max_age {
                scratch.dead[i] = AGED;
            }
        }
    }

    /// Remove the dead. Walks indices downward so `swap_remove` only ever
    /// moves an already-processed bird.
    fn cull(&mut self) {
        for i in (0..self.agents.len()).rev() {
            let d = self.scratch.dead[i];
            if d == ALIVE {
                continue;
            }
            let s = self.agents.species_of(i).index();
            match d {
                STARVED => self.last[s].deaths_starved += 1,
                AGED => self.last[s].deaths_aged += 1,
                _ => self.last[s].deaths_predated += 1,
            }
            self.agents.swap_remove(i);
        }
    }

    fn reproduce(&mut self) {
        let Self {
            agents,
            config,
            scratch,
            rng,
            last,
            ..
        } = self;
        let n = agents.len();
        let mut room = (config.world.max_agents as usize).saturating_sub(n);
        let Agents {
            x,
            y,
            energy,
            age,
            species,
            genome,
            children,
            id,
            generation,
            ..
        } = agents;
        let births = &mut scratch.births;
        for i in 0..n {
            if room == 0 {
                break;
            }
            let sp = Species::from_u8(species[i]);
            let p = config.species(sp);
            if energy[i] < p.reproduce_threshold || age[i] < p.maturity_age {
                continue;
            }
            energy[i] -= p.child_energy + p.birth_cost;
            children[i] += 1;
            room -= 1;
            last[sp.index()].births += 1;
            let child = genome[i].mutated(rng, &config.evolution, &p.traits);
            births.push(NewAgent {
                species: sp,
                x: wrap01(x[i] + rng.normal() * 0.01),
                y: wrap01(y[i] + rng.normal() * 0.01),
                heading: rng.angle(),
                energy: p.child_energy,
                id: 0,
                parent: id[i],
                generation: generation[i] + 1,
                genome: child,
            });
        }
        let mut births = core::mem::take(&mut self.scratch.births);
        for b in births.drain(..) {
            self.push_agent(b);
        }
        self.scratch.births = births;
    }

    fn immigrate(&mut self) {
        let chance = self.config.evolution.immigration_chance;
        let floor = self.config.evolution.immigration_floor;
        if chance <= 0.0 {
            return;
        }
        let counts = self.agents.counts();
        for sp in Species::ALL {
            if counts[sp.index()] < floor
                && self.rng.chance(chance)
                && self.spawn_founders(sp, 1) == 1
            {
                self.last[sp.index()].immigrants += 1;
            }
        }
    }

    // ----- observation --------------------------------------------------

    /// Aggregate numbers for charts and logs. O(agents).
    pub fn stats(&self) -> Stats {
        Stats {
            tick: self.tick,
            plants: self.plants.len() as u32,
            species: [
                SpeciesStats::compute(&self.agents, Species::Herbivore),
                SpeciesStats::compute(&self.agents, Species::Predator),
            ],
            last_tick: self.last,
            totals: self.totals,
        }
    }

    /// Copy of bird `i` for inspection.
    pub fn inspect(&self, i: usize) -> AgentView {
        self.agents.view(i)
    }

    /// Index of the bird nearest `(x, y)` within `radius`, for click-to-select.
    pub fn agent_at(&self, x: f32, y: f32, radius: f32) -> Option<usize> {
        let r2 = radius * radius;
        let mut best: Option<(usize, f32)> = None;
        for i in 0..self.agents.len() {
            let dx = torus_delta(x, self.agents.x[i]);
            let dy = torus_delta(y, self.agents.y[i]);
            let d2 = dx * dx + dy * dy;
            if d2 <= r2 && best.is_none_or(|(_, bd)| d2 < bd) {
                best = Some((i, d2));
            }
        }
        best.map(|(i, _)| i)
    }

    /// Remove every bird and seed within `radius` of `(x, y)`. A meteor.
    /// Returns the number of birds removed. These deaths are not attributed
    /// to any natural cause in the counters.
    pub fn strike(&mut self, x: f32, y: f32, radius: f32) -> u32 {
        let r2 = radius * radius;
        let mut removed = 0;
        for i in (0..self.agents.len()).rev() {
            let dx = torus_delta(x, self.agents.x[i]);
            let dy = torus_delta(y, self.agents.y[i]);
            if dx * dx + dy * dy <= r2 {
                self.agents.swap_remove(i);
                removed += 1;
            }
        }
        for i in (0..self.plants.len()).rev() {
            let dx = torus_delta(x, self.plants.x[i]);
            let dy = torus_delta(y, self.plants.y[i]);
            if dx * dx + dy * dy <= r2 {
                self.plants.swap_remove(i);
            }
        }
        removed
    }

    /// Sprout up to `n` extra seeds (respecting capacity).
    pub fn scatter_plants(&mut self, n: u32) -> u32 {
        let mut added = 0;
        for _ in 0..n {
            if self.plants.len() as u32 >= self.config.plants.capacity {
                break;
            }
            self.plants.sprout(&mut self.rng, &self.config.plants);
            added += 1;
        }
        added
    }

    /// Order-sensitive digest of all simulation state. Two worlds with equal
    /// checksums have identical futures.
    pub fn checksum(&self) -> u64 {
        let mut h = Checksum::new();
        h.u64(self.tick);
        h.u64(self.next_id);
        for s in self.rng.state() {
            h.u64(s);
        }
        h.u32(self.plants.len() as u32);
        h.f32s(&self.plants.x);
        h.f32s(&self.plants.y);
        for &(px, py) in &self.plants.patches {
            h.f32(px);
            h.f32(py);
        }
        h.u32(self.agents.len() as u32);
        h.f32s(&self.agents.x);
        h.f32s(&self.agents.y);
        h.f32s(&self.agents.heading);
        h.f32s(&self.agents.speed);
        h.f32s(&self.agents.energy);
        for &id in &self.agents.id {
            h.u64(id);
        }
        h.finish()
    }

    // ----- snapshots ----------------------------------------------------

    /// Serialise the whole world. Compact binary (postcard); the browser
    /// stores it in IndexedDB, the CLI writes it to a file.
    pub fn to_snapshot(&self) -> Vec<u8> {
        postcard::to_allocvec(&EnvelopeRef {
            magic: MAGIC,
            version: VERSION,
            world: self,
        })
        .expect("serialising to an in-memory buffer cannot fail")
    }

    /// Restore a world from [`World::to_snapshot`] output. Rejects snapshots
    /// from an incompatible crate version rather than silently misreading them.
    pub fn from_snapshot(bytes: &[u8]) -> Result<World, Error> {
        let env: EnvelopeOwned = postcard::from_bytes(bytes)
            .map_err(|e| Error::Snapshot(format!("could not decode: {e}")))?;
        if env.magic != MAGIC {
            return Err(Error::Snapshot("not a rustyWings snapshot".into()));
        }
        if !compatible(&env.version) {
            return Err(Error::Snapshot(format!(
                "written by version {}, this is {VERSION}",
                env.version
            )));
        }
        let mut world = env.world;
        world.config.validate()?;
        world.init_transient();
        Ok(world)
    }

    fn init_transient(&mut self) {
        let cells = self.config.world.grid_cells as usize;
        self.agent_grid = Grid::new(cells);
        self.plant_grid = Grid::new(cells);
        self.agents.ensure_retina();
        self.scratch = Scratch::default();
    }
}

const MAGIC: u32 = 0x5257_534E; // "RWSN"

#[derive(Serialize)]
struct EnvelopeRef<'a> {
    magic: u32,
    version: &'a str,
    world: &'a World,
}

#[derive(Deserialize)]
struct EnvelopeOwned {
    magic: u32,
    version: String,
    world: World,
}

/// Same major and minor version.
fn compatible(v: &str) -> bool {
    let mm = |s: &str| {
        let mut it = s.split('.');
        (
            it.next().unwrap_or("").to_owned(),
            it.next().unwrap_or("").to_owned(),
        )
    };
    mm(v) == mm(VERSION)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn small() -> Config {
        let mut c = Config::default();
        c.world.initial_herbivores = 120;
        c.world.initial_predators = 12;
        c.plants.initial = 400;
        c
    }

    /// Pinned checksum for seed 1 after 2000 ticks. CI runs this on Linux,
    /// macOS and Windows: if it passes everywhere, a seed means the same
    /// world on every platform. Any deliberate change to simulation behaviour
    /// or default parameters must update this value (see CLAUDE.md), and the
    /// commit message should say so.
    #[test]
    fn golden_checksum_seed_1_2000_ticks() {
        let mut w = World::new(Config::default(), 1).unwrap();
        w.run(2000);
        assert_eq!(format!("{:016x}", w.checksum()), "1065c218b08af910");
    }

    #[test]
    fn same_seed_same_future() {
        let mut a = World::new(small(), 7).unwrap();
        let mut b = World::new(small(), 7).unwrap();
        a.run(400);
        b.run(400);
        assert_eq!(a.checksum(), b.checksum());
        let mut c = World::new(small(), 8).unwrap();
        c.run(400);
        assert_ne!(a.checksum(), c.checksum());
    }

    #[test]
    fn snapshot_resumes_bit_for_bit() {
        let mut a = World::new(small(), 3).unwrap();
        a.run(250);
        let bytes = a.to_snapshot();
        let mut b = World::from_snapshot(&bytes).unwrap();
        assert_eq!(a.checksum(), b.checksum());
        a.run(250);
        b.run(250);
        assert_eq!(a.checksum(), b.checksum());
        assert_eq!(a.tick(), 500);
    }

    #[test]
    fn snapshot_rejects_garbage_and_wrong_magic() {
        assert!(matches!(
            World::from_snapshot(b"hello"),
            Err(Error::Snapshot(_))
        ));
        let w = World::new(small(), 1).unwrap();
        let mut bytes = w.to_snapshot();
        bytes[0] ^= 0xff;
        assert!(matches!(
            World::from_snapshot(&bytes),
            Err(Error::Snapshot(_))
        ));
    }

    #[test]
    fn invariants_hold_over_time() {
        let mut w = World::new(small(), 11).unwrap();
        for _ in 0..600 {
            w.step();
            let a = w.agents();
            for i in 0..a.len() {
                let p = w.config().species(a.species_of(i));
                assert!(
                    a.energy[i] > 0.0 && a.energy[i] <= p.max_energy,
                    "energy {}",
                    a.energy[i]
                );
                assert!((0.0..1.0).contains(&a.x[i]) && (0.0..1.0).contains(&a.y[i]));
                assert!(a.speed[i] >= 0.0 && a.speed[i] <= a.genome[i].traits.max_speed + 1e-6);
                assert!(a.age[i] <= p.max_age);
            }
            assert!(w.plants().len() as u32 <= w.config().plants.capacity);
            assert_eq!(a.retina.len(), a.len() * a.inputs_per_agent());
        }
        let s = w.stats();
        assert_eq!(s.tick, 600);
        assert!(
            s.totals[0].births > 0,
            "sparrows should have bred in 600 ticks"
        );
    }

    #[test]
    fn default_world_does_not_collapse_quickly() {
        let mut w = World::new(Config::default(), 1).unwrap();
        w.run(3000);
        let s = w.stats();
        assert!(
            s.species[0].count > 50,
            "herbivores: {}",
            s.species[0].count
        );
        assert!(s.plants > 0);
    }

    #[test]
    fn ids_are_unique_and_lineage_is_recorded() {
        let mut w = World::new(small(), 5).unwrap();
        w.run(1500);
        let a = w.agents();
        let mut ids = a.id.clone();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), a.len());
        assert!(
            a.generation.iter().any(|&g| g > 0),
            "someone should be second generation"
        );
    }

    #[test]
    fn agent_at_picks_the_nearest_and_strike_removes() {
        let mut w = World::new(small(), 2).unwrap();
        let i = w
            .agent_at(0.5, 0.5, 1.0)
            .expect("someone is within radius 1");
        let (x, y) = (w.agents().x[i], w.agents().y[i]);
        assert_eq!(w.agent_at(x, y, 1e-4), Some(i));
        let before = w.agents().len();
        let removed = w.strike(x, y, 0.05);
        assert!(removed >= 1);
        assert_eq!(w.agents().len(), before - removed as usize);
    }

    #[test]
    fn introduce_rejects_wrong_genome_shape() {
        let mut w = World::new(small(), 2).unwrap();
        let g = Genome {
            traits: w.agents().genome[0].traits,
            weights: vec![0.0; 3],
        };
        assert!(matches!(
            w.introduce(Species::Herbivore, g),
            Err(Error::GenomeShape { .. })
        ));
    }

    #[test]
    fn rejects_invalid_config() {
        let mut c = Config::default();
        c.world.grid_cells = 1;
        assert!(matches!(
            World::new(c, 1),
            Err(Error::InvalidConfig {
                field: "world.grid_cells",
                ..
            })
        ));
    }

    #[test]
    fn set_config_swaps_parameters_and_rejects_brain_changes() {
        let mut w = World::new(small(), 3).unwrap();
        w.run(50);
        let mut c = w.config().clone();
        c.plants.regrowth *= 2.0;
        c.world.grid_cells += 3;
        w.set_config(c.clone()).unwrap();
        assert_eq!(w.config(), &c);
        w.run(50);
        let mut bad = w.config().clone();
        bad.brain.hidden += 1;
        assert!(matches!(
            w.set_config(bad),
            Err(Error::InvalidConfig { field: "brain", .. })
        ));
        let mut invalid = w.config().clone();
        invalid.plants.capacity = 0;
        assert!(w.set_config(invalid).is_err());
        assert_eq!(
            w.config(),
            &c,
            "a rejected config leaves the world untouched"
        );
    }
}
