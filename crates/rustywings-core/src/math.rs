//! Torus geometry, angle helpers, and the transcendental functions the
//! simulation is allowed to use.
//!
//! Everything non-trivial goes through [`libm`] so that native and wasm builds
//! compute identical bits. `sqrt` is exempt: IEEE 754 requires it to be
//! correctly rounded, so hardware and software agree.

use core::f32::consts::{PI, TAU};

/// Sine via `libm` (bit-identical across targets).
#[inline]
pub fn sin(x: f32) -> f32 {
    libm::sinf(x)
}
/// Cosine via `libm`.
#[inline]
pub fn cos(x: f32) -> f32 {
    libm::cosf(x)
}
/// Two-argument arctangent via `libm`.
#[inline]
pub fn atan2(y: f32, x: f32) -> f32 {
    libm::atan2f(y, x)
}
/// Fast arctangent for `|x| <= 1` (Rajan, Wang, Inkol & Joyal 2006):
/// maximum error about 0.0015 rad. Pure arithmetic, so bit-identical on
/// every target.
#[inline]
fn fast_atan_unit(x: f32) -> f32 {
    let ax = if x < 0.0 { -x } else { x };
    core::f32::consts::FRAC_PI_4 * x - x * (ax - 1.0) * (0.2447 + 0.0663 * ax)
}

/// Fast two-argument arctangent, maximum error about 0.0015 rad (under a
/// tenth of a degree). Used for retina binning, where cells are tens of
/// degrees wide and `libm::atan2f` dominated the per-tick profile.
#[inline]
pub fn fast_atan2(y: f32, x: f32) -> f32 {
    let ax = if x < 0.0 { -x } else { x };
    let ay = if y < 0.0 { -y } else { y };
    if ax == 0.0 && ay == 0.0 {
        return 0.0;
    }
    let (small, large) = if ay > ax { (ax, ay) } else { (ay, ax) };
    let mut r = fast_atan_unit(small / large);
    if ay > ax {
        r = core::f32::consts::FRAC_PI_2 - r;
    }
    if x < 0.0 {
        r = PI - r;
    }
    if y < 0.0 { -r } else { r }
}

/// Hyperbolic tangent via `libm`.
#[inline]
pub fn tanh(x: f32) -> f32 {
    libm::tanhf(x)
}
/// Square root (correctly rounded everywhere, so `std` is fine).
#[inline]
pub fn sqrt(x: f32) -> f32 {
    x.sqrt()
}

/// Wrap a coordinate onto the unit torus `[0, 1)`.
#[inline]
pub fn wrap01(x: f32) -> f32 {
    let w = x - libm::floorf(x);
    // `x - floor(x)` can round to exactly 1.0 for tiny negative x.
    if w >= 1.0 { 0.0 } else { w }
}

/// Shortest signed displacement from `a` to `b` on a unit torus, in `[-0.5, 0.5)`.
#[inline]
pub fn torus_delta(a: f32, b: f32) -> f32 {
    let d = b - a;
    if d >= 0.5 {
        d - 1.0
    } else if d < -0.5 {
        d + 1.0
    } else {
        d
    }
}

/// Wrap an angle into `[-π, π)`.
#[inline]
pub fn wrap_angle(a: f32) -> f32 {
    let a = a - TAU * libm::floorf((a + PI) / TAU);
    // Rounding in the line above can land a hair outside the interval.
    if a >= PI {
        a - TAU
    } else if a < -PI {
        a + TAU
    } else {
        a
    }
}

/// Clamp to `[lo, hi]`, tolerating `lo > hi` by returning `lo`.
#[inline]
pub fn clamp(x: f32, lo: f32, hi: f32) -> f32 {
    if x < lo {
        lo
    } else if x > hi {
        hi
    } else {
        x
    }
}

/// 64-bit FNV-1a over raw bit patterns. Used for world checksums in
/// determinism tests; not a cryptographic hash.
#[derive(Clone, Copy, Debug)]
pub struct Checksum(u64);

