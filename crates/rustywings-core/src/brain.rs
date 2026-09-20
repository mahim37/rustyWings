//! A tiny feed-forward network: retina in, steering out.
//!
//! Weights live in the [`Genome`](crate::Genome), not here; `Brain` is a
//! stateless evaluator so thousands of agents share one set of scratch
//! buffers and no per-agent allocation happens during a tick.

use serde::{Deserialize, Serialize};

use crate::math::{sqrt, tanh};
use crate::rng::Rng;

/// Layer sizes. Fixed for the life of a world because they define the genome
/// length.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Topology {
    /// Input count (retina channels × cells + internal senses).
    pub inputs: usize,
    /// Hidden neuron count.
    pub hidden: usize,
    /// Output count. Always [`Topology::OUTPUTS`].
    pub outputs: usize,
}

impl Topology {
    /// Outputs: `[turn, accelerate]`, each in `[-1, 1]`.
    pub const OUTPUTS: usize = 2;

    /// Build a topology.
    pub fn new(inputs: usize, hidden: usize) -> Self {
        Self {
            inputs,
            hidden,
            outputs: Self::OUTPUTS,
        }
    }

    /// Weights required, including one bias per neuron.
    #[inline]
    pub fn weight_count(&self) -> usize {
        (self.inputs + 1) * self.hidden + (self.hidden + 1) * self.outputs
    }
}

/// Stateless network evaluator. Layout of a weight vector:
/// for each hidden neuron `[bias, w_0 .. w_inputs)`, then for each output
/// neuron `[bias, w_0 .. w_hidden)`. Both layers use `tanh`.
pub struct Brain;

impl Brain {
    /// Fresh weights: zero biases, Gaussian weights scaled by `1/sqrt(fan_in)`
    /// so early activations sit in the responsive part of `tanh`.
    pub fn random_weights(rng: &mut Rng, t: &Topology) -> Vec<f32> {
        let mut w = Vec::with_capacity(t.weight_count());
        let s1 = 1.0 / sqrt(t.inputs as f32);
        for _ in 0..t.hidden {
            w.push(0.0); // bias
            w.extend((0..t.inputs).map(|_| rng.normal() * s1));
        }
        let s2 = 1.0 / sqrt(t.hidden as f32);
        for _ in 0..t.outputs {
            w.push(0.0); // bias
            w.extend((0..t.hidden).map(|_| rng.normal() * s2));
        }
        w
    }

    /// Evaluate. `hidden` is scratch of length `t.hidden`; `out` has length
    /// `t.outputs`. Panics only on caller bugs (wrong lengths).
    #[inline]
    pub fn forward(
        t: &Topology,
        weights: &[f32],
        inputs: &[f32],
        hidden: &mut [f32],
        out: &mut [f32],
    ) {
        debug_assert_eq!(weights.len(), t.weight_count());
        debug_assert_eq!(inputs.len(), t.inputs);
        debug_assert_eq!(hidden.len(), t.hidden);
        debug_assert_eq!(out.len(), t.outputs);

        let (l1, l2) = weights.split_at((t.inputs + 1) * t.hidden);
        for (h, row) in hidden.iter_mut().zip(l1.chunks_exact(t.inputs + 1)) {
            let (bias, ws) = row.split_first().expect("row has bias");
            let mut acc = *bias;
            for (w, x) in ws.iter().zip(inputs) {
                acc += w * x;
            }
            *h = tanh(acc);
        }
        for (o, row) in out.iter_mut().zip(l2.chunks_exact(t.hidden + 1)) {
            let (bias, ws) = row.split_first().expect("row has bias");
            let mut acc = *bias;
            for (w, x) in ws.iter().zip(hidden.iter()) {
                acc += w * x;
            }
            *o = tanh(acc);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_abs_diff_eq;

    #[test]
    fn weight_count_matches_layout() {
        let t = Topology::new(29, 8);
        assert_eq!(t.weight_count(), 30 * 8 + 9 * 2);
        let mut rng = Rng::from_seed(1);
        let w = Brain::random_weights(&mut rng, &t);
        assert_eq!(w.len(), t.weight_count());
        assert_eq!(w[0], 0.0, "hidden bias starts at zero");
        assert_eq!(w[30 * 8], 0.0, "output bias starts at zero");
    }

    #[test]
    fn forward_computes_tanh_layers() {
        let t = Topology::new(2, 2);
        // hidden0 = tanh(0.5 + 1*x0 + 0*x1), hidden1 = tanh(0 + 0*x0 + 1*x1)
        // out0 = tanh(0 + 1*h0 + 0*h1), out1 = tanh(0.1 + 0*h0 + 2*h1)
        let w = [0.5, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.1, 0.0, 2.0];
        let x = [0.25, -0.5];
        let mut h = [0.0; 2];
        let mut o = [0.0; 2];
        Brain::forward(&t, &w, &x, &mut h, &mut o);
        let h0 = tanh(0.75);
        let h1 = tanh(-0.5);
        assert_abs_diff_eq!(h[0], h0, epsilon = 1e-6);
        assert_abs_diff_eq!(h[1], h1, epsilon = 1e-6);
        assert_abs_diff_eq!(o[0], tanh(h0), epsilon = 1e-6);
        assert_abs_diff_eq!(o[1], tanh(0.1 + 2.0 * h1), epsilon = 1e-6);
    }

    #[test]
    fn outputs_are_bounded() {
        let t = Topology::new(4, 3);
        let mut rng = Rng::from_seed(9);
        let w: Vec<f32> = (0..t.weight_count())
            .map(|_| rng.range(-50.0, 50.0))
            .collect();
        let x = [10.0, -10.0, 3.0, 0.0];
        let mut h = [0.0; 3];
        let mut o = [0.0; 2];
        Brain::forward(&t, &w, &x, &mut h, &mut o);
        assert!(o.iter().all(|v| v.abs() <= 1.0));
    }
}
