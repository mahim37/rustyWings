//! Seeds: points that sprout near drifting patches and vanish when eaten.

use serde::{Deserialize, Serialize};

use crate::config::PlantParams;
use crate::math::wrap01;
use crate::rng::Rng;

/// All living seeds plus the patches they sprout around.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Plants {
    /// Position, `[0, 1)`.
    pub x: Vec<f32>,
    /// Position, `[0, 1)`.
    pub y: Vec<f32>,
    /// Patch centres `(x, y)`.
    pub patches: Vec<(f32, f32)>,
    /// Fractional regrowth carried between ticks.
    accumulator: f32,
}

impl Plants {
    /// Fresh seeds and patches.
    pub(crate) fn new(rng: &mut Rng, p: &PlantParams) -> Self {
        let mut plants = Self {
            patches: (0..p.patches).map(|_| (rng.f32(), rng.f32())).collect(),
            ..Default::default()
        };
        for _ in 0..p.initial {
            plants.sprout(rng, p);
        }
        plants
    }

    /// Number of living seeds.
    #[inline]
    pub fn len(&self) -> usize {
        self.x.len()
    }

    /// `true` when no seeds remain.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.x.is_empty()
    }

    /// Add one seed: uniformly with probability `scatter`, otherwise a
    /// Gaussian offset from a random patch.
    pub(crate) fn sprout(&mut self, rng: &mut Rng, p: &PlantParams) {
        if self.patches.is_empty() || rng.chance(p.scatter) {
            self.x.push(rng.f32());
            self.y.push(rng.f32());
        } else {
            let (px, py) = self.patches[rng.below(self.patches.len() as u32) as usize];
            self.x.push(wrap01(px + rng.normal() * p.patch_radius));
            self.y.push(wrap01(py + rng.normal() * p.patch_radius));
        }
    }

    /// Logistic regrowth toward capacity, then patch drift.
    pub(crate) fn regrow(&mut self, rng: &mut Rng, p: &PlantParams) {
        let cap = p.capacity.max(1) as f32;
        let density = self.len() as f32 / cap;
        if density < 1.0 {
            self.accumulator += p.regrowth * (1.0 - density);
            while self.accumulator >= 1.0 && (self.len() as u32) < p.capacity {
                self.sprout(rng, p);
                self.accumulator -= 1.0;
            }
        }
        if p.patch_drift > 0.0 {
            for (px, py) in &mut self.patches {
                *px = wrap01(*px + rng.normal() * p.patch_drift);
                *py = wrap01(*py + rng.normal() * p.patch_drift);
            }
        }
    }

    /// Remove every seed whose flag is set. Processes indices in descending
    /// order so `swap_remove` never disturbs an index still to be checked.
    pub(crate) fn remove_marked(&mut self, marked: &[bool]) {
        debug_assert_eq!(marked.len(), self.len());
        for i in (0..marked.len()).rev() {
            if marked[i] {
                self.x.swap_remove(i);
                self.y.swap_remove(i);
            }
        }
    }

    /// Remove seed `i`.
    pub(crate) fn swap_remove(&mut self, i: usize) {
        self.x.swap_remove(i);
        self.y.swap_remove(i);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn regrowth_is_logistic_and_capped() {
        let mut rng = Rng::from_seed(1);
        let p = PlantParams {
            initial: 0,
            capacity: 100,
            regrowth: 10.0,
            ..Default::default()
        };
        let mut plants = Plants::new(&mut rng, &p);
        plants.regrow(&mut rng, &p);
        assert_eq!(plants.len(), 10, "empty world sprouts the full rate");
        for _ in 0..1000 {
            plants.regrow(&mut rng, &p);
        }
        assert!(plants.len() <= 100);
        assert!(
            plants.len() >= 95,
            "should approach capacity, got {}",
            plants.len()
        );
    }

    #[test]
    fn remove_marked_removes_exactly_the_marked() {
        let mut rng = Rng::from_seed(2);
        let p = PlantParams {
            initial: 6,
            ..Default::default()
        };
        let mut plants = Plants::new(&mut rng, &p);
        let xs = plants.x.clone();
        plants.remove_marked(&[true, false, true, false, false, true]);
        assert_eq!(plants.len(), 3);
        let mut left = plants.x.clone();
        left.sort_by(f32::total_cmp);
        let mut expected = vec![xs[1], xs[3], xs[4]];
        expected.sort_by(f32::total_cmp);
        assert_eq!(left, expected);
    }
}
