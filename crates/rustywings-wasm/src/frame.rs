//! Packing the world into one flat `f32` buffer per rendered frame.
//!
//! The simulation runs on a Web Worker and the renderer on the main thread,
//! so render state has to cross a thread boundary once per frame. Rather than
//! serialise objects, the worker copies this buffer into a transferable
//! `ArrayBuffer` and posts it. Everything is `f32` so the renderer can upload
//! slices of it straight into WebGL vertex buffers.
//!
//! Layout, in floats:
//!
//! ```text
//! [agent_count, plant_count, patch_count, selected_index]   header
//! agent_count × [x, y, heading, size, energy, species, fov_angle, fov_range]
//! plant_count × [x, y]
//! patch_count × [x, y]
//! ```
//!
//! `selected_index` is the row of the selected bird, or `-1`. `energy` is the
//! fraction of the species' `max_energy`. `species` is `0` (sparrow) or `1`
//! (hawk) as a float so the whole buffer stays homogeneous.

use rustywings_core::{Species, World};

/// Floats in the header.
pub const HEADER: usize = 4;
/// Floats per bird.
pub const AGENT_STRIDE: usize = 8;
/// Floats per seed and per patch centre.
pub const POINT_STRIDE: usize = 2;

/// Fill `out` with the current frame. `selected` is the id of the bird to
/// flag, if any. The buffer is cleared and grown as needed; it is never
/// shrunk, so a long-lived buffer stops allocating once the population peaks.
pub fn pack(world: &World, selected: Option<u64>, out: &mut Vec<f32>) {
    let agents = world.agents();
    let plants = world.plants();
    let n = agents.len();
    let m = plants.len();
    let p = plants.patches.len();
    out.clear();
    out.reserve(HEADER + n * AGENT_STRIDE + (m + p) * POINT_STRIDE);

    let selected_index = selected
        .and_then(|id| agents.index_of(id))
        .map_or(-1.0, |i| i as f32);
    out.extend_from_slice(&[n as f32, m as f32, p as f32, selected_index]);

    let config = world.config();
    let max_energy = [
        config.species(Species::Herbivore).max_energy,
        config.species(Species::Predator).max_energy,
    ];
    for i in 0..n {
        let species = Species::from_u8(agents.species[i]);
        let t = &agents.genome[i].traits;
        out.extend_from_slice(&[
            agents.x[i],
            agents.y[i],
            agents.heading[i],
            t.size,
            agents.energy[i] / max_energy[species.index()],
            species.index() as f32,
            t.fov_angle,
            t.fov_range,
        ]);
    }
    for i in 0..m {
        out.push(plants.x[i]);
        out.push(plants.y[i]);
    }
    for &(x, y) in &plants.patches {
        out.push(x);
        out.push(y);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rustywings_core::Config;

    fn world() -> World {
        let mut c = Config::default();
        c.world.initial_herbivores = 5;
        c.world.initial_predators = 2;
        c.plants.initial = 30;
        c.plants.patches = 3;
        World::new(c, 7).unwrap()
    }

    #[test]
    fn header_and_lengths_match_the_world() {
        let w = world();
        let mut out = Vec::new();
        pack(&w, None, &mut out);
        assert_eq!(&out[..3], &[7.0, 30.0, 3.0]);
        assert_eq!(out[3], -1.0);
        assert_eq!(out.len(), HEADER + 7 * AGENT_STRIDE + 33 * POINT_STRIDE);
    }

    #[test]
    fn rows_carry_position_species_and_traits() {
        let w = world();
        let mut out = Vec::new();
        pack(&w, None, &mut out);
        let agents = w.agents();
        for i in 0..agents.len() {
            let row = &out[HEADER + i * AGENT_STRIDE..HEADER + (i + 1) * AGENT_STRIDE];
            assert_eq!(row[0], agents.x[i]);
            assert_eq!(row[1], agents.y[i]);
            assert_eq!(row[2], agents.heading[i]);
            assert_eq!(row[3], agents.genome[i].traits.size);
            assert!((0.0..=1.0).contains(&row[4]));
            assert_eq!(row[5], f32::from(agents.species[i]));
            assert_eq!(row[6], agents.genome[i].traits.fov_angle);
            assert_eq!(row[7], agents.genome[i].traits.fov_range);
        }
        let plants = w.plants();
        let base = HEADER + agents.len() * AGENT_STRIDE;
        assert_eq!(out[base], plants.x[0]);
        assert_eq!(out[base + 1], plants.y[0]);
        let pbase = base + plants.len() * POINT_STRIDE;
        assert_eq!((out[pbase], out[pbase + 1]), plants.patches[0]);
    }

    #[test]
    fn selected_index_follows_the_bird_across_removals() {
        let mut w = world();
        let id = w.agents().id[3];
        let mut out = Vec::new();
        pack(&w, Some(id), &mut out);
        assert_eq!(out[3], 3.0);
        // Killing everything at bird 0's position reshuffles rows (swap_remove).
        let (x, y) = (w.agents().x[0], w.agents().y[0]);
        w.strike(x, y, 0.001);
        pack(&w, Some(id), &mut out);
        let idx = w.agents().index_of(id).map_or(-1.0, |i| i as f32);
        assert_eq!(out[3], idx);
        pack(&w, Some(u64::MAX), &mut out);
        assert_eq!(out[3], -1.0, "an id that is not alive selects nothing");
    }

    #[test]
    fn buffer_is_reused_without_shrinking() {
        let w = world();
        let mut out = Vec::with_capacity(10_000);
        pack(&w, None, &mut out);
        assert!(out.capacity() >= 10_000);
    }
}
