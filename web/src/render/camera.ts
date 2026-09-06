/**
 * A square viewport onto the unit torus. `center` is the world point in the
 * middle of the canvas; `zoom` 1 shows the whole world. Positions are wrapped
 * relative to the centre, so panning across an edge is seamless and a bird
 * near x = 0.99 draws next to one at x = 0.01.
 */

import { clamp, wrap01 } from '../ui/format';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 12;

export class Camera {
  cx = 0.5;
  cy = 0.5;
  zoom = 1;
  /** Canvas size in CSS pixels (square). */
  size = 1;

  /** World units per CSS pixel. */
  get unitsPerPixel(): number {
    return 1 / (this.size * this.zoom);
  }

  /** Shortest signed offset from the centre, in world units. */
  private delta(x: number, y: number): [number, number] {
    let dx = x - this.cx;
    let dy = y - this.cy;
    dx -= Math.round(dx);
    dy -= Math.round(dy);
    return [dx, dy];
  }

  /** CSS pixel coordinates relative to the canvas' top-left, y down. */
  worldToScreen(x: number, y: number): [number, number] {
    const [dx, dy] = this.delta(x, y);
    return [(0.5 + dx * this.zoom) * this.size, (0.5 - dy * this.zoom) * this.size];
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    const dx = (sx / this.size - 0.5) / this.zoom;
    const dy = -(sy / this.size - 0.5) / this.zoom;
    return [wrap01(this.cx + dx), wrap01(this.cy + dy)];
  }

  panByPixels(dxPx: number, dyPx: number): void {
    this.cx = wrap01(this.cx - dxPx * this.unitsPerPixel);
    this.cy = wrap01(this.cy + dyPx * this.unitsPerPixel);
  }

  /** Zoom by `factor` keeping the world point under `(sx, sy)` fixed. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const [nx, ny] = this.screenToWorld(sx, sy);
    this.cx = wrap01(this.cx + (wx - nx));
    this.cy = wrap01(this.cy + (wy - ny));
  }

  /** Ease the centre toward `(x, y)`; `alpha` 1 snaps. */
  follow(x: number, y: number, alpha: number): void {
    const [dx, dy] = this.delta(x, y);
    this.cx = wrap01(this.cx + dx * alpha);
    this.cy = wrap01(this.cy + dy * alpha);
  }

  reset(): void {
    this.cx = 0.5;
    this.cy = 0.5;
    this.zoom = 1;
  }
}
