/**
 * "Meet a bird": portrait, energy, facts, body traits, what its eyes see
 * right now, its family, and its brain's hidden-layer weights as a heatmap.
 * The genome never changes during a bird's life, so the heatmap is built
 * once per bird; the retina strip is repainted every frame and the family
 * block whenever the worker sends a fresh one.
 */

import { drawBird } from '../render/sprites';
import {
  HERBIVORE,
  PREDATOR,
  speciesIndex,
  speciesParams,
  type Cause,
  type Config,
  type Family,
  type Inspection,
  type LineageRecord,
  type Shape,
} from '../sim/types';
import { divergingColor } from './charts';
import { degOf, fmtInt } from './format';

const $ = (id: string): HTMLElement => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e;
};

const CHANNEL_NAMES = ['seeds', 'sparrows', 'hawks'];
const CHANNEL_COLORS = ['#1baf7a', '#2a78d6', '#eb6834'];
/** Ancestors shown in full; older ones collapse into a count. */
const ANCESTORS_SHOWN = 5;

export class Inspector {
  private builtFor = -1;
  private familyFor: Family | null = null;
  private retinaCells: HTMLDivElement[] = [];
  private readonly root = $('insp');
  private readonly empty = $('insp-empty');
  private readonly body = $('insp-body');

  constructor(
    private readonly config: () => Config,
    private readonly onSelect: (id: number) => void,
  ) {}

  /** Nothing selected. */
  clear(): void {
    this.builtFor = -1;
    this.familyFor = null;
    this.empty.style.display = '';
    this.body.style.display = 'none';
    this.root.classList.remove('has-bird');
  }

  update(a: Inspection, tick: number, shape: Shape, family: Family | null, relatives: number): void {
    const species = speciesIndex(a.species);
    const hawk = species === PREDATOR;
    const cfg = this.config();
    const sp = speciesParams(cfg, species);
    this.empty.style.display = 'none';
    this.body.style.display = '';
    this.root.classList.add('has-bird');
    this.root.style.setProperty('--c', hawk ? 'var(--pred)' : 'var(--herb)');

    if (this.builtFor !== a.id) {
      this.builtFor = a.id;
      this.familyFor = null;
      this.portrait(a);
      this.brain(a, shape);
      this.retinaGrid(shape);
      $('i-name').textContent = (hawk ? 'Hawk' : 'Sparrow') + ' #' + a.id;
      $('i-kind').textContent = a.generation === 0 ? (a.parent === 0 ? 'founder' : '') : 'generation ' + a.generation;
      $('i-story').textContent = hawk
        ? `Sees a ${degOf(a.traits.fov_angle)}° cone out to ${(a.traits.fov_range * 100).toFixed(0)}% of the world. A hunter's eyes.`
        : `Sees ${degOf(a.traits.fov_angle)}° around itself. Wide eyes mean fewer surprises from hawks.`;
      $('fam').innerHTML = '';
      $('fam-empty').style.display = '';
    }

    $('i-e').textContent = a.energy.toFixed(2);
    $('i-m').style.width = Math.round((100 * a.energy) / sp.max_energy) + '%';
    $('i-age').textContent = fmtInt(a.age);
    $('i-kids').textContent = String(a.children);
    $('i-meals').textContent = String(a.meals);
    $('i-meal').textContent = a.last_meal ? fmtInt(tick - a.last_meal) + ' ticks ago' : 'not yet';
    $('i-spd').textContent = (a.speed / Math.max(1e-9, a.traits.max_speed)).toFixed(2) + '× top';

    const b = sp.traits;
    const frac = (v: number, lo: number, hi: number): number => (hi > lo ? (v - lo) / (hi - lo) : 0);
    this.trait('t-fov', frac(a.traits.fov_angle, b.fov_angle.min, b.fov_angle.max), degOf(a.traits.fov_angle) + '°');
    this.trait('t-rng', frac(a.traits.fov_range, b.fov_range.min, b.fov_range.max), (a.traits.fov_range * 100).toFixed(1) + '%');
    this.trait('t-spd', frac(a.traits.max_speed, b.max_speed.min, b.max_speed.max), (a.traits.max_speed * 1000).toFixed(2) + '‰');
    this.trait('t-size', frac(a.traits.size, b.size.min, b.size.max), a.traits.size.toFixed(2) + '×');

    this.retina(a, shape);
    if (family && family !== this.familyFor) {
      this.familyFor = family;
      this.family(family, tick, relatives);
    }
  }

