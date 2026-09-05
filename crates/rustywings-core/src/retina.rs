//! How a bird sees: a fan of angular cells across its field of view, one fan
//! per channel (seeds, sparrows, hawks). Each thing in view adds
//! `(range - distance) / range` to the cell it falls in, so closer is brighter.

use crate::math::{fast_atan2, sqrt, wrap_angle};

/// Retina channels: `0` seeds, `1` sparrows, `2` hawks.
pub const CHANNELS: usize = 3;
/// Non-visual inputs appended after the channels: normalised energy, normalised speed.
pub const INTERNAL_INPUTS: usize = 2;

/// Pure geometry of the retina. Stateless; kept as a type for discoverability.
pub struct Retina;

impl Retina {
    /// Total network inputs for a retina with `cells` cells per channel.
    #[inline]
    pub const fn input_count(cells: usize) -> usize {
        CHANNELS * cells + INTERNAL_INPUTS
    }

    /// Map a neighbour at displacement `(dx, dy)` (squared distance `d2`) from
    /// a bird heading `heading` onto a retina cell. Returns the cell index and
    /// the intensity to add, or `None` when the neighbour is out of the field
    /// of view. Callers have already filtered on range.
    #[inline]
    pub fn observe(
        cells: usize,
        fov_angle: f32,
        fov_range: f32,
        heading: f32,
        dx: f32,
        dy: f32,
        d2: f32,
    ) -> Option<(usize, f32)> {
        let rel = wrap_angle(fast_atan2(dy, dx) - heading);
        let half = fov_angle * 0.5;
        if rel < -half || rel > half {
            return None;
        }
        let cell = (((rel + half) / fov_angle) * cells as f32) as usize;
        let cell = cell.min(cells - 1);
        let dist = sqrt(d2);
        let intensity = (fov_range - dist) / fov_range;
        if intensity <= 0.0 {
            None
        } else {
            Some((cell, intensity))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::f32::consts::{FRAC_PI_2, PI, TAU};

    const CELLS: usize = 13;

    /// Render what a bird at the origin sees as a 13-character strip, `#` for
    /// strong, `+` for medium, `.` for faint, space for nothing. Same idea as
    /// the classic shorelark eye tests, kept because it makes failures legible.
    fn see(fov_angle: f32, fov_range: f32, heading: f32, targets: &[(f32, f32)]) -> String {
        let mut cells = [0.0f32; CELLS];
        for &(dx, dy) in targets {
            let d2 = dx * dx + dy * dy;
            if d2 > fov_range * fov_range {
                continue;
            }
            if let Some((c, w)) = Retina::observe(CELLS, fov_angle, fov_range, heading, dx, dy, d2)
            {
                cells[c] += w;
            }
        }
        cells
            .iter()
            .map(|&c| {
                if c >= 0.7 {
                    '#'
                } else if c >= 0.3 {
                    '+'
                } else if c > 0.0 {
                    '.'
                } else {
                    ' '
                }
            })
            .collect()
    }

    #[test]
    fn straight_ahead_lands_in_the_middle_cell() {
        // heading 0 = +x. Target directly ahead at half range.
        assert_eq!(see(FRAC_PI_2, 1.0, 0.0, &[(0.5, 0.0)]), "      +      ");
        // heading +y: target along +y is ahead.
        assert_eq!(
            see(FRAC_PI_2, 1.0, FRAC_PI_2, &[(0.0, 0.5)]),
            "      +      "
        );
    }

    #[test]
    fn closer_is_brighter_and_out_of_range_is_dark() {
        assert_eq!(see(FRAC_PI_2, 1.0, 0.0, &[(0.1, 0.0)]), "      #      ");
        assert_eq!(see(FRAC_PI_2, 1.0, 0.0, &[(0.9, 0.0)]), "      .      ");
        assert_eq!(see(FRAC_PI_2, 1.0, 0.0, &[(1.1, 0.0)]), "             ");
    }

    #[test]
    fn left_and_right_map_to_opposite_ends() {
        // With heading 0 and a wide FOV, a target toward -y (right-hand side
        // in maths coordinates) is a negative relative angle: low cell index.
        let s = see(1.5 * PI, 1.0, 0.0, &[(0.3, -0.3)]);
        let t = see(1.5 * PI, 1.0, 0.0, &[(0.3, 0.3)]);
        let li = s.find(|c| c != ' ').unwrap();
        let ri = t.find(|c| c != ' ').unwrap();
        assert!(li < CELLS / 2 && ri > CELLS / 2, "{s:?} {t:?}");
        assert_eq!(li, CELLS - 1 - ri, "symmetric about the centre");
    }

    #[test]
    fn narrow_fov_hides_things_to_the_side() {
        assert_eq!(see(0.5, 1.0, 0.0, &[(0.3, 0.3)]), "             ");
        assert_ne!(see(TAU, 1.0, 0.0, &[(0.3, 0.3)]), "             ");
    }

    #[test]
    fn full_circle_fov_sees_behind() {
        assert_eq!(
            see(TAU, 1.0, 0.0, &[(-0.5, 0.0)])
                .chars()
                .filter(|&c| c != ' ')
                .count(),
            1
        );
        assert_eq!(see(PI, 1.0, 0.0, &[(-0.5, 0.0)]), "             ");
    }

    #[test]
    fn rotation_shifts_cells() {
        let target = [(0.0, 0.5)];
        let ahead = see(TAU, 1.0, FRAC_PI_2, &target);
        let quarter = see(TAU, 1.0, 0.0, &target);
        assert_ne!(ahead, quarter);
        assert_eq!(ahead, "      +      ");
    }
}
