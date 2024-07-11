mod animal;
mod animal_individual;
mod food;
mod world;
mod eye;

use std::f32::consts::FRAC_PI_4;
use std::f32::consts::FRAC_PI_2;
pub use self::{animal::*, food::*, world::*, eye::*};

use lib_genetic_algorithm as ga;
use lib_neural_network as nn;
use nalgebra as na;
use nalgebra::convert;
use rand::{Rng, RngCore};
use crate::animal_individual::AnimalIndividual;
use self::animal_indiviual::*;


const SPEED_MIN: f32 = 0.0001;
const SPEED_MAX: f32 = 0.0005;

const SPEED_ACCEL: f32 = 0.2;
const ROTATION_ACCEL: f32 = FRAC_PI_2;

const GENERATION_LENGTH: usize = 2500;


pub struct Simulation {
    world: World,
    ga: ga::GeneticAlgorithm<ga::RouletteWheelSelection>,
    age: usize,
}


impl Simulation {
    pub fn random(rng: &mut dyn RngCore) -> Self {
        let world = World::random(rng);
        let ga = ga::GeneticAlgorithm::new(
            ga::RouletteWheelSelection,
            ga::UniformCrossover,
            ga::GaussianMutation::new(0.01, 0.3),
        );

        Self {
            world,
            ga,
            age: 0,
        }
    }
    pub fn world(&self) -> &World {
        &self.world
    }
    pub fn step(&mut self, rng: &mut dyn RngCore) {
        self.process_collisions(rng);
        self.process_brains();
        self.process_movements();

        self.age += 1;
        if self.age > GENERATION_LENGTH{
            self.evolve(rng);
        }
    }
    fn process_movements(&mut self) {
        for animal in &mut self.world.animals {
            animal.position += animal.rotation * na::Vector2::new(0.0, animal.speed);

            animal.position.x = na::wrap(animal.position.x, 0.0, 1.0);
            animal.position.y = na::wrap(animal.position.y, 0.0, 1.0);
        }
    }
    fn process_collisions(&mut self, rng: &mut dyn RngCore) {
        for animal in &mut self.world.animals {
            for food in &mut self.world.foods {
                let distance = na::distance(&animal.position, &food.position);

                if distance <= 0.01 {
                    animal.satiation += 1;
                    food.position = rng.gen();
                }
            }
        }
    }

    fn process_brains(&mut self) {
        for animal in &mut self.world.animals {
            let vision = animal.eye.process_vision(
                animal.position,
                animal.rotation,
                &self.world.foods,
            );

            let response = animal.brain.propagate(vision);

            let speed = response[0].clamp(-SPEED_ACCEL, SPEED_ACCEL);
            let rotation = response[1].clamp(SPEED_MIN, SPEED_MAX);

            animal.speed = (animal.speed + speed).clamp(SPEED_MIN, SPEED_MAX);
            animal.rotation = na::Rotation2::new(animal.rotation().angle() + rotation);
        }
    }
    fn evolve(&mut self, rng: &mut dyn RngCore){
        self.age = 0;

        // Transform Vec<Animal> to Vec<AnimalIndividual>

        let current_population:Vec<_> = self
            .world
            .animals
            .iter()
            .map(AnimalIndividual::from_animal)
            .collect();


        // Evolve this Vec<AnimalIndividual>
        let evolved_population = self.ga.evolve(
            rng,
            &current_population
        );

        // Transform Vec<AnimalIndividual> to Vec<Animal>x
        self.world.animals = evolved_population
            .into_iter()
            .map(|individual| individual.into_animal(rng))
            .collect();

        for food in &mut self.world.foods{
            food.position = rng.gen();
        }
    }
}


#[cfg(test)]
mod test {
    use super::*;
    use rand_chacha::ChaCha8Rng;
    use rand::SeedableRng;

    #[test]
    fn changes_step() {
        let mut rng = ChaCha8Rng::from_seed(Default::default());

        let mut sim = Simulation::random(&mut rng);
        print!("Before -> {:?}", sim.world.animals());
        // Simulation::step(&mut sim, rng);
        print!("\n After -> {:?}", sim.world.animals());
    }
}