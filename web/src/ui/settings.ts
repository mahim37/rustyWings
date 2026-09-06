/**
 * The four plain-language sliders and how they map onto the config. Every
 * other parameter is still reachable: the whole config travels in shared
 * links and can be copied out as JSON for the CLI.
 */

import { cloneConfig } from '../sim/config';
import type { Config } from '../sim/types';

interface Knob {
  range: string;
  out: string;
  digits: number;
  /** Read the slider position from a config. */
  get: (c: Config, d: Config) => number;
  /** Write the slider position into a config. */
  set: (c: Config, d: Config, v: number) => void;
}

const KNOBS: Knob[] = [
  {
    range: 'r-grow',
    out: 'o-grow',
    digits: 2,
    get: (c, d) => c.plants.regrowth / d.plants.regrowth,
    set: (c, d, v) => {
      c.plants.regrowth = d.plants.regrowth * v;
    },
  },
  {
    range: 'r-mut',
    out: 'o-mut',
    digits: 3,
    get: (c) => c.evolution.weight_mutation_rate,
    set: (c, _d, v) => {
      c.evolution.weight_mutation_rate = v;
    },
  },
  {
    range: 'r-hm',
    out: 'o-hm',
    digits: 2,
    get: (c, d) => c.herbivore.basal_cost / d.herbivore.basal_cost,
    set: (c, d, v) => {
      c.herbivore.basal_cost = d.herbivore.basal_cost * v;
      c.herbivore.move_cost = d.herbivore.move_cost * v;
    },
  },
  {
    range: 'r-pm',
    out: 'o-pm',
    digits: 2,
    get: (c, d) => c.predator.basal_cost / d.predator.basal_cost,
    set: (c, d, v) => {
      c.predator.basal_cost = d.predator.basal_cost * v;
      c.predator.move_cost = d.predator.move_cost * v;
    },
  },
];

export class Settings {
  private current: Config;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly defaults: Config,
    initial: Config,
    private readonly onChange: (config: Config) => void,
  ) {
    this.current = cloneConfig(initial);
    for (const k of KNOBS) {
      const range = document.getElementById(k.range) as HTMLInputElement | null;
      if (!range) continue;
      range.addEventListener('input', () => {
        const v = Number(range.value);
        k.set(this.current, this.defaults, v);
        this.show(k, v);
        // Coalesce slider drags: one config message per 120 ms at most.
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.onChange(cloneConfig(this.current)), 120);
      });
    }
    this.reflect(initial);
  }

  get config(): Config {
    return this.current;
  }

  /** Move the sliders to match `config` (after init or a shared link). */
  reflect(config: Config): void {
    this.current = cloneConfig(config);
    for (const k of KNOBS) {
      const range = document.getElementById(k.range) as HTMLInputElement | null;
      if (!range) continue;
      const v = k.get(this.current, this.defaults);
      range.value = String(v);
      this.show(k, Number(range.value));
    }
  }

  reset(): void {
    this.reflect(this.defaults);
    this.onChange(cloneConfig(this.defaults));
  }

  private show(k: Knob, v: number): void {
    const out = document.getElementById(k.out);
    if (out) out.textContent = v.toFixed(k.digits) + (k.digits === 2 ? '×' : '');
  }
}
