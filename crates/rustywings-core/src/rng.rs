//! A small, owned pseudo-random number generator.
//!
//! Why not the `rand` crate? Two reasons that matter for this project:
//!
//! 1. **Reproducibility across time.** A seed in a shared URL must replay the
//!    same world years later. `rand` legitimately changes its distributions
//!    between major versions; a generator we own does not.
//! 2. **Reproducibility across platforms.** The browser and the native CLI must
//!    agree bit-for-bit, so every float we derive from random bits is built
//!    with plain IEEE arithmetic and [`libm`], never platform `libm`.
//!
//! The generator is xoshiro256++ seeded through SplitMix64, which is the
//! standard recommendation of its authors and is more than good enough for a
//! simulation (this is not a cryptographic context).

use serde::{Deserialize, Serialize};

/// xoshiro256++ state. `Clone` + `Serialize` so a snapshot resumes the exact
/// same random stream.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rng {
    s: [u64; 4],
}

#[inline]
fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

impl Rng {
    /// Build a generator from a 64-bit seed. Every seed, including zero,
    /// yields a valid non-degenerate state.
    pub fn from_seed(seed: u64) -> Self {
        let mut sm = seed;
        let s = [
            splitmix64(&mut sm),
            splitmix64(&mut sm),
            splitmix64(&mut sm),
            splitmix64(&mut sm),
        ];
        Self { s }
    }

    /// Raw generator state, for checksums.
    #[inline]
    pub fn state(&self) -> [u64; 4] {
        self.s
    }

    /// Next 64 random bits.
    #[inline]
    pub fn next_u64(&mut self) -> u64 {
        let s = &mut self.s;
        let result = s[0].wrapping_add(s[3]).rotate_left(23).wrapping_add(s[0]);
        let t = s[1] << 17;
        s[2] ^= s[0];
        s[3] ^= s[1];
        s[1] ^= s[2];
        s[0] ^= s[3];
        s[2] ^= t;
        s[3] = s[3].rotate_left(45);
        result
    }

    /// Next 32 random bits (the high half of [`Self::next_u64`]).
    #[inline]
    pub fn next_u32(&mut self) -> u32 {
        (self.next_u64() >> 32) as u32
    }

    /// Uniform `f32` in `[0, 1)` with 24 bits of precision.
    #[inline]
    pub fn f32(&mut self) -> f32 {
        // 24 random bits scaled by 2^-24: exact, uniform, never returns 1.0.
        (self.next_u64() >> 40) as f32 * (1.0 / 16_777_216.0)
    }

    /// Uniform `f32` in `[lo, hi)`.
    #[inline]
    pub fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.f32()
    }

    /// Uniform integer in `[0, n)`. `n` must be non-zero.
    #[inline]
    pub fn below(&mut self, n: u32) -> u32 {
        debug_assert!(n > 0, "Rng::below(0)");
        // Multiply-shift: tiny bias for huge n, irrelevant for our population
        // sizes, and deterministic which is what we actually need.
        ((u64::from(self.next_u32()) * u64::from(n)) >> 32) as u32
    }

    /// `true` with probability `p` (clamped to `[0, 1]`).
    #[inline]
    pub fn chance(&mut self, p: f32) -> bool {
        self.f32() < p
    }

    /// Standard normal sample via Box-Muller. One sample per call; the
    /// second Box-Muller output is deliberately discarded so the generator
    /// has no hidden cache to serialize.
    pub fn normal(&mut self) -> f32 {
        // u1 in (0, 1] so ln never sees zero.
        let u1 = 1.0 - self.f32();
        let u2 = self.f32();
        let r = libm::sqrtf(-2.0 * libm::logf(u1));
        r * libm::cosf(core::f32::consts::TAU * u2)
    }

    /// Random angle in `[-π, π)`.
    #[inline]
    pub fn angle(&mut self) -> f32 {
        self.range(-core::f32::consts::PI, core::f32::consts::PI)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_deterministic_for_a_seed() {
        let mut a = Rng::from_seed(42);
        let mut b = Rng::from_seed(42);
        for _ in 0..1000 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn matches_reference_xoshiro_output() {
        // Reference values computed from the canonical C implementation of
        // splitmix64 + xoshiro256++ with seed 0. If these change, every saved
        // seed in the wild changes meaning.
        let mut r = Rng::from_seed(0);
        assert_eq!(r.next_u64(), 0x53175d61490b23df);
        assert_eq!(r.next_u64(), 0x61da6f3dc380d507);
        assert_eq!(r.next_u64(), 0x5c0fdf91ec9a7bfc);
    }

    #[test]
    fn f32_is_in_unit_interval_and_covers_it() {
        let mut r = Rng::from_seed(7);
        let (mut lo, mut hi) = (1.0f32, 0.0f32);
        for _ in 0..100_000 {
            let x = r.f32();
            assert!((0.0..1.0).contains(&x));
            lo = lo.min(x);
            hi = hi.max(x);
        }
        assert!(lo < 0.001 && hi > 0.999);
    }

    #[test]
    fn below_is_in_range_and_roughly_uniform() {
        let mut r = Rng::from_seed(3);
        let mut hist = [0u32; 7];
        for _ in 0..70_000 {
            hist[r.below(7) as usize] += 1;
        }
        for &h in &hist {
            assert!((9_000..11_000).contains(&h), "bucket {h} far from 10000");
        }
    }

    #[test]
    fn normal_has_unit_moments() {
        let mut r = Rng::from_seed(11);
        let n = 200_000;
        let (mut sum, mut sq) = (0.0f64, 0.0f64);
        for _ in 0..n {
            let x = f64::from(r.normal());
            sum += x;
            sq += x * x;
        }
        let mean = sum / n as f64;
        let var = sq / n as f64 - mean * mean;
        assert!(mean.abs() < 0.01, "mean {mean}");
        assert!((var - 1.0).abs() < 0.02, "variance {var}");
    }

    #[test]
    fn serializes_and_resumes_identically() {
        let mut a = Rng::from_seed(99);
        for _ in 0..10 {
            a.next_u64();
        }
        let bytes = postcard::to_allocvec(&a).unwrap();
        let mut b: Rng = postcard::from_bytes(&bytes).unwrap();
        for _ in 0..100 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }
}
