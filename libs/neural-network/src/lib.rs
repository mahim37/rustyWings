use rand::{Rng, RngCore};

#[derive(Debug)]
pub struct LayerTopology {
    pub neurons: usize,
}

#[derive(Debug)]
pub struct Network {
    layers: Vec<Layer>,
}

#[derive(Debug)]
struct Layer {
    neurons: Vec<Neuron>,
}

#[derive(Debug)]
struct Neuron {
    bias: f32,
    weights: Vec<f32>,
}

impl Network {
    pub fn propagate(&self, mut inputs: Vec<f32>) -> Vec<f32> {
        for layer in &self.layers {
            inputs = layer.propagate(inputs);
        }
        inputs
    }
    pub fn random(rng: &mut dyn RngCore, layers: &[LayerTopology]) -> Self {
        assert!(layers.len() > 1);
        let mut built_layers = Vec::new();

        for i in 0..(layers.len() - 1) {
            let input_size = layers[i].neurons;
            let output_size = layers[i + 1].neurons;

            built_layers.push(Layer::random(rng, input_size, output_size));
        }
        Self { layers: built_layers }
    }
}

impl Layer {
    fn propagate(&self, inputs: Vec<f32>) -> Vec<f32> {
        let mut outputs = Vec::new();
        for neuron in &self.neurons {
            let output = neuron.propagate(&inputs);
            outputs.push(output);
        }
        outputs
    }
    fn random(rng: &mut dyn RngCore, input_size: usize, output_size: usize) -> Self {
        let mut neurons = Vec::new();
        for _ in 0..output_size {
            neurons.push(Neuron::random(rng, input_size));
        }
        Self { neurons }
    }
}

impl Neuron {
    fn propagate(&self, inputs: &[f32]) -> f32 {
        assert_eq!(inputs.len(), self.weights.len());
        let mut output = 0.0;
        for (&input, &weight) in inputs.iter().zip(&self.weights) {
            output += input * weight;
        }
        (self.bias + output).max(0.0)
    }
    fn random(rng: &mut dyn RngCore, input_size: usize) -> Self {
        let bias = rng.gen_range(-1.00..=1.00);
        let mut weights = Vec::new();
        for _ in 0..input_size {
            let weight = rng.gen_range(-1.00..=1.00);
            weights.push(weight);
        }
        Self { bias, weights }
    }
}


#[cfg(test)]
mod test {
    use super::*;
    use approx::assert_relative_eq;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;


    #[test]
    fn neuron_random() {
        let mut rng = ChaCha8Rng::from_seed(Default::default());
        let neuron = Neuron::random(&mut rng, 4);

        assert_relative_eq!(neuron.bias, -0.6255188);
        assert_relative_eq!(
            neuron.weights.as_slice(),
            &[0.67383957, 0.8181262, 0.26284897, 0.5238807].as_ref()
        );
    }

    #[test]
    fn neuron_propagate() {
        let neuron = Neuron {
            bias: 0.5,
            weights: vec![-0.3, 0.8],
        };
        // Ensures `.max()` (our ReLU) works:
        assert_relative_eq!(
            neuron.propagate(&[-10.0, -10.0]),
            0.0,
        );
        assert_relative_eq!(
            neuron.propagate(&[0.5, 1.0]),
            (-0.3 * 0.5) + (0.8 * 1.0) + 0.5,
        );
    }

    #[test]
    fn network_random(){
        let mut rng = ChaCha8Rng::from_seed(Default::default());
        todo!()
    }
}