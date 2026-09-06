/**
 * TypeScript mirrors of the Rust types that cross the wasm boundary. Field
 * names are the Rust names (snake_case) because the JSON is produced by serde;
 * keeping them identical means the config in a shared link is also a valid
 * `rustywings run --config` file.
 */

export type Species = 0 | 1;
export const HERBIVORE: Species = 0;
export const PREDATOR: Species = 1;

export interface Bound {
  min: number;
  init: number;
  max: number;
}

export interface TraitBounds {
  fov_angle: Bound;
  fov_range: Bound;
  max_speed: Bound;
  size: Bound;
}

export interface SpeciesParams {
  basal_cost: number;
  move_cost: number;
  sense_cost: number;
  max_energy: number;
  food_energy: number;
  eat_radius: number;
  reproduce_threshold: number;
  child_energy: number;
  birth_cost: number;
  maturity_age: number;
  max_age: number;
  max_turn: number;
  max_accel: number;
  traits: TraitBounds;
}

export interface Config {
  world: {
    grid_cells: number;
    initial_herbivores: number;
    initial_predators: number;
    max_agents: number;
  };
  plants: {
    initial: number;
    capacity: number;
    regrowth: number;
    patches: number;
    patch_radius: number;
    patch_drift: number;
    scatter: number;
  };
  brain: {
    retina_cells: number;
    hidden: number;
  };
  evolution: {
    weight_mutation_rate: number;
    weight_mutation_sigma: number;
    weight_limit: number;
    trait_mutation_sigma: number;
    immigration_floor: number;
    immigration_chance: number;
  };
  herbivore: SpeciesParams;
  predator: SpeciesParams;
}

export interface SpeciesStats {
  count: number;
  mean_energy: number;
  mean_age: number;
  mean_generation: number;
  max_generation: number;
  mean_fov_angle: number;
  mean_fov_range: number;
  mean_max_speed: number;
  mean_size: number;
}

export interface TickCounters {
  births: number;
  deaths_starved: number;
  deaths_aged: number;
  deaths_predated: number;
  meals: number;
  immigrants: number;
}

export interface Stats {
  tick: number;
  plants: number;
  species: [SpeciesStats, SpeciesStats];
  last_tick: [TickCounters, TickCounters];
  totals: [TickCounters, TickCounters];
}

export interface Traits {
  fov_angle: number;
  fov_range: number;
  max_speed: number;
  size: number;
}

/** What `Sim.inspect` returns: an `AgentView` plus the bird's brain and eyes. */
export interface Inspection {
  id: number;
  species: 'Herbivore' | 'Predator';
  x: number;
  y: number;
  heading: number;
  speed: number;
  energy: number;
  age: number;
  generation: number;
  children: number;
  meals: number;
  last_meal: number;
  parent: number;
  traits: Traits;
  weights: number[];
  retina: number[];
}

export interface Shape {
  inputs: number;
  hidden: number;
  outputs: number;
  retina_cells: number;
  channels: number;
}

export function speciesIndex(s: Inspection['species']): Species {
  return s === 'Predator' ? PREDATOR : HERBIVORE;
}

export function speciesParams(config: Config, s: Species): SpeciesParams {
  return s === PREDATOR ? config.predator : config.herbivore;
}
