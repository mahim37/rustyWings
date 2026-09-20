/**
 * Small SVG line charts with a hover layer: crosshair, tooltip, end labels,
 * optional area fill and a linked-crosshair group so the three population
 * charts highlight the same tick together. No dependencies.
 *
 * Follows the project's chart rules: one y-axis per chart, 2px lines, hairline
 * grid, legend only for two or more series, text never wears a series colour.
 */

export interface Series {
  name: string;
  color: string;
  values: ArrayLike<number>;
}

export interface Ink {
  primary: string;
  secondary: string;
  muted: string;
  grid: string;
  axis: string;
  surface: string;
}

export interface ChartOptions {
  series: Series[];
  ink: Ink;
  height?: number;
  /** Left/right margins in px. */
  ml?: number;
  mr?: number;
  xAxis?: boolean;
  xLabel?: (i: number) => string;
  yFormat?: (v: number) => string;
  area?: boolean;
  legendEl?: HTMLElement;
  group?: string;
}

interface Instance {
  svg: SVGSVGElement;
  tt: HTMLDivElement;
  idx: number;
  group: string | undefined;
  ml: number;
  pw: number;
  n: number;
  setIndex?: (j: number) => void;
}

const NS = 'http://www.w3.org/2000/svg';
const groups = new Map<string, Instance[]>();
const instances = new WeakMap<HTMLElement, Instance>();

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent: Element,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  parent.appendChild(e);
  return e;
}

export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

function setGroup(origin: Instance, j: number): void {
  const list = origin.group ? (groups.get(origin.group) ?? [origin]) : [origin];
  for (const c of list) {
    c.idx = j;
    c.setIndex?.(j);
  }
}

const defaultFormat = (v: number): string => (Math.abs(v) >= 1e4 ? (v / 1e3).toFixed(1) + 'K' : String(Math.round(v)));

