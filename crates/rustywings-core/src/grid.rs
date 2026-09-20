//! Uniform spatial hash on the unit torus, rebuilt every tick with a counting
//! sort. Rebuilding is O(n), allocation-free after warm-up, and produces a
//! deterministic layout, which matters because query order feeds the RNG-free
//! parts of the simulation and must match across platforms.

use crate::math::torus_delta;

/// A rebuilt-per-tick grid over points in `[0, 1)²`.
#[derive(Clone, Debug, Default)]
pub struct Grid {
    n: usize,
    /// `starts[c]..starts[c + 1]` indexes `items` for cell `c`.
    starts: Vec<u32>,
    /// Point indices grouped by cell.
    items: Vec<u32>,
    cursor: Vec<u32>,
}

impl Grid {
    /// Grid with `cells` cells per axis (at least 1).
    pub fn new(cells: usize) -> Self {
        let n = cells.max(1);
        Self {
            n,
            starts: vec![0; n * n + 1],
            items: Vec::new(),
            cursor: vec![0; n * n + 1],
        }
    }

    /// Cells per axis.
    #[inline]
    pub fn cells(&self) -> usize {
        self.n
    }

    #[inline]
    fn coord(&self, v: f32) -> usize {
        // v is in [0, 1) but be robust to 1.0 and NaN from upstream bugs.
        let c = (v * self.n as f32) as i64;
        c.clamp(0, self.n as i64 - 1) as usize
    }

    #[inline]
    fn cell(&self, x: f32, y: f32) -> usize {
        self.coord(y) * self.n + self.coord(x)
    }

    /// Index every point. `xs` and `ys` must have equal length.
    pub fn build(&mut self, xs: &[f32], ys: &[f32]) {
        debug_assert_eq!(xs.len(), ys.len());
        let ncell = self.n * self.n;
        self.starts.clear();
        self.starts.resize(ncell + 1, 0);
        for (&x, &y) in xs.iter().zip(ys) {
            let c = self.cell(x, y);
            self.starts[c + 1] += 1;
        }
        for c in 0..ncell {
            self.starts[c + 1] += self.starts[c];
        }
        self.cursor.clear();
        self.cursor.extend_from_slice(&self.starts);
        self.items.clear();
        self.items.resize(xs.len(), 0);
        for (i, (&x, &y)) in xs.iter().zip(ys).enumerate() {
            let c = self.cell(x, y);
            let slot = self.cursor[c] as usize;
            self.items[slot] = i as u32;
            self.cursor[c] += 1;
        }
    }

    /// Call `f(index, dx, dy, d2)` for every indexed point within `r` of
    /// `(x, y)`, where `(dx, dy)` is the shortest torus displacement from the
    /// query point to the neighbour and `d2` its squared length. Points are
    /// visited in a deterministic order.
    #[inline]
    pub fn for_each_within<F>(&self, xs: &[f32], ys: &[f32], x: f32, y: f32, r: f32, mut f: F)
    where
        F: FnMut(u32, f32, f32, f32),
    {
        let n = self.n as i64;
        let r2 = r * r;
        let span = (r * self.n as f32).ceil() as i64;
        let visit = |this: &Self, c: usize, f: &mut F| {
            for &i in &this.items[this.starts[c] as usize..this.starts[c + 1] as usize] {
                let iu = i as usize;
                let dx = torus_delta(x, xs[iu]);
                let dy = torus_delta(y, ys[iu]);
                let d2 = dx * dx + dy * dy;
                if d2 <= r2 {
                    f(i, dx, dy, d2);
                }
            }
        };
        if 2 * span + 1 >= n {
            for c in 0..(self.n * self.n) {
                visit(self, c, &mut f);
            }
            return;
        }
        let cx = self.coord(x) as i64;
        let cy = self.coord(y) as i64;
        for dy in -span..=span {
            let gy = (cy + dy).rem_euclid(n) as usize;
            for dx in -span..=span {
                let gx = (cx + dx).rem_euclid(n) as usize;
                visit(self, gy * self.n + gx, &mut f);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::Rng;

    fn brute(xs: &[f32], ys: &[f32], x: f32, y: f32, r: f32) -> Vec<u32> {
        let mut v: Vec<u32> = (0..xs.len())
            .filter(|&i| {
                let dx = torus_delta(x, xs[i]);
                let dy = torus_delta(y, ys[i]);
                dx * dx + dy * dy <= r * r
            })
            .map(|i| i as u32)
            .collect();
        v.sort_unstable();
        v
    }

    #[test]
    fn matches_brute_force_for_many_radii_and_grid_sizes() {
        let mut rng = Rng::from_seed(5);
        let n = 3000;
        let xs: Vec<f32> = (0..n).map(|_| rng.f32()).collect();
        let ys: Vec<f32> = (0..n).map(|_| rng.f32()).collect();
        for &cells in &[1usize, 2, 5, 24, 64] {
            let mut g = Grid::new(cells);
            g.build(&xs, &ys);
            for &r in &[0.0, 0.01, 0.07, 0.25, 0.5, 0.8] {
                for _ in 0..20 {
                    let (x, y) = (rng.f32(), rng.f32());
                    let mut got = Vec::new();
                    g.for_each_within(&xs, &ys, x, y, r, |i, dx, dy, d2| {
                        assert!((dx * dx + dy * dy - d2).abs() < 1e-9);
                        got.push(i);
                    });
                    got.sort_unstable();
                    assert_eq!(got, brute(&xs, &ys, x, y, r), "cells={cells} r={r}");
                }
            }
        }
    }

    #[test]
    fn handles_torus_wrap_at_edges() {
        let xs = [0.001, 0.999, 0.5];
        let ys = [0.5, 0.5, 0.999];
        let mut g = Grid::new(10);
        g.build(&xs, &ys);
        let mut got = Vec::new();
        g.for_each_within(&xs, &ys, 0.0, 0.5, 0.01, |i, _, _, _| got.push(i));
        got.sort_unstable();
        assert_eq!(got, vec![0, 1]);
        got.clear();
        g.for_each_within(&xs, &ys, 0.5, 0.0, 0.01, |i, _, _, _| got.push(i));
        assert_eq!(got, vec![2]);
    }

    #[test]
    fn empty_and_single_point_grids_work() {
        let mut g = Grid::new(4);
        g.build(&[], &[]);
        let mut count = 0;
        g.for_each_within(&[], &[], 0.5, 0.5, 1.0, |_, _, _, _| count += 1);
        assert_eq!(count, 0);
        g.build(&[0.25], &[0.75]);
        g.for_each_within(&[0.25], &[0.75], 0.24, 0.76, 0.05, |_, _, _, _| count += 1);
        assert_eq!(count, 1);
    }
}
