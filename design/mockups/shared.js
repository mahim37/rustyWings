/* rustyWings UI mockups — shared fake-simulation + chart engine.
   Throwaway code for design review only; the real sim lives in Rust/wasm. */
(function (global) {
  'use strict';
  const TAU = Math.PI * 2;

  // ---------- deterministic RNG (mulberry32) ----------
  let seed = 0x7f3a2c11;
  function rand() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const wrap1 = (x) => ((x % 1) + 1) % 1;
  const nf = new Intl.NumberFormat('en-US');
  const fmtInt = (n) => nf.format(Math.round(n));
  const compact = (n) => Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M'
    : Math.abs(n) >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : fmtInt(n);
  const degOf = (r) => Math.round(r * 180 / Math.PI);
  const mean = (arr, f) => arr.length ? arr.reduce((s, a) => s + f(a), 0) / arr.length : 0;

  // ---------- torus geometry ----------
  function d2(a, b) {
    let dx = a.x - b.x, dy = a.y - b.y;
    if (dx > 0.5) dx -= 1; else if (dx < -0.5) dx += 1;
    if (dy > 0.5) dy -= 1; else if (dy < -0.5) dy += 1;
    return dx * dx + dy * dy;
  }
  function angleTo(a, b) {
    let dx = b.x - a.x, dy = b.y - a.y;
    if (dx > 0.5) dx -= 1; else if (dx < -0.5) dx += 1;
    if (dy > 0.5) dy -= 1; else if (dy < -0.5) dy += 1;
    return Math.atan2(dy, dx);
  }
  function nearest(list, a, range) {
    let best = null, bd = range * range;
    for (let i = 0; i < list.length; i++) {
      const q = d2(a, list[i]);
      if (q < bd) { bd = q; best = list[i]; }
    }
    return best;
  }

  // ---------- fake world ----------
  let nextId = 4021;
  function spawnAgent(kind, parent) {
    const a = {
      id: nextId++, kind,
      x: parent ? parent.x : rand(), y: parent ? parent.y : rand(),
      h: rand() * TAU,
      energy: parent ? 0.45 : 0.5 + rand() * 0.35,
      age: 0, gen: parent ? parent.gen + 1 : 0, children: 0,
      target: null, retarget: Math.floor(rand() * 8), lastMeal: 0,
      spd: kind === 'pred' ? 0.0021 : 0.0013,
      fov: kind === 'pred' ? 1.4 : 2.9,
      range: kind === 'pred' ? 0.13 : 0.075,
      size: kind === 'pred' ? 1.0 : 0.7,
      genome: null,
    };
    if (parent) {
      a.spd = clamp(parent.spd * (1 + gauss() * 0.04), 0.0006, 0.0034);
      a.fov = clamp(parent.fov + gauss() * 0.08, 0.5, 5.6);
      a.range = clamp(parent.range + gauss() * 0.004, 0.03, 0.2);
      a.size = clamp(parent.size + gauss() * 0.03, 0.4, 1.4);
      a.genome = parent.genome.map(g => rand() < 0.08 ? clamp(g + gauss() * 0.3, -2, 2) : g);
    } else {
      a.spd *= 0.85 + rand() * 0.3;
      a.fov = clamp(a.fov + gauss() * 0.3, 0.5, 5.6);
      a.genome = Array.from({ length: 54 }, () => clamp(gauss() * 0.7, -2, 2));
    }
    return a;
  }
  function spawnPlant(w) {
    const p = w.patches[Math.floor(rand() * w.patches.length)];
    return { x: wrap1(p.x + gauss() * p.r), y: wrap1(p.y + gauss() * p.r) };
  }
  function createWorld(o) {
    const w = { tick: 0, plants: [], herb: [], pred: [], patches: [], births: 0, deaths: 0, selected: null, cap: o.plantCap || 1500 };
    for (let i = 0; i < (o.patches || 8); i++) w.patches.push({ x: rand(), y: rand(), r: 0.03 + rand() * 0.05 });
    for (let i = 0; i < o.plants; i++) w.plants.push(spawnPlant(w));
    for (let i = 0; i < o.herb; i++) w.herb.push(spawnAgent('herb', null));
    for (let i = 0; i < o.pred; i++) w.pred.push(spawnAgent('pred', null));
    w.selected = w.herb[3] || null;
    return w;
  }
  function steer(a, target, gain) {
    if (target) {
      const want = angleTo(a, target);
      let d = want - a.h; d = Math.atan2(Math.sin(d), Math.cos(d));
      a.h += clamp(d, -gain, gain);
    } else {
      a.h += gauss() * 0.06;
    }
    a.x = wrap1(a.x + Math.cos(a.h) * a.spd);
    a.y = wrap1(a.y + Math.sin(a.h) * a.spd);
  }
  function step(w) {
    w.tick++;
    const grow = 0.9 * (1 - w.plants.length / w.cap);
    if (rand() < grow) w.plants.push(spawnPlant(w));
    if (w.tick % 400 === 0) for (const p of w.patches) { p.x = wrap1(p.x + gauss() * 0.01); p.y = wrap1(p.y + gauss() * 0.01); }

    const pressure = w.herb.length / 420;
    for (let i = w.herb.length - 1; i >= 0; i--) {
      const a = w.herb[i];
      if ((w.tick + a.retarget) % 8 === 0 || (a.target && w.plants.indexOf(a.target) < 0)) a.target = nearest(w.plants, a, a.range);
      steer(a, a.target, 0.12);
      a.age++; a.energy -= 0.00045 + a.spd * 0.06 * pressure;
      if (a.target && d2(a, a.target) < 0.005 * 0.005) {
        const k = w.plants.indexOf(a.target); if (k >= 0) w.plants.splice(k, 1);
        a.target = null; a.energy = Math.min(1, a.energy + 0.14); a.lastMeal = w.tick;
      }
      if (a.energy > 0.9 && rand() < 0.03) { a.energy -= 0.42; a.children++; w.herb.push(spawnAgent('herb', a)); w.births++; }
      if (a.energy <= 0 || a.age > 7000) { w.herb.splice(i, 1); w.deaths++; if (w.selected === a) w.selected = null; }
    }
    for (let i = w.pred.length - 1; i >= 0; i--) {
      const a = w.pred[i];
      if ((w.tick + a.retarget) % 6 === 0 || (a.target && w.herb.indexOf(a.target) < 0)) a.target = nearest(w.herb, a, a.range);
      steer(a, a.target, 0.09);
      a.age++; a.energy -= 0.00075 + a.spd * 0.05;
      if (a.target && d2(a, a.target) < 0.006 * 0.006) {
        const k = w.herb.indexOf(a.target);
        if (k >= 0) { if (w.selected === w.herb[k]) w.selected = null; w.herb.splice(k, 1); w.deaths++; }
        a.target = null; a.energy = Math.min(1, a.energy + 0.45); a.lastMeal = w.tick;
      }
      if (a.energy > 0.88 && rand() < 0.02 && w.pred.length < 90) { a.energy -= 0.4; a.children++; w.pred.push(spawnAgent('pred', a)); w.births++; }
      if (a.energy <= 0 || a.age > 9000) { w.pred.splice(i, 1); w.deaths++; if (w.selected === a) w.selected = null; }
    }
    if (w.herb.length < 40) w.herb.push(spawnAgent('herb', null));
    if (w.pred.length < 6) w.pred.push(spawnAgent('pred', null));
    if (!w.selected) w.selected = w.herb[Math.floor(rand() * w.herb.length)] || null;
  }

  // ---------- canvas renderer ----------
  function makeRenderer(canvas, style) {
    const ctx = canvas.getContext('2d');
    let size = 64, dpr = 1;
    function resize() {
      dpr = window.devicePixelRatio || 1;
      const r = canvas.parentElement.getBoundingClientRect();
      const pad = style.pad || 0;
      size = Math.max(64, Math.floor(Math.min(r.width, r.height) - pad * 2));
      canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
      canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr);
    }
    resize(); window.addEventListener('resize', resize);

    function tri(x, y, h, L) {
      ctx.moveTo(x + Math.cos(h) * L, y + Math.sin(h) * L);
      ctx.lineTo(x + Math.cos(h + 2.5) * L * 0.85, y + Math.sin(h + 2.5) * L * 0.85);
      ctx.lineTo(x + Math.cos(h - 2.5) * L * 0.85, y + Math.sin(h - 2.5) * L * 0.85);
      ctx.closePath();
    }
    function bird(a, x, y, r, color, t) {
      const h = a.h, px = -Math.sin(h), py = Math.cos(h);
      const flap = Math.sin(t * 0.25 + a.id) * 0.5;
      ctx.fillStyle = color; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.ellipse(x - Math.cos(h) * r * 0.1, y - Math.sin(h) * r * 0.1, r * 1.9, r * (0.55 + flap * 0.3), h + Math.PI / 2, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.15, r * 0.85, h, 0, TAU); ctx.fill();
      const hx = x + Math.cos(h) * r * 1.1, hy = y + Math.sin(h) * r * 1.1;
      ctx.beginPath(); ctx.arc(hx, hy, r * 0.62, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e0a33a'; ctx.beginPath();
      ctx.moveTo(hx + Math.cos(h) * r * 1.15, hy + Math.sin(h) * r * 1.15);
      ctx.lineTo(hx + Math.cos(h) * r * 0.5 + px * r * 0.22, hy + Math.sin(h) * r * 0.5 + py * r * 0.22);
      ctx.lineTo(hx + Math.cos(h) * r * 0.5 - px * r * 0.22, hy + Math.sin(h) * r * 0.5 - py * r * 0.22);
      ctx.closePath(); ctx.fill();
      const ex = hx + Math.cos(h) * r * 0.2 + px * r * 0.3, ey = hy + Math.sin(h) * r * 0.2 + py * r * 0.3;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, r * 0.22, 0, TAU); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(ex + Math.cos(h) * r * 0.06, ey + Math.sin(h) * r * 0.06, r * 0.11, 0, TAU); ctx.fill();
    }
    function draw(w, t) {
      const s = canvas.width;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = style.bg; ctx.fillRect(0, 0, s, s);
      if (style.grid) {
        ctx.strokeStyle = style.grid; ctx.lineWidth = 1; ctx.beginPath();
        const n = style.gridN || 32;
        for (let i = 1; i < n; i++) { const p = Math.round(i * s / n) + 0.5; ctx.moveTo(p, 0); ctx.lineTo(p, s); ctx.moveTo(0, p); ctx.lineTo(s, p); }
        ctx.stroke();
      }
      if (style.patches) {
        for (const p of w.patches) {
          const R = p.r * 2.4 * s;
          const g = ctx.createRadialGradient(p.x * s, p.y * s, 0, p.x * s, p.y * s, R);
          g.addColorStop(0, style.patches); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.fillRect(p.x * s - R, p.y * s - R, R * 2, R * 2);
        }
      }
      const pr = (style.plantR || 1.4) * dpr;
      ctx.fillStyle = style.plant; ctx.beginPath();
      for (const p of w.plants) { const x = p.x * s, y = p.y * s; ctx.moveTo(x + pr, y); ctx.arc(x, y, pr, 0, TAU); }
      ctx.fill();
      if (style.sprite === 'bird') {
        for (const a of w.herb) bird(a, a.x * s, a.y * s, 3.4 * dpr * a.size / 0.7, style.herb, t);
        for (const a of w.pred) bird(a, a.x * s, a.y * s, 4.8 * dpr * a.size, style.pred, t);
      } else {
        ctx.fillStyle = style.herb; ctx.beginPath();
        for (const a of w.herb) tri(a.x * s, a.y * s, a.h, 5 * dpr * a.size / 0.7);
        ctx.fill();
        ctx.fillStyle = style.pred; ctx.beginPath();
        for (const a of w.pred) tri(a.x * s, a.y * s, a.h, 7.5 * dpr * a.size);
        ctx.fill();
      }
      const sel = w.selected;
      if (sel) {
        const x = sel.x * s, y = sel.y * s, R = sel.range * s;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, R, sel.h - sel.fov / 2, sel.h + sel.fov / 2); ctx.closePath();
        ctx.fillStyle = style.wedge; ctx.fill();
        ctx.strokeStyle = style.wedgeLine || style.sel; ctx.lineWidth = 1 * dpr; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 11 * dpr, 0, TAU); ctx.strokeStyle = style.sel; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
      }
    }
    function pick(clientX, clientY, w) {
      const r = canvas.getBoundingClientRect();
      const pt = { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height };
      let best = null, bd = 0.02 * 0.02;
      for (const a of w.pred) { const q = d2(pt, a); if (q < bd) { bd = q; best = a; } }
      for (const a of w.herb) { const q = d2(pt, a); if (q < bd) { bd = q; best = a; } }
      return best;
    }
    function toScreen(a) {
      const r = canvas.getBoundingClientRect();
      return { x: r.left + a.x * r.width, y: r.top + a.y * r.height };
    }
    return { draw, resize, pick, toScreen, canvas };
  }

  // ---------- charts (SVG, hover layer, linked crosshair) ----------
  const NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }
  const groups = {};
  function setGroup(origin, j) {
    const list = origin.group ? groups[origin.group] : [origin];
    for (const c of list) { c.idx = j; if (c.setIndex) c.setIndex(j); }
  }
  function lineChart(root, opts) {
    let inst = root.__chart;
    if (!inst) {
      root.innerHTML = '';
      const svg = document.createElementNS(NS, 'svg'); root.appendChild(svg);
      const tt = document.createElement('div'); tt.className = 'tt'; root.appendChild(tt);
      inst = root.__chart = { svg, tt, idx: -1, group: opts.group };
      if (opts.group) (groups[opts.group] = groups[opts.group] || []).push(inst);
      svg.addEventListener('pointermove', (e) => {
        const r = svg.getBoundingClientRect();
        const i = Math.round(((e.clientX - r.left) - inst.ml) / inst.pw * (inst.n - 1));
        setGroup(inst, clamp(i, 0, inst.n - 1));
      });
      svg.addEventListener('pointerleave', () => setGroup(inst, -1));
    }
    const { svg, tt } = inst;
    const W = Math.max(120, root.clientWidth), H = opts.height || 120;
    const ml = opts.ml == null ? 36 : opts.ml, mr = opts.mr == null ? 52 : opts.mr, mt = 8, mb = opts.xAxis === false ? 6 : 18;
    const pw = W - ml - mr, ph = H - mt - mb;
    const series = opts.series, n = series[0].values.length, ink = opts.ink, fmt = opts.yFormat || compact;
    let maxV = 0; for (const s of series) for (const v of s.values) if (v > maxV) maxV = v;
    const yMax = niceMax(maxV * 1.08);
    const X = (i) => ml + (n > 1 ? i / (n - 1) : 0) * pw, Y = (v) => mt + ph - (v / yMax) * ph;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H);
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
    for (const s of series) {
      let d = '';
      s.values.forEach((v, i) => { d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); });
      if (opts.area) el('path', { d: d + `L${X(n - 1).toFixed(1)} ${Y(0)}L${X(0)} ${Y(0)}Z`, fill: s.color, opacity: 0.1 }, svg);
      el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    }
    const labels = series.map(s => ({ y: Y(s.values[n - 1]), v: s.values[n - 1] })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 12) labels[i].y = labels[i - 1].y + 12;
    for (const L of labels) {
      const yEnd = Y(L.v);
      if (Math.abs(L.y - yEnd) > 1) el('line', { x1: X(n - 1) + 5, y1: yEnd, x2: ml + pw + 7, y2: L.y, stroke: ink.axis, 'stroke-width': 1 }, svg);
      el('text', { x: ml + pw + 9, y: L.y + 3.5, fill: ink.secondary, 'font-size': 11, class: 'tn' }, svg).textContent = fmt(L.v);
    }
    for (const s of series) el('circle', { cx: X(n - 1), cy: Y(s.values[n - 1]), r: 4, fill: s.color, stroke: ink.surface, 'stroke-width': 2 }, svg);
    const cross = el('line', { x1: 0, x2: 0, y1: mt, y2: mt + ph, stroke: ink.axis, 'stroke-width': 1, visibility: 'hidden' }, svg);
    const dots = series.map(s => el('circle', { r: 4, fill: s.color, stroke: ink.surface, 'stroke-width': 2, visibility: 'hidden' }, svg));
    Object.assign(inst, { ml, pw, n });
    inst.setIndex = (j) => {
      if (j < 0) { cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); tt.style.display = 'none'; return; }
      const x = X(j);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
      series.forEach((s, k) => { dots[k].setAttribute('cx', x); dots[k].setAttribute('cy', Y(s.values[j])); dots[k].setAttribute('visibility', 'visible'); });
      tt.innerHTML = '';
      const xl = document.createElement('div'); xl.className = 'x'; xl.textContent = opts.xLabel ? opts.xLabel(j) : String(j); tt.appendChild(xl);
      for (const s of series) {
        const r = document.createElement('div'); r.className = 'r';
        const b = document.createElement('b'); b.textContent = fmt(s.values[j]);
        const sp = document.createElement('span'); const key = document.createElement('i'); key.style.background = s.color;
        sp.appendChild(key); sp.appendChild(document.createTextNode(s.name));
        r.appendChild(b); r.appendChild(sp); tt.appendChild(r);
      }
      tt.style.display = 'block';
      let left = x + 10; if (left + tt.offsetWidth > W - 4) left = x - tt.offsetWidth - 10;
      tt.style.left = left + 'px'; tt.style.top = mt + 'px';
    };
    if (inst.idx >= 0) inst.setIndex(Math.min(inst.idx, n - 1));
    if (opts.legendEl) {
      const L = opts.legendEl; L.innerHTML = '';
      if (series.length >= 2) for (const s of series) {
        const sp = document.createElement('span'); const b = document.createElement('b'); b.style.background = s.color;
        sp.appendChild(b); sp.appendChild(document.createTextNode(s.name)); L.appendChild(sp);
      }
    }
  }
  function renderTable(table, series, xLabel, rows, fmt) {
    fmt = fmt || compact;
    const n = series[0].values.length; table.innerHTML = '';
    const thead = document.createElement('thead'), tr = document.createElement('tr');
    const th0 = document.createElement('th'); th0.textContent = 'time'; tr.appendChild(th0);
    for (const s of series) { const th = document.createElement('th'); th.textContent = s.name; tr.appendChild(th); }
    thead.appendChild(tr); table.appendChild(thead);
    const tb = document.createElement('tbody');
    for (let i = n - 1; i >= Math.max(0, n - rows); i--) {
      const r = document.createElement('tr'); const td0 = document.createElement('td'); td0.textContent = xLabel(i); r.appendChild(td0);
      for (const s of series) { const td = document.createElement('td'); td.textContent = fmt(s.values[i]); r.appendChild(td); }
      tb.appendChild(r);
    }
    table.appendChild(tb);
  }
  function divColor(v, dark) {
    const t = Math.min(1, Math.abs(v) / 1.5);
    const mid = dark ? [56, 56, 53] : [240, 239, 236];
    const pole = v < 0 ? (dark ? [57, 135, 229] : [42, 120, 214]) : (dark ? [230, 103, 103] : [227, 73, 72]);
    return 'rgb(' + mid.map((m, i) => Math.round(m + (pole[i] - m) * t)).join(',') + ')';
  }
  function synthSeries(n, fn) { const out = new Array(n); for (let i = 0; i < n; i++) out[i] = Math.max(0, fn(i)); return out; }
  function scaleToEnd(arr, end) { const last = arr[arr.length - 1] || 1; const k = end / last; return arr.map(v => Math.max(0, v * k)); }

  global.Mock = { rand, gauss, clamp, fmtInt, compact, degOf, mean, createWorld, step, spawnAgent, makeRenderer, lineChart, renderTable, divColor, synthSeries, scaleToEnd };
})(window);
