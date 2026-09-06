/**
 * Illustrated birds, drawn once with Canvas 2D into a texture atlas. The
 * atlas has one row per species and four wing positions per row; the
 * renderer picks a frame per bird from time and a per-bird phase, so a flock
 * never flaps in unison. The same drawing routine paints the inspector's
 * portrait, so what you click is what you see.
 */

import type { Species } from '../sim/types';
import { PREDATOR } from '../sim/types';

export const FRAMES = 4;
export const CELL = 128;

export const PALETTE = {
  herb: { body: '#2a78d6', dark: '#1c539a', light: '#a9c9f2', beak: '#e6a83c', belly: '#dce9fa' },
  pred: { body: '#eb6834', dark: '#a8431c', light: '#f7b892', beak: '#f2c94c', belly: '#fbe0d0' },
  plant: '#1baf7a',
};

/** Wing sweep per frame, radians back from perpendicular. */
const SWEEP = [-0.15, 0.25, 0.75, 0.25];
/** Wing length multiplier per frame (folded wings are shorter on screen). */
const SPAN = [1.0, 0.95, 0.72, 0.95];

/**
 * Draw one bird centred on `(cx, cy)` facing +x, with body radius `r`.
 * `frame` selects the wing position; `heading` rotates the whole bird.
 */
export function drawBird(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, species: Species, frame = 0, heading = 0): void {
  const c = species === PREDATOR ? PALETTE.pred : PALETTE.herb;
  const hawk = species === PREDATOR;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(heading);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, r * 0.09);
  ctx.strokeStyle = c.dark;

  // Tail: three feathers fanning out behind.
  ctx.fillStyle = c.dark;
  const tailLen = hawk ? r * 1.15 : r * 0.95;
  for (const a of [-0.32, 0, 0.32]) {
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, 0);
    ctx.lineTo(-r * 0.6 - Math.cos(a) * tailLen, -Math.sin(a) * tailLen);
    ctx.lineTo(-r * 0.6 - Math.cos(a + 0.22) * tailLen * 0.9, -Math.sin(a + 0.22) * tailLen * 0.9);
    ctx.closePath();
    ctx.fill();
  }

  // Wings: a curved feather shape on each side, swept by frame.
  const f = ((frame % FRAMES) + FRAMES) % FRAMES;
  const sweep = SWEEP[f]!;
  const span = (hawk ? r * 2.5 : r * 2.1) * SPAN[f]!;
  const width = hawk ? r * 1.05 : r * 0.9;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(1, side);
    ctx.rotate(sweep);
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, r * 0.25);
    ctx.quadraticCurveTo(r * 0.35, span * 0.55, r * 0.05, span);
    ctx.quadraticCurveTo(-width * 0.55, span * 0.85, -width, span * 0.55);
    ctx.quadraticCurveTo(-width * 0.9, r * 0.5, -r * 0.55, r * 0.25);
    ctx.closePath();
    ctx.fillStyle = c.body;
    ctx.fill();
    ctx.stroke();
    // Primary feather lines.
    ctx.beginPath();
    for (const t of [0.42, 0.62, 0.82]) {
      ctx.moveTo(-r * 0.25 - (width - r * 0.25) * t * 0.55, span * (0.35 + t * 0.55));
      ctx.lineTo(r * 0.05 - width * t * 0.15, span * (0.55 + t * 0.42));
    }
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.strokeStyle = c.dark;
    ctx.globalAlpha = 0.55;
    ctx.stroke();
    ctx.restore();
  }

  // Body.
  ctx.lineWidth = Math.max(1, r * 0.09);
  ctx.strokeStyle = c.dark;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.15, r * 0.82, 0, 0, Math.PI * 2);
  ctx.fillStyle = c.body;
  ctx.fill();
  ctx.stroke();
  // Belly highlight.
  ctx.beginPath();
  ctx.ellipse(r * 0.15, 0, r * 0.7, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = c.belly;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Head.
  const hx = r * 1.15;
  const hr = hawk ? r * 0.6 : r * 0.62;
  ctx.beginPath();
  ctx.arc(hx, 0, hr, 0, Math.PI * 2);
  ctx.fillStyle = c.body;
  ctx.fill();
  ctx.stroke();
  if (hawk) {
    // Dark cap.
    ctx.beginPath();
    ctx.arc(hx, 0, hr, -Math.PI * 0.5 - 0.35, Math.PI * 0.5 + 0.35, false);
    ctx.fillStyle = c.dark;
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Beak: sparrows a short cone, hawks a hooked one.
  ctx.beginPath();
  ctx.fillStyle = c.beak;
  const bx = hx + hr * 0.75;
  if (hawk) {
    ctx.moveTo(bx - hr * 0.1, -hr * 0.42);
    ctx.quadraticCurveTo(bx + hr * 0.95, -hr * 0.35, bx + hr * 0.75, hr * 0.35);
    ctx.quadraticCurveTo(bx + hr * 0.4, hr * 0.1, bx - hr * 0.1, hr * 0.42);
  } else {
    ctx.moveTo(bx - hr * 0.1, -hr * 0.38);
    ctx.lineTo(bx + hr * 0.8, 0);
    ctx.lineTo(bx - hr * 0.1, hr * 0.38);
  }
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.stroke();

  // Eyes, one each side.
  for (const side of [-1, 1]) {
    const ex = hx + hr * 0.15;
    const ey = side * hr * 0.5;
    ctx.beginPath();
    ctx.arc(ex, ey, hr * 0.26, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + hr * 0.06, ey, hr * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
  }
  ctx.restore();
}

/** Build the atlas: `FRAMES` columns × 2 rows of `CELL`px cells. */
export function buildAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CELL * FRAMES;
  canvas.height = CELL * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  for (const species of [0, 1] as const) {
    for (let f = 0; f < FRAMES; f++) {
      // Body radius chosen so the widest frame (wings out) fits the cell.
      const r = species === PREDATOR ? CELL * 0.155 : CELL * 0.17;
      drawBird(ctx, f * CELL + CELL * 0.48, species * CELL + CELL * 0.5, r, species, f, 0);
    }
  }
  return canvas;
}
