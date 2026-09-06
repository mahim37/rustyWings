import { describe, expect, it } from 'vitest';
import { diffConfig, mergeConfig } from './config';
import type { Config } from './types';

const base = { world: { grid_cells: 24, max_agents: 20000 }, plants: { regrowth: 12, scatter: 0.1 } } as unknown as Config;

describe('diffConfig', () => {
  it('is empty for equal configs', () => {
    expect(diffConfig(base, structuredClone(base))).toEqual({});
  });
  it('treats f32-rounded values as equal', () => {
    const v = structuredClone(base);
    (v as unknown as { plants: { scatter: number } }).plants.scatter = Math.fround(0.1);
    expect(diffConfig(v, base)).toEqual({});
  });
  it('keeps only changed leaves with their path', () => {
    const v = structuredClone(base);
    (v as unknown as { plants: { regrowth: number } }).plants.regrowth = 6;
    expect(diffConfig(v, base)).toEqual({ plants: { regrowth: 6 } });
  });
});

describe('mergeConfig', () => {
  it('applies nested numbers and leaves the base untouched', () => {
    const out = mergeConfig(base, { plants: { regrowth: 1 } });
    expect((out as unknown as { plants: { regrowth: number } }).plants.regrowth).toBe(1);
    expect((base as unknown as { plants: { regrowth: number } }).plants.regrowth).toBe(12);
  });
  it('passes unknown keys through so the wasm side can reject them by name', () => {
    const out = mergeConfig(base, { plants: { nope: 3 } }) as unknown as { plants: { nope?: number } };
    expect(out.plants.nope).toBe(3);
  });
  it('ignores non-object patches', () => {
    expect(mergeConfig(base, 42)).toEqual(base);
    expect(mergeConfig(base, null)).toEqual(base);
  });
});
