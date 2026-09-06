/** Plain-object helpers for configs: clone, deep diff and deep merge. */

import type { Config } from './types';

type Plain = { [k: string]: number | Plain };

export function cloneConfig(c: Config): Config {
  return structuredClone(c);
}

/**
 * The subset of `value` that differs from `base`, keeping the nesting. Numbers
 * are compared after rounding to float32, because the values came out of
 * Rust as f32 and would otherwise never compare equal to a JS literal.
 */
export function diffConfig(value: Config, base: Config): Partial<Config> {
  return diff(value as unknown as Plain, base as unknown as Plain) as Partial<Config>;
}

function diff(value: Plain, base: Plain): Plain {
  const out: Plain = {};
  for (const key of Object.keys(value)) {
    const v = value[key];
    const b = base[key];
    if (typeof v === 'number') {
      if (typeof b !== 'number' || Math.fround(v) !== Math.fround(b)) out[key] = v;
    } else if (v !== undefined) {
      const inner = diff(v, typeof b === 'object' && b !== null ? b : {});
      if (Object.keys(inner).length) out[key] = inner;
    }
  }
  return out;
}

/** `base` with every leaf in `patch` applied. Unknown keys are kept so the
 *  Rust side can reject them by name. */
export function mergeConfig(base: Config, patch: unknown): Config {
  const out = cloneConfig(base) as unknown as Plain;
  merge(out, patch);
  return out as unknown as Config;
}

function merge(target: Plain, patch: unknown): void {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return;
  for (const [key, v] of Object.entries(patch as Record<string, unknown>)) {
    const t = target[key];
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      if (typeof t !== 'object' || t === null) target[key] = {};
      merge(target[key] as Plain, v);
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      target[key] = v;
    } else {
      // Not a number: pass it through untouched so the wasm side reports it.
      (target as Record<string, unknown>)[key] = v;
    }
  }
}

export function isEmptyDiff(d: Partial<Config>): boolean {
  return Object.keys(d).length === 0;
}