impl Default for Checksum {
    fn default() -> Self {
        Self(0xcbf2_9ce4_8422_2325)
    }
}

impl Checksum {
    /// Fresh hasher with the FNV offset basis.
    pub fn new() -> Self {
        Self::default()
    }
    /// Feed one byte.
    #[inline]
    pub fn byte(&mut self, b: u8) {
        self.0 ^= u64::from(b);
        self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
    }
    /// Feed a `u32`.
    #[inline]
    pub fn u32(&mut self, v: u32) {
        for b in v.to_le_bytes() {
            self.byte(b);
        }
    }
    /// Feed a `u64`.
    #[inline]
    pub fn u64(&mut self, v: u64) {
        for b in v.to_le_bytes() {
            self.byte(b);
        }
    }
    /// Feed the exact bit pattern of an `f32` (so `-0.0` and `0.0` differ,
    /// which is what "bit-identical" means).
    #[inline]
    pub fn f32(&mut self, v: f32) {
        self.u32(v.to_bits());
    }
    /// Feed a slice of `f32`.
    pub fn f32s(&mut self, vs: &[f32]) {
        for &v in vs {
            self.f32(v);
        }
    }
    /// Final digest.
    pub fn finish(self) -> u64 {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_abs_diff_eq;

    #[test]
    fn wrap01_covers_edges() {
        assert_eq!(wrap01(0.0), 0.0);
        assert_eq!(wrap01(1.0), 0.0);
        assert_abs_diff_eq!(wrap01(1.25), 0.25);
        assert_abs_diff_eq!(wrap01(-0.25), 0.75);
        assert!(wrap01(-1e-9) < 1.0);
    }

    #[test]
    fn torus_delta_takes_shortest_path() {
        assert_abs_diff_eq!(torus_delta(0.1, 0.2), 0.1);
        assert_abs_diff_eq!(torus_delta(0.9, 0.1), 0.2);
        assert_abs_diff_eq!(torus_delta(0.1, 0.9), -0.2);
        assert_abs_diff_eq!(torus_delta(0.0, 0.5), -0.5);
    }

    #[test]
    fn wrap_angle_lands_in_half_open_pi_range() {
        for &a in &[0.0, PI, -PI, 3.0 * PI, -7.5, 100.0] {
            let w = wrap_angle(a);
            assert!((-PI..PI).contains(&w), "{a} -> {w}");
            assert_abs_diff_eq!(sin(w), sin(a), epsilon = 1e-4);
        }
    }

    #[test]
    fn fast_atan2_is_within_a_tenth_of_a_degree_of_libm() {
        let mut worst = 0.0f32;
        for i in -200..=200 {
            for j in -200..=200 {
                let (y, x) = (i as f32 * 0.013, j as f32 * 0.017);
                let d = wrap_angle(fast_atan2(y, x) - atan2(y, x)).abs();
                if x != 0.0 || y != 0.0 {
                    worst = worst.max(d);
                }
            }
        }
        assert!(worst < 0.0016, "worst error {worst} rad");
        assert_eq!(fast_atan2(0.0, 0.0), 0.0);
        assert_abs_diff_eq!(
            fast_atan2(1.0, 0.0),
            core::f32::consts::FRAC_PI_2,
            epsilon = 2e-3
        );
        assert_abs_diff_eq!(fast_atan2(0.0, -1.0), PI, epsilon = 2e-3);
        assert_abs_diff_eq!(
            fast_atan2(-1.0, 0.0),
            -core::f32::consts::FRAC_PI_2,
            epsilon = 2e-3
        );
    }

    #[test]
    fn checksum_is_order_sensitive_and_stable() {
        let mut a = Checksum::new();
        a.f32s(&[1.0, 2.0]);
        let mut b = Checksum::new();
        b.f32s(&[2.0, 1.0]);
        assert_ne!(a.finish(), b.finish());
        let mut c = Checksum::new();
        c.f32s(&[1.0, 2.0]);
        assert_eq!(a.finish(), c.finish());
    }
}
