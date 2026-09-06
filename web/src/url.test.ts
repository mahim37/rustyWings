import { describe, expect, it } from 'vitest';
import { applyPatch, buildUrl, fromBase64Url, parseUrl, toBase64Url } from './url';
import type { Config } from './sim/types';

const defaults = (): Config => ({
  world: { grid_cells: 24, initial_herbivores: 400, initial_predators: 20, max_agents: 20000 },
  plants: { initial: 3000, capacity: 8000, regrowth: 12, patches: 10, patch_radius: 0.05, patch_drift: 0.0002, scatter: 0.1 },
  brain: { retina_cells: 9, hidden: 8 },
  evolution: {
    weight_mutation_rate: 0.05,
    weight_mutation_sigma: 0.3,
    weight_limit: 4,
    trait_mutation_sigma: 0.04,
    immigration_floor: 12,
    immigration_chance: 0.02,
  },
  herbivore: species(),
  predator: species(),
});

function species(): Config['herbivore'] {
  const b = { min: 0, init: 1, max: 2 };
  return {
    basal_cost: 0.00025,
    move_cost: 0.0009,
    sense_cost: 0.0002,
    max_energy: 1,
    food_energy: 0.25,
    eat_radius: 0.006,
    reproduce_threshold: 0.85,
    child_energy: 0.35,
    birth_cost: 0.08,
    maturity_age: 300,
    max_age: 8000,
    max_turn: 0.3,
    max_accel: 0.15,
    traits: { fov_angle: b, fov_range: b, max_speed: b, size: b },
  };
}

describe('parseUrl', () => {
  it('accepts hex seeds with or without 0x', () => {
    expect(parseUrl('?seed=7f3a2c11').seed).toBe('7f3a2c11');
    expect(parseUrl('?seed=0xABC').seed).toBe('abc');
  });
  it('rejects bad seeds', () => {
    expect(parseUrl('?seed=zz').seed).toBeNull();
    expect(parseUrl('?seed=').seed).toBeNull();
    expect(parseUrl('?seed=1234567890abcdef0').seed).toBeNull();
    expect(parseUrl('').seed).toBeNull();
  });
  it('ignores malformed cfg', () => {
    expect(parseUrl('?seed=1&cfg=!!!').patch).toBeNull();
  });
});

describe('buildUrl', () => {
  it('carries only the seed when nothing changed', () => {
    const d = defaults();
    const u = new URL(buildUrl('https://example.test/path?old=1#x', 'abc', d, d));
    expect(u.searchParams.get('seed')).toBe('abc');
    expect(u.searchParams.has('cfg')).toBe(false);
    expect(u.searchParams.has('old')).toBe(false);
    expect(u.hash).toBe('');
  });
  it('round-trips a changed setting through cfg', () => {
    const d = defaults();
    const c = structuredClone(d);
    c.plants.regrowth = 24;
    c.predator.basal_cost = 0.002;
    const u = buildUrl('https://example.test/', 'abc', c, d);
    const parsed = parseUrl(new URL(u).search);
    expect(parsed.seed).toBe('abc');
    expect(parsed.patch).toEqual({ plants: { regrowth: 24 }, predator: { basal_cost: 0.002 } });
    expect(applyPatch(d, parsed.patch)).toEqual(c);
  });
});

describe('base64url', () => {
  it('round-trips unicode without padding characters', () => {
    const s = '{"a":1,"b":"héllo ✓"}';
    const enc = toBase64Url(s);
    expect(enc).not.toMatch(/[+/=]/);
    expect(fromBase64Url(enc)).toBe(s);
  });
});