  private trait(id: string, frac: number, text: string): void {
    $(id + '-b').style.width = Math.round(Math.min(1, Math.max(0, frac)) * 100) + '%';
    $(id).textContent = text;
  }

  private portrait(a: Inspection): void {
    const canvas = $('portrait') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const species = speciesIndex(a.species);
    const r = species === PREDATOR ? 17 : 19;
    drawBird(ctx, canvas.width / 2 - 2, canvas.height / 2, r, species, 1, -0.5);
  }

  private retinaGrid(shape: Shape): void {
    const grid = $('retina');
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = `56px repeat(${shape.retina_cells}, 1fr)`;
    this.retinaCells = [];
    for (let ch = 0; ch < shape.channels; ch++) {
      const label = document.createElement('span');
      label.textContent = CHANNEL_NAMES[ch] ?? String(ch);
      grid.appendChild(label);
      for (let c = 0; c < shape.retina_cells; c++) {
        const cell = document.createElement('div');
        cell.style.background = CHANNEL_COLORS[ch] ?? '#888';
        cell.style.opacity = '0.08';
        cell.title = `${CHANNEL_NAMES[ch]} · cell ${c + 1} of ${shape.retina_cells} (left to right)`;
        grid.appendChild(cell);
        this.retinaCells.push(cell);
      }
    }
  }

  private retina(a: Inspection, shape: Shape): void {
    const n = shape.channels * shape.retina_cells;
    for (let i = 0; i < n && i < this.retinaCells.length; i++) {
      // Cells sweep from the right edge of the field of view (index 0, at
      // -fov/2) to the left edge; show them left-to-right as the bird sees.
      const ch = Math.floor(i / shape.retina_cells);
      const c = i % shape.retina_cells;
      const v = a.retina[ch * shape.retina_cells + (shape.retina_cells - 1 - c)] ?? 0;
      this.retinaCells[i]!.style.opacity = (0.08 + 0.92 * Math.min(1, v / 1.2)).toFixed(2);
    }
  }

  private family(f: Family, tick: number, relatives: number): void {
    const box = $('fam');
    box.innerHTML = '';
    $('fam-empty').style.display = 'none';
    // Oldest ancestor at the top, the bird itself at the bottom.
    const chain = [...f.ancestors].reverse();
    const hidden = Math.max(0, chain.length - ANCESTORS_SHOWN);
    if (hidden > 0) {
      const more = document.createElement('div');
      more.className = 'fam-more';
      more.textContent = `… ${hidden} older generation${hidden === 1 ? '' : 's'}`;
      box.appendChild(more);
    }
    for (const r of chain.slice(hidden)) box.appendChild(this.record(r, tick, ancestorLabel(r)));
    const me = document.createElement('div');
    me.className = 'fam-row me';
    me.textContent = f.subject.parent === 0 ? 'this bird · a founder' : `this bird · generation ${f.subject.generation}`;
    box.appendChild(me);

    const kids = document.createElement('div');
    kids.className = 'fam-kids';
    const alive = f.children.filter((c) => c.died === null);
    const label = document.createElement('span');
    label.textContent = f.subject.children === 0 ? 'No chicks yet' : `Chicks: ${alive.length} alive of ${f.subject.children}`;
    kids.appendChild(label);
    for (const c of alive.slice(0, 12)) {
      const chip = document.createElement('button');
      chip.className = 'chipbtn';
      chip.textContent = '#' + c.id;
      chip.title = `Select ${c.species === 'Predator' ? 'hawk' : 'sparrow'} #${c.id}, born at tick ${fmtInt(c.born)}`;
      chip.addEventListener('click', () => this.onSelect(c.id));
      kids.appendChild(chip);
    }
    if (alive.length > 12) {
      const rest = document.createElement('span');
      rest.textContent = `+${alive.length - 12}`;
      kids.appendChild(rest);
    }
    box.appendChild(kids);

    const facts = document.createElement('div');
    facts.className = 'facts tn';
    facts.innerHTML =
      `<div><span>Living descendants</span><b>${fmtInt(f.living_descendants)}</b></div>` +
      `<div><span title="Living birds that share this bird's grandparent, shown with a halo on the map">Relatives on the map</span><b>${fmtInt(relatives)}</b></div>`;
    box.appendChild(facts);
  }

