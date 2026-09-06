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
import type { Config } from './types';

const GOLDEN_SEED_1_2000 = '1065c218b08af910';

beforeAll(() => {
  const wasm = readFileSync(new URL('../wasm/rustywings_wasm_bg.wasm', import.meta.url));
  initSync({ module: wasm });
});

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
    const cfg = Sim.defaultConfig() as Config;
    cfg.world.initial_herbivores = 3;
    cfg.world.initial_predators = 1;
    cfg.plants.initial = 5;
    cfg.plants.patches = 2;
    const sim = new Sim('2', JSON.stringify(cfg));
    const id = sim.idAt(1);
    const len = sim.packFrame(id);
    expect(len).toBe(FRAME_HEADER + 4 * AGENT_STRIDE + 7 * POINT_STRIDE);
    const f = new Float32Array(len);
    sim.copyFrame(f);
    expect(Array.from(f.subarray(0, 4))).toEqual([4, 5, 2, 1]);
    const row = f.subarray(FRAME_HEADER + AGENT_STRIDE, FRAME_HEADER + 2 * AGENT_STRIDE);
    expect(row[0]).toBeGreaterThanOrEqual(0);
    expect(row[0]).toBeLessThan(1);
    expect(row[5]).toBe(0); // second founder is a sparrow
    expect(sim.packFrame(-1)).toBe(len);
    sim.copyFrame(f);
    expect(f[3]).toBe(-1);
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
    const a = sim.inspect(id);
    expect(a.id).toBe(id);
    expect(a.weights.length).toBe(30 * 8 + 9 * 2);
    expect(a.retina.length).toBe(29);
    expect(sim.inspect(1e12)).toBeUndefined();
  });
});
