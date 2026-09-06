/** Main-thread handle on the simulation worker. Typed send, typed events. */

import type { FromWorker, ToWorker } from './protocol';
import type { Config } from './types';

type Handler<K extends FromWorker['type']> = (m: Extract<FromWorker, { type: K }>) => void;

export class SimClient {
  private readonly worker: Worker;
  private readonly handlers = new Map<string, Array<(m: FromWorker) => void>>();

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'rustywings-sim' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.dispatch(e.data);
    this.worker.onerror = (e) => this.dispatch({ type: 'error', message: e.message || 'worker failed to start', fatal: true });
  }

  on<K extends FromWorker['type']>(type: K, fn: Handler<K>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn as (m: FromWorker) => void);
    this.handlers.set(type, list);
  }

  private dispatch(m: FromWorker): void {
    for (const fn of this.handlers.get(m.type) ?? []) fn(m);
  }

  private send(m: ToWorker, transfer?: Transferable[]): void {
    this.worker.postMessage(m, transfer ?? []);
  }

  requestDefaults(): void {
    this.send({ type: 'defaults' });
  }
  init(seed: string, config: Config | null): void {
    this.send({ type: 'init', seed, config });
  }
  restore(bytes: ArrayBuffer): void {
    this.send({ type: 'restore', bytes }, [bytes]);
  }
  export(): void {
    this.send({ type: 'export' });
  }
  introduce(species: 0 | 1, genome: string): void {
    this.send({ type: 'introduce', species, genome });
  }
  family(id: number): void {
    this.send({ type: 'family', id });
  }
  play(playing: boolean): void {
    this.send({ type: 'play', playing });
  }
  speed(ups: number): void {
    this.send({ type: 'speed', ups });
  }
  step(n = 1): void {
    this.send({ type: 'step', n });
  }
  select(x: number, y: number, radius: number): void {
    this.send({ type: 'select', x, y, radius });
  }
  selectId(id: number): void {
    this.send({ type: 'selectId', id });
  }
  selectRandom(): void {
    this.send({ type: 'selectRandom' });
  }
  strike(x: number, y: number, radius: number): void {
    this.send({ type: 'strike', x, y, radius });
  }
  scatter(n: number): void {
    this.send({ type: 'scatter', n });
  }
  spawn(species: 0 | 1, n: number): void {
    this.send({ type: 'spawn', species, n });
  }
  setConfig(config: Config): void {
    this.send({ type: 'config', config });
  }
  snapshot(): void {
    this.send({ type: 'snapshot' });
  }
  rewind(): void {
    this.send({ type: 'rewind' });
  }
  genome(id: number): void {
    this.send({ type: 'genome', id });
  }
  recycle(buffer: ArrayBuffer): void {
    this.send({ type: 'recycle', buffer }, [buffer]);
  }
  terminate(): void {
    this.worker.terminate();
  }
}