  private record(r: LineageRecord, tick: number, label: string): HTMLElement {
    const alive = r.died === null;
    const row = document.createElement(alive ? 'button' : 'div');
    row.className = 'fam-row' + (alive ? ' alive' : '');
    const hawk = r.species === 'Predator';
    const name = (hawk ? 'Hawk' : 'Sparrow') + ' #' + r.id;
    const life = fmtInt((r.died ?? tick) - r.born);
    const fate = alive ? 'still alive' : causeText(r.cause);
    row.textContent = `${label} · ${name} · ${life} ticks · ${r.children} chick${r.children === 1 ? '' : 's'} · ${fate}`;
    if (alive) {
      row.title = `Select ${name}`;
      row.addEventListener('click', () => this.onSelect(r.id));
    }
    return row;
  }

  private brain(a: Inspection, shape: Shape): void {
    const grid = $('brain');
    grid.innerHTML = '';
    const cols = shape.inputs + 1;
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    const header = $('brain-head');
    header.innerHTML = '';
    header.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    const inputName = (j: number): string => {
      if (j === 0) return 'bias';
      const k = j - 1;
      const ch = Math.floor(k / shape.retina_cells);
      if (ch < shape.channels) return `${CHANNEL_NAMES[ch]} cell ${(k % shape.retina_cells) + 1}`;
      return k - shape.channels * shape.retina_cells === 0 ? 'own energy' : 'own speed';
    };
    const inputColor = (j: number): string => {
      if (j === 0) return '#898781';
      const ch = Math.floor((j - 1) / shape.retina_cells);
      return ch < shape.channels ? (CHANNEL_COLORS[ch] ?? '#888') : '#898781';
    };
    for (let j = 0; j < cols; j++) {
      const m = document.createElement('i');
      m.style.background = inputColor(j);
      m.title = inputName(j);
      header.appendChild(m);
    }
    let maxAbs = 0.5;
    for (let i = 0; i < cols * shape.hidden; i++) maxAbs = Math.max(maxAbs, Math.abs(a.weights[i] ?? 0));
    for (let h = 0; h < shape.hidden; h++) {
      for (let j = 0; j < cols; j++) {
        const w = a.weights[h * cols + j] ?? 0;
        const d = document.createElement('div');
        d.style.background = divergingColor(w, maxAbs);
        d.title = `${inputName(j)} → neuron ${h + 1}: ${w >= 0 ? '+' : ''}${w.toFixed(2)}`;
        grid.appendChild(d);
      }
    }
    $('brain-cap').textContent = `brain weights · ${shape.inputs} inputs × ${shape.hidden} neurons`;
  }
}

function ancestorLabel(r: LineageRecord): string {
  return r.parent === 0 ? 'founder' : `gen ${r.generation}`;
}

const CAUSES: Record<Cause, string> = {
  Starved: 'starved',
  Aged: 'died of old age',
  Predated: 'eaten by a hawk',
  Struck: 'hit by a meteor',
};

export function causeText(cause: Cause | null): string {
  return cause ? CAUSES[cause] : 'gone';
}

/** One-line status for the callout, derived from what the bird sees. */
export function describe(a: Inspection, tick: number, cfg: Config, shape: Shape): string {
  const species = speciesIndex(a.species);
  const sp = speciesParams(cfg, species);
  const cells = shape.retina_cells;
  const max = (ch: number): number => {
    let m = 0;
    for (let i = 0; i < cells; i++) m = Math.max(m, a.retina[ch * cells + i] ?? 0);
    return m;
  };
  if (a.last_meal && tick - a.last_meal < 40) return 'just ate';
  if (species === PREDATOR) return max(1) > 0.25 ? 'stalking a sparrow' : 'hunting';
  if (max(2) > 0.25) return 'hawk in sight!';
  if (max(0) > 0.25) return 'heading for a seed';
  if (a.energy >= sp.reproduce_threshold * sp.max_energy && a.age >= sp.maturity_age) return 'ready to breed';
  return species === HERBIVORE ? 'wandering' : 'hunting';
}
