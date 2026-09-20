/** The "Right now" tiles: counts with a trend over the last 300 ticks. */

import { fmtInt } from './format';
import type { History } from './history';

const TREND_TICKS = 300;
const BIRTH_WINDOW = 1000;

function tile(id: string, value: number, ref: number | undefined): void {
  const v = document.getElementById(id + '-v');
  const d = document.getElementById(id + '-d');
  if (!v || !d) return;
  v.textContent = fmtInt(value);
  if (ref === undefined) {
    d.textContent = '';
    return;
  }
  const delta = Math.round(value - ref);
  d.textContent = delta === 0 ? 'steady' : (delta > 0 ? '▲ ' : '▼ ') + fmtInt(Math.abs(delta)) + ` over ${TREND_TICKS} ticks`;
}

export function updateKpis(history: History): void {
  const now = history.latest;
  if (!now) return;
  const then = history.at(TREND_TICKS);
  const hasTrend = then && now.tick - then.tick >= TREND_TICKS * 0.8;
  tile('k-herb', now.herb, hasTrend ? then.herb : undefined);
  tile('k-pred', now.pred, hasTrend ? then.pred : undefined);
  tile('k-plant', now.plants, hasTrend ? then.plants : undefined);
  const back = history.at(BIRTH_WINDOW);
  const span = back ? now.tick - back.tick : 0;
  const births = back && span > 0 ? ((now.births - back.births) * BIRTH_WINDOW) / span : 0;
  const bv = document.getElementById('k-birth-v');
  const bd = document.getElementById('k-birth-d');
  if (bv) bv.textContent = span >= BIRTH_WINDOW * 0.5 ? fmtInt(births) : '—';
  if (bd) bd.textContent = `${fmtInt(now.deaths)} deaths so far · ${fmtInt(now.predated)} eaten`;
}
