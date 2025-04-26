/* tslint:disable */
/* eslint-disable */
export class Animal {
  private constructor();
  free(): void;
  x: number;
  y: number;
  rotation: number;
  vision: Float32Array;
}
export class Food {
  private constructor();
  free(): void;
  x: number;
  y: number;
}
export class Simulation {
  free(): void;
  constructor(config: any);
  static default_config(): any;
  config(): any;
  world(): World;
  step(): string | undefined;
  train(): string;
}
export class World {
  private constructor();
  free(): void;
  animals: Animal[];
  foods: Food[];
}
