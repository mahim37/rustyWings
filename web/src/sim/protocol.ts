/**
 * Messages between the page and the simulation worker.
 *
 * The worker owns the wasm `Sim`. The page never touches wasm memory; it
 * receives packed frames (see `frame.rs` in the wasm crate) and sends back
 * the buffers once drawn, so at most two buffers are ever in flight and the
 * worker never allocates in steady state.
 */

import type { Config, Family, Inspection, Shape, Stats } from './types';

/** Stats are sampled every this many ticks, regardless of speed. */
export const SAMPLE_STRIDE = 25;

/** Frame layout, mirrored from `crates/rustywings-wasm/src/frame.rs`. */
export const FRAME_HEADER = 5;
export const AGENT_STRIDE = 10;
export const POINT_STRIDE = 2;

/** Ticks per second at speed 1×; the "max" setting is `Infinity`. */
export const BASE_UPS = 60;

export type ToWorker =
  | { type: 'defaults' }
  | { type: 'init'; seed: string; config: Config | null }
  | { type: 'restore'; bytes: ArrayBuffer }
  | { type: 'play'; playing: boolean }
  | { type: 'speed'; ups: number }
  | { type: 'step'; n: number }
  | { type: 'select'; x: number; y: number; radius: number }
  | { type: 'selectId'; id: number }
  | { type: 'selectRandom' }
  | { type: 'strike'; x: number; y: number; radius: number }
  | { type: 'scatter'; n: number }
  | { type: 'spawn'; species: 0 | 1; n: number }
  | { type: 'introduce'; species: 0 | 1; genome: string }
  | { type: 'config'; config: Config }
  | { type: 'snapshot' }
  | { type: 'rewind' }
  | { type: 'export' }
  | { type: 'genome'; id: number }
  | { type: 'family'; id: number }
  | { type: 'recycle'; buffer: ArrayBuffer };

export interface FrameMessage {
  type: 'frame';
  tick: number;
  buffer: ArrayBuffer;
  length: number;
  ups: number;
  playing: boolean;
  samples: Stats[];
  selectedId: number;
  /** Present every few frames while a bird is selected; `null` once it dies. */
  inspection?: Inspection | null;
  /** Present about once a second while a bird is selected. */
  family?: Family | null;
  /** How many living birds the map is highlighting as relatives; with `family`. */
  relatives?: number;
  /** Present about once a second. */
  checksum?: string;
}

export type EventKind = 'strike' | 'scatter' | 'spawn' | 'introduce' | 'snapshot' | 'rewind' | 'restart';

export type FromWorker =
  | { type: 'defaults'; config: Config; version: string }
  | { type: 'ready'; seed: string; tick: number; config: Config; shape: Shape; version: string }
  | { type: 'error'; message: string; fatal: boolean }
  | FrameMessage
  | { type: 'event'; kind: EventKind; detail: number; tick: number }
  | { type: 'reset'; tick: number }
  | { type: 'genome'; inspection: Inspection | null; seed: string; tick: number }
  | { type: 'family'; id: number; family: Family | null }
  | { type: 'export'; bytes: ArrayBuffer; seed: string; tick: number };
