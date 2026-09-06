/**
 * The simulation thread. Owns the wasm `Sim`, runs it at the requested rate
 * with a fixed-timestep accumulator (or flat out for "max"), samples stats
 * every `SAMPLE_STRIDE` ticks, and posts packed frames to the page whenever
 * one of two recyclable buffers is free. Rendering never waits on the sim
 * and the sim never waits on rendering.
 */

import init, { Sim } from '../wasm/rustywings_wasm.js';
import { BASE_UPS, SAMPLE_STRIDE, type FrameMessage, type FromWorker, type ToWorker } from './protocol';
import type { Config, Inspection, Stats } from './types';

interface Scope {
  postMessage(m: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
}
const scope = self as unknown as Scope;
const post = (m: FromWorker, transfer?: Transferable[]): void => scope.postMessage(m, transfer);

const ready = init();

/** Time budget per loop iteration when running flat out, ms. */
const MAX_BUDGET_MS = 12;
/** Frame cadence cap, ms. */
const FRAME_MS = 15;
/** Heartbeat while paused, so the page still gets ups/tick updates. */
const IDLE_MS = 500;

let sim: Sim | null = null;
let seed = '1';
let config: Config | null = null;
let playing = false;
let targetUps = BASE_UPS;
let selectedId = -1;
let acc = 0;
let last = performance.now();
let msPerTick = 1;
let dirty = true;
let lastFrameAt = 0;
let inFlight = 0;
const pool: ArrayBuffer[] = [];
let samples: Stats[] = [];
let upsTicks = 0;
let upsSince = performance.now();
let ups = 0;
let lastChecksumAt = 0;
let snapshot: { bytes: Uint8Array; tick: number } | null = null;

// Scheduling: a MessageChannel gives a macrotask without the 4 ms clamp
// nested setTimeout(0) gets; a real timeout is used only while paused.
let scheduled = false;
const chan = new MessageChannel();
chan.port1.onmessage = () => {
  scheduled = false;
  loop();
};
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  if (playing) chan.port2.postMessage(0);
  else
    setTimeout(() => {
      scheduled = false;
      loop();
    }, 33);
}

function sample(): void {
  if (sim) samples.push(sim.stats() as Stats);
}

/** Step to `target`, stopping at every sample boundary on the way. */
function stepTo(target: number): void {
  if (!sim) return;
  let tick = sim.tick();
  while (tick < target) {
    const boundary = (Math.floor(tick / SAMPLE_STRIDE) + 1) * SAMPLE_STRIDE;
    const next = Math.min(target, boundary);
    const k = next - tick;
    const t0 = performance.now();
    sim.step(k);
    const per = (performance.now() - t0) / k;
    msPerTick = msPerTick * 0.8 + per * 0.2;
    upsTicks += k;
    tick = next;
    if (tick % SAMPLE_STRIDE === 0) sample();
  }
}

function loop(): void {
  const now = performance.now();
  if (sim && playing) {
    if (targetUps === Infinity) {
      const deadline = now + MAX_BUDGET_MS;
      do {
        const chunk = Math.max(1, Math.min(SAMPLE_STRIDE, Math.floor(4 / msPerTick)));
        stepTo(sim.tick() + chunk);
      } while (performance.now() < deadline);
    } else {
      const dt = Math.min(now - last, 250) / 1000;
      acc += dt * targetUps;
      let n = Math.floor(acc);
      acc -= n;
      // Never spend more than one budget per loop: a slow machine slows the
      // world down instead of freezing the page.
      const maxN = Math.max(1, Math.floor(MAX_BUDGET_MS / msPerTick));
      if (n > maxN) {
        n = maxN;
        acc = 0;
      }
      if (n > 0) stepTo(sim.tick() + n);
    }
    dirty = true;
  }
  last = now;
  if (now - upsSince >= 500) {
    ups = upsTicks / ((now - upsSince) / 1000);
    upsTicks = 0;
    upsSince = now;
  }
  maybeFrame(now);
  schedule();
}