export function lineChart(root: HTMLElement, opts: ChartOptions): void {
  let inst = instances.get(root);
  if (!inst) {
    root.innerHTML = '';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('role', 'img');
    root.appendChild(svg);
    const tt = document.createElement('div');
    tt.className = 'tt';
    root.appendChild(tt);
    inst = { svg, tt, idx: -1, group: opts.group, ml: 0, pw: 1, n: 1 };
    instances.set(root, inst);
    if (opts.group) {
      const list = groups.get(opts.group) ?? [];
      list.push(inst);
      groups.set(opts.group, list);
    }
    const me = inst;
    svg.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const i = Math.round(((e.clientX - r.left - me.ml) / me.pw) * (me.n - 1));
      setGroup(me, Math.min(me.n - 1, Math.max(0, i)));
    });
    svg.addEventListener('pointerleave', () => setGroup(me, -1));
  }
  const { svg, tt } = inst;
  const W = Math.max(120, root.clientWidth);
  const H = opts.height ?? 120;
  const ml = opts.ml ?? 36;
  const mr = opts.mr ?? 52;
  const mt = 8;
  const mb = opts.xAxis === false ? 6 : 18;
  const pw = W - ml - mr;
  const ph = H - mt - mb;
  const series = opts.series;
  const n = series[0]?.values.length ?? 0;
  const ink = opts.ink;
  const fmt = opts.yFormat ?? defaultFormat;
  let maxV = 0;
  for (const s of series) for (let i = 0; i < n; i++) if (s.values[i]! > maxV) maxV = s.values[i]!;
  const yMax = niceMax(maxV * 1.08);
  const X = (i: number): number => ml + (n > 1 ? i / (n - 1) : 0) * pw;
  const Y = (v: number): number => mt + ph - (v / yMax) * ph;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.setAttribute('aria-label', series.map((s) => s.name).join(', ') + ' over time');
  svg.innerHTML = '';
  for (const tv of [yMax / 2, yMax]) {
    el('line', { x1: ml, x2: ml + pw, y1: Y(tv), y2: Y(tv), stroke: ink.grid, 'stroke-width': 1 }, svg);
    el('text', { x: ml - 6, y: Y(tv) + 3.5, fill: ink.muted, 'font-size': 10, 'text-anchor': 'end', class: 'tn' }, svg).textContent = fmt(tv);
  }
  el('line', { x1: ml, x2: ml + pw, y1: Y(0), y2: Y(0), stroke: ink.axis, 'stroke-width': 1 }, svg);
  el('text', { x: ml - 6, y: Y(0) + 3.5, fill: ink.muted, 'font-size': 10, 'text-anchor': 'end', class: 'tn' }, svg).textContent = '0';
  if (opts.xAxis !== false && opts.xLabel) {
    el('text', { x: ml, y: H - 4, fill: ink.muted, 'font-size': 10 }, svg).textContent = opts.xLabel(0);
    el('text', { x: ml + pw, y: H - 4, fill: ink.muted, 'font-size': 10, 'text-anchor': 'end' }, svg).textContent = opts.xLabel(n - 1);
  }
  // Last finite value per series, for end labels and dots.
  const lastOf = (s: Series): { i: number; v: number } | null => {
    for (let i = n - 1; i >= 0; i--) if (Number.isFinite(s.values[i])) return { i, v: s.values[i]! };
    return null;
  };
  for (const s of series) {
    let d = '';
    let pen = false;
    for (let i = 0; i < n; i++) {
      const v = s.values[i]!;
      if (!Number.isFinite(v)) {
        pen = false;
        continue;
      }
      d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
      pen = true;
    }
    if (!d) continue;
    if (opts.area) {
      // Area under each contiguous run.
      let area = '';
      let runStart = -1;
      for (let i = 0; i <= n; i++) {
        const ok = i < n && Number.isFinite(s.values[i]);
        if (ok && runStart < 0) runStart = i;
        if (!ok && runStart >= 0) {
          let seg = '';
          for (let k = runStart; k < i; k++) seg += (k === runStart ? 'M' : 'L') + X(k).toFixed(1) + ' ' + Y(s.values[k]!).toFixed(1);
          seg += `L${X(i - 1).toFixed(1)} ${Y(0)}L${X(runStart).toFixed(1)} ${Y(0)}Z`;
          area += seg;
          runStart = -1;
        }
      }
      el('path', { d: area, fill: s.color, opacity: 0.1 }, svg);
    }
    el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
  }
  const ends = series.map((s) => ({ s, last: lastOf(s) })).filter((e) => e.last);
  const labels = ends.map((e) => ({ y: Y(e.last!.v), v: e.last!.v })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i]!.y - labels[i - 1]!.y < 12) labels[i]!.y = labels[i - 1]!.y + 12;
  for (const L of labels) {
    const yEnd = Y(L.v);
    if (Math.abs(L.y - yEnd) > 1) el('line', { x1: X(n - 1) + 5, y1: yEnd, x2: ml + pw + 7, y2: L.y, stroke: ink.axis, 'stroke-width': 1 }, svg);
    el('text', { x: ml + pw + 9, y: L.y + 3.5, fill: ink.secondary, 'font-size': 11, class: 'tn' }, svg).textContent = fmt(L.v);
  }
  for (const e of ends) el('circle', { cx: X(e.last!.i), cy: Y(e.last!.v), r: 4, fill: e.s.color, stroke: ink.surface, 'stroke-width': 2 }, svg);
  const cross = el('line', { x1: 0, x2: 0, y1: mt, y2: mt + ph, stroke: ink.axis, 'stroke-width': 1, visibility: 'hidden' }, svg);
  const dots = series.map((s) => el('circle', { r: 4, fill: s.color, stroke: ink.surface, 'stroke-width': 2, visibility: 'hidden' }, svg));
  Object.assign(inst, { ml, pw, n });
  inst.setIndex = (j: number): void => {
    if (j < 0 || j >= n) {
      cross.setAttribute('visibility', 'hidden');
      dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
      tt.style.display = 'none';
      return;
    }
    const x = X(j);
    cross.setAttribute('x1', String(x));
    cross.setAttribute('x2', String(x));
    cross.setAttribute('visibility', 'visible');
    series.forEach((s, k) => {
      const v = s.values[j]!;
      const dot = dots[k]!;
      if (Number.isFinite(v)) {
        dot.setAttribute('cx', String(x));
        dot.setAttribute('cy', String(Y(v)));
        dot.setAttribute('visibility', 'visible');
      } else dot.setAttribute('visibility', 'hidden');
    });
    tt.innerHTML = '';
    const xl = document.createElement('div');
    xl.className = 'x';
    xl.textContent = opts.xLabel ? opts.xLabel(j) : String(j);
    tt.appendChild(xl);
    for (const s of series) {
      const r = document.createElement('div');
      r.className = 'r';
      const b = document.createElement('b');
      const v = s.values[j]!;
      b.textContent = Number.isFinite(v) ? fmt(v) : '—';
      const sp = document.createElement('span');
      const key = document.createElement('i');
      key.style.background = s.color;
      sp.appendChild(key);
      sp.appendChild(document.createTextNode(s.name));
      r.appendChild(b);
      r.appendChild(sp);
      tt.appendChild(r);
    }
    tt.style.display = 'block';
    let left = x + 10;
    if (left + tt.offsetWidth > W - 4) left = x - tt.offsetWidth - 10;
    tt.style.left = left + 'px';
    tt.style.top = mt + 'px';
  };
  if (inst.idx >= 0) inst.setIndex(Math.min(inst.idx, n - 1));
  if (opts.legendEl) {
    const L = opts.legendEl;
    L.innerHTML = '';
    if (series.length >= 2)
      for (const s of series) {
        const sp = document.createElement('span');
        const b = document.createElement('b');
        b.style.background = s.color;
        sp.appendChild(b);
        sp.appendChild(document.createTextNode(s.name));
        L.appendChild(sp);
      }
  }
}

export function renderTable(
  table: HTMLTableElement,
  series: Series[],
  xLabel: (i: number) => string,
  rows: number,
  fmt: (v: number) => string = defaultFormat,
): void {
  const n = series[0]?.values.length ?? 0;
  table.innerHTML = '';
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  const th0 = document.createElement('th');
  th0.textContent = 'time';
  tr.appendChild(th0);
  for (const s of series) {
    const th = document.createElement('th');
    th.textContent = s.name;
    tr.appendChild(th);
  }
  thead.appendChild(tr);
  table.appendChild(thead);
  const tb = document.createElement('tbody');
  for (let i = n - 1; i >= Math.max(0, n - rows); i--) {
    const r = document.createElement('tr');
    const td0 = document.createElement('td');
    td0.textContent = xLabel(i);
    r.appendChild(td0);
    for (const s of series) {
      const td = document.createElement('td');
      const v = s.values[i]!;
      td.textContent = Number.isFinite(v) ? fmt(v) : '—';
      r.appendChild(td);
    }
    tb.appendChild(r);
  }
  table.appendChild(tb);
}

/** Diverging blue–gray–red for signed values such as brain weights. */
export function divergingColor(v: number, scale = 1.5): string {
  const t = Math.min(1, Math.abs(v) / scale);
  const mid = [240, 239, 236];
  const pole = v < 0 ? [42, 120, 214] : [227, 73, 72];
  return 'rgb(' + mid.map((m, i) => Math.round(m + (pole[i]! - m) * t)).join(',') + ')';
}
