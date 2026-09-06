/**
 * The real wasm module, loaded in Node. This is where the browser build is
 * proven to agree with the native one: the checksum after 2,000 ticks of
 * seed 1 is the golden value pinned in the Rust test suite and printed by
 * `rustywings verify --seed 1 --ticks 2000`.
 */

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { initSync, Sim } from '../wasm/rustywings_wasm.js';
import { AGENT_STRIDE, FRAME_HEADER, POINT_STRIDE } from './protocol';
import type { Config, Family, Inspection } from './types';

const GOLDEN_SEED_1_2000 = '1065c218b08af910';

beforeAll(() => {
  const wasm = readFileSync(new URL('../wasm/rustywings_wasm_bg.wasm', import.meta.url));
  initSync({ module: wasm });
});

/** A handful of birds and seeds, so frame layouts are easy to check by hand. */
function tiny(predators = 1): Config {
  const cfg = Sim.defaultConfig() as Config;
  cfg.world.initial_herbivores = 3;
  cfg.world.initial_predators = predators;
  cfg.plants.initial = 5;
  cfg.plants.patches = 2;
  return cfg;
}

describe('Sim', () => {
  it('matches the native golden checksum', { timeout: 60_000 }, () => {
    const sim = new Sim('1', undefined);
    sim.step(2000);
    expect(sim.tick()).toBe(2000);
    expect(sim.checksum()).toBe(GOLDEN_SEED_1_2000);
  });

  it('rejects unknown and invalid config fields by name', () => {
    expect(() => new Sim('1', JSON.stringify({ world: { nope: 1 } }))).toThrow(/unknown field `nope`/);
    const bad = Sim.defaultConfig() as Config;
    bad.plants.capacity = 0;
    expect(() => new Sim('1', JSON.stringify(bad))).toThrow(/plants\.capacity/);
    expect(() => new Sim('zz', undefined)).toThrow(/hexadecimal/);
  });

  it('packs frames with the documented layout', () => {
    const sim = new Sim('2', JSON.stringify(tiny()));
    const id = sim.idAt(1);
    sim.select(id);
    expect(sim.selected()).toBe(id);
    const len = sim.packFrame();
    expect(len).toBe(FRAME_HEADER + 4 * AGENT_STRIDE + 7 * POINT_STRIDE);
    const f = new Float32Array(len);
    sim.copyFrame(f);
    expect(Array.from(f.subarray(0, FRAME_HEADER))).toEqual([4, 5, 2, 1, 0]);
    const row = f.subarray(FRAME_HEADER + AGENT_STRIDE, FRAME_HEADER + 2 * AGENT_STRIDE);
    expect(row[0]).toBeGreaterThanOrEqual(0);
    expect(row[0]).toBeLessThan(1);
    expect(row[5]).toBe(0); // second founder is a sparrow
    expect(row[8]).toBe(0); // founders start at rest
    sim.select(-1);
    expect(sim.packFrame()).toBe(len);
    sim.copyFrame(f);
    expect(f[3]).toBe(-1);
  });

  it("records the selected bird's trail and flags its relatives", () => {
    const sim = new Sim('6', JSON.stringify(tiny(0)));
    const id = sim.idAt(0);
    sim.select(id);
    sim.step(10);
    let len = sim.packFrame();
    const f = new Float32Array(len);
    sim.copyFrame(f);
    expect(f[4]).toBe(10);
    const trail = f.subarray(len - 2 * POINT_STRIDE, len);
    const now = sim.inspect(id) as Inspection;
    expect(trail[2]).toBeCloseTo(now.x, 6);
    expect(trail[3]).toBeCloseTo(now.y, 6);
    expect(sim.refreshRelatives()).toBe(1);
    len = sim.packFrame();
    sim.copyFrame(f);
    expect(f[FRAME_HEADER + 9]).toBe(1); // row 0 is its own relative
    expect(f[FRAME_HEADER + AGENT_STRIDE + 9]).toBe(0);
    sim.select(-1);
    expect(sim.packFrame()).toBe(len - 10 * POINT_STRIDE);
  });

  it('answers family questions once birds have bred', { timeout: 60_000 }, () => {
    const cfg = Sim.defaultConfig() as Config;
    cfg.world.initial_herbivores = 120;
    cfg.world.initial_predators = 12;
    cfg.plants.initial = 400;
    const sim = new Sim('5', JSON.stringify(cfg));
    sim.step(1500);
    let child: Inspection | undefined;
    for (let i = 0; i < sim.agentCount() && !child; i++) {
      const a = sim.inspect(sim.idAt(i)) as Inspection;
      if (a.generation >= 2) child = a;
    }
    expect(child, 'a grandchild exists by tick 1500').toBeDefined();
    const fam = sim.family(child!.id) as Family;
    expect(fam.subject.id).toBe(child!.id);
    expect(fam.ancestors[0]!.id).toBe(child!.parent);
    expect(fam.ancestors.at(-1)!.generation).toBe(0);
    const founder = sim.family(fam.ancestors.at(-1)!.id) as Family;
    expect(founder.living_descendants).toBeGreaterThanOrEqual(1);
    expect(sim.family(1e12)).toBeUndefined();
  });

  it('restores a snapshot bit for bit', () => {
    const sim = new Sim('3', undefined);
    sim.step(100);
    const bytes = sim.snapshot();
    const back = Sim.restore(bytes);
    expect(back.tick()).toBe(100);
    expect(back.checksum()).toBe(sim.checksum());
    sim.step(50);
    back.step(50);
    expect(back.checksum()).toBe(sim.checksum());
    expect(() => Sim.restore(new Uint8Array([1, 2, 3]))).toThrow(/snapshot/);
  });

  it('applies a live config change and refuses a brain change', () => {
    const sim = new Sim('4', undefined);
    const cfg = sim.config() as Config;
    cfg.plants.regrowth *= 2;
    sim.setConfig(JSON.stringify(cfg));
    expect((sim.config() as Config).plants.regrowth).toBeCloseTo(cfg.plants.regrowth, 5);
    cfg.brain.hidden += 1;
    expect(() => sim.setConfig(JSON.stringify(cfg))).toThrow(/brain shape/);
  });

  it('inspects a living bird and returns undefined for a dead one', () => {
    const sim = new Sim('5', undefined);
    const id = sim.idAt(0);
    const a = sim.inspect(id) as Inspection;
    expect(a.id).toBe(id);
    expect(a.weights.length).toBe(30 * 8 + 9 * 2);
    expect(a.retina.length).toBe(29);
    expect(sim.inspect(1e12)).toBeUndefined();
  });

  it('releases a bird from a saved genome file', () => {
    const sim = new Sim('7', JSON.stringify(tiny()));
    const a = sim.inspect(sim.idAt(0)) as Inspection;
    const file = JSON.stringify({ format: 'rustywings-genome', species: a.species, traits: a.traits, weights: a.weights });
    const id = sim.introduce(1, file);
    expect(sim.agentCount()).toBe(5);
    expect((sim.inspect(id) as Inspection).species).toBe('Predator');
    expect(() => sim.introduce(0, JSON.stringify({ traits: a.traits, weights: [1, 2, 3] }))).toThrow(/weights/);
    expect(() => sim.introduce(0, '{"nope":1}')).toThrow(/genome file/);
  });
});
