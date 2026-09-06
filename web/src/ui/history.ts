/**
 * Stats samples over time, and the windowed, downsampled series the charts
 * draw. Samples arrive every `SAMPLE_STRIDE` ticks regardless of simulation
 * speed, so a chart window is a span of ticks, not of wall-clock time.
 */

import type { Stats } from '../sim/types';

export type SeriesKey =
  | 'herb'
  | 'pred'
  | 'plants'
  | 'fovH'
  | 'fovP'
  | 'rangeH'
  | 'rangeP'
  | 'speedH'
  | 'speedP'
  | 'births'
  | 'deaths'
  | 'predated';

export interface Sample extends Record<SeriesKey, number> {
  tick: number;
}

export function toSample(s: Stats): Sample {
  const [h, p] = s.species;
  const [th, tp] = s.totals;
  return {
    tick: s.tick,
    herb: h.count,
    pred: p.count,
    plants: s.plants,
    fovH: (h.mean_fov_angle * 180) / Math.PI,
    fovP: (p.mean_fov_angle * 180) / Math.PI,
    rangeH: h.mean_fov_range,
    rangeP: p.mean_fov_range,
    speedH: h.mean_max_speed,
    speedP: p.mean_max_speed,
    births: th.births + tp.births,
    deaths:
      th.deaths_starved + th.deaths_aged + th.deaths_predated + tp.deaths_starved + tp.deaths_aged + tp.deaths_predated,
    predated: th.deaths_predated,
  };
}

export interface Windowed {
  /** Bucket means, `NaN` where no sample fell in the bucket. */
  values: Float64Array;
  /** Tick at the right edge of each bucket. */
  ticks: Float64Array;
}

export class History {
  private samples: Sample[] = [];

  constructor(private readonly capacity = 20_000) {}

  get length(): number {
    return this.samples.length;
  }

  get latest(): Sample | undefined {
    return this.samples[this.samples.length - 1];
  }

  push(s: Sample): void {
    const last = this.latest;
    // Rewinds send a `reset`; anything else out of order is a duplicate.
    if (last && s.tick <= last.tick) return;
    this.samples.push(s);
    if (this.samples.length > this.capacity) this.samples.splice(0, this.samples.length - this.capacity);
  }

  /** Drop everything after `tick` (after a rewind). */
  truncateAfter(tick: number): void {
    let n = this.samples.length;
    while (n > 0 && this.samples[n - 1]!.tick > tick) n--;
    this.samples.length = n;
  }

  clear(): void {
    this.samples.length = 0;
  }

  /** The sample nearest to `ticksBack` ticks before the latest one. */
  at(ticksBack: number): Sample | undefined {
    const last = this.latest;
    if (!last) return undefined;
    const target = last.tick - ticksBack;
    let lo = 0;
    let hi = this.samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.samples[mid]!.tick < target) lo = mid + 1;
      else hi = mid;
    }
    return this.samples[lo];
  }

  /**
   * `key` over the last `windowTicks` ticks, averaged into `points` equal
   * buckets ending at the latest sample. Older-than-history buckets are NaN,
   * so a fresh world shows a line growing in from the right. The last bucket
   * carries the latest sample verbatim.
   */
  window(key: SeriesKey, windowTicks: number, points: number): Windowed {
    const values = new Float64Array(points).fill(NaN);
    const ticks = new Float64Array(points);
    const last = this.latest;
    const end = last ? last.tick : 0;
    const width = windowTicks / points;
    for (let i = 0; i < points; i++) ticks[i] = end - windowTicks + (i + 1) * width;
    if (!last) return { values, ticks };
    const start = end - windowTicks;
    const sums = new Float64Array(points);
    const counts = new Uint32Array(points);
    // Walk back from the newest sample; stop once we leave the window.
    for (let j = this.samples.length - 1; j >= 0; j--) {
      const s = this.samples[j]!;
      if (s.tick <= start) break;
      let b = Math.floor((s.tick - start - 1e-9) / width);
      if (b >= points) b = points - 1;
      if (b < 0) b = 0;
      sums[b]! += s[key];
      counts[b]! += 1;
    }
    for (let i = 0; i < points; i++) if (counts[i]! > 0) values[i] = sums[i]! / counts[i]!;
    // The right edge is "now": show the latest sample itself, not a mean
    // over the last bucket, so the end label agrees with the tiles.
    values[points - 1] = last[key];
    return { values, ticks };
  }
}
