use lib_genetic_algorithm::Chromosome;
use crate::*;

pub struct AnimalIndividual{
    fitness: f32,
    chromosome: ga::Chromosome
}

impl ga::Individual for AnimalIndividual{
    fn create(chromosome: Chromosome) -> Self {
        Self{
            fitness: 0.0,
            chromosome
        }
    }
    fn chromosome(&self) -> &Chromosome {
        &self.chromosome
    }
    fn fitness(&self) -> f32 {
        self.fitness
    }

}
impl AnimalIndividual {
    pub fn from_animal(animal: &Animal) -> Self {
        Self{
            fitness: animal.satiation as f32,
            chromosome: todo!(),
        }
    }
    pub fn into_animal(self, rng: &mut dyn RngCore) -> Animal{
        todo!()
    }
}