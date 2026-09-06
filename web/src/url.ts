/**
 * Shareable links: `?seed=<hex>[&cfg=<base64url JSON diff>]`.
 *
 * The seed alone reproduces a default world exactly. A `cfg` carries only
 * the settings that differ from the defaults, so links stay short and the
 * Rust side still validates every field by name.
 */

import { diffConfig, isEmptyDiff, mergeConfig } from './sim/config';
import type { Config } from './sim/types';

export interface UrlState {
  seed: string | null;
  patch: unknown | null;
}

const SEED_RE = /^(?:0x)?[0-9a-f]{1,16}$/i;

export function parseUrl(search: string): UrlState {
  const p = new URLSearchParams(search);
  const seedRaw = p.get('seed')?.trim() ?? '';
  const seed = SEED_RE.test(seedRaw) ? seedRaw.replace(/^0x/i, '').toLowerCase() : null;
  let patch: unknown = null;
  const cfg = p.get('cfg');
  if (cfg) {
    try {
      patch = JSON.parse(fromBase64Url(cfg));
    } catch {
      patch = null;
    }
  }
  return { seed, patch };
}

export function buildUrl(base: string, seed: string, config: Config, defaults: Config): string {
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  url.searchParams.set('seed', seed);
  const d = diffConfig(config, defaults);
  if (!isEmptyDiff(d)) url.searchParams.set('cfg', toBase64Url(JSON.stringify(d)));
  return url.toString();
}

export function applyPatch(defaults: Config, patch: unknown): Config {
  return patch ? mergeConfig(defaults, patch) : defaults;
}

export function randomSeed(): string {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return (a[0]!.toString(16).padStart(8, '0') + a[1]!.toString(16).padStart(8, '0')).replace(/^0+(?=.)/, '');
}

export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