function maybeFrame(now: number): void {
  if (!sim || inFlight >= 2) return;
  const since = now - lastFrameAt;
  if (since < FRAME_MS) return;
  if (!dirty && since < IDLE_MS) return;
  const len = sim.packFrame(selectedId);
  let buffer = pool.pop();
  if (!buffer || buffer.byteLength < len * 4) buffer = new ArrayBuffer(Math.ceil(len * 1.25) * 4 + 4096);
  sim.copyFrame(new Float32Array(buffer, 0, len));
  const msg: FrameMessage = {
    type: 'frame',
    tick: sim.tick(),
    buffer,
    length: len,
    ups,
    playing,
    samples,
    selectedId,
  };
  if (selectedId >= 0) {
    const insp = sim.inspect(selectedId) as Inspection | undefined;
    msg.inspection = insp ?? null;
    if (!insp) selectedId = -1;
  }
  if (now - lastChecksumAt >= 1000) {
    msg.checksum = sim.checksum();
    lastChecksumAt = now;
  }
  post(msg, [buffer]);
  samples = [];
  inFlight++;
  lastFrameAt = now;
  dirty = false;
}

function fail(err: unknown, fatal: boolean): void {
  const message = err instanceof Error ? err.message : String(err);
  post({ type: 'error', message, fatal });
}

function create(newSeed: string, cfg: Config | null): void {
  try {
    const next = new Sim(newSeed, cfg ? JSON.stringify(cfg) : undefined);
    sim?.free();
    sim = next;
    seed = sim.seed();
    config = sim.config() as Config;
    snapshot = null;
    samples = [];
    selectedId = -1;
    acc = 0;
    last = performance.now();
    sample();
    post({ type: 'ready', seed, config, shape: sim.shape(), version: Sim.version() });
    dirty = true;
    schedule();
  } catch (err) {
    fail(err, true);
  }
}

scope.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'defaults') {
    await ready;
    post({ type: 'defaults', config: Sim.defaultConfig() as Config, version: Sim.version() });
    return;
  }
  if (m.type === 'init') {
    await ready;
    create(m.seed, m.config);
    return;
  }
  if (m.type === 'recycle') {
    if (pool.length < 2) pool.push(m.buffer);
    inFlight = Math.max(0, inFlight - 1);
    schedule();
    return;
  }
  if (!sim) return;
  switch (m.type) {
    case 'play':
      playing = m.playing;
      acc = 0;
      last = performance.now();
      break;
    case 'speed':
      targetUps = m.ups;
      acc = 0;
      break;
    case 'step':
      playing = false;
      stepTo(sim.tick() + m.n);
      break;
    case 'select': {
      const i = sim.agentAt(m.x, m.y, m.radius);
      selectedId = i >= 0 ? sim.idAt(i) : -1;
      break;
    }
    case 'selectId':
      selectedId = m.id;
      break;
    case 'selectRandom': {
      const n = sim.agentCount();
      selectedId = n > 0 ? sim.idAt(Math.floor(Math.random() * n)) : -1;
      break;
    }
    case 'strike':
      post({ type: 'event', kind: 'strike', detail: sim.strike(m.x, m.y, m.radius), tick: sim.tick() });
      break;
    case 'scatter':
      post({ type: 'event', kind: 'scatter', detail: sim.scatterPlants(m.n), tick: sim.tick() });
      break;
    case 'spawn':
      post({ type: 'event', kind: 'spawn', detail: sim.spawn(m.species, m.n), tick: sim.tick() });
      break;
    case 'config':
      try {
        sim.setConfig(JSON.stringify(m.config));
        config = sim.config() as Config;
      } catch (err) {
        fail(err, false);
      }
      break;
    case 'snapshot':
      snapshot = { bytes: sim.snapshot(), tick: sim.tick() };
      post({ type: 'event', kind: 'snapshot', detail: snapshot.tick, tick: snapshot.tick });
      break;
    case 'rewind':
      if (snapshot) {
        try {
          const restored = Sim.restore(snapshot.bytes);
          sim.free();
          sim = restored;
          selectedId = -1;
          samples = [];
          post({ type: 'reset', tick: sim.tick() });
          post({ type: 'event', kind: 'rewind', detail: sim.tick(), tick: sim.tick() });
        } catch (err) {
          fail(err, false);
        }
      } else {
        post({ type: 'reset', tick: 0 });
        create(seed, config);
        post({ type: 'event', kind: 'restart', detail: 0, tick: 0 });
      }
      break;
    case 'genome':
      post({ type: 'genome', inspection: (sim.inspect(m.id) as Inspection | undefined) ?? null, seed, tick: sim.tick() });
      break;
  }
  dirty = true;
  schedule();
};
