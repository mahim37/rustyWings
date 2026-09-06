/**
 * Wires the page together: worker client, renderer, charts, inspector,
 * settings, files, theme, URL state and input. No framework; the DOM is the
 * state for things the DOM already knows, and this class holds the rest.
 */

import { Renderer } from './render/renderer';
import { SimClient } from './sim/client';
import { BASE_UPS, type EventKind } from './sim/protocol';
import type { Config, Family, Inspection, Shape } from './sim/types';
import { lineChart, renderTable, type Ink } from './ui/charts';
import { clamp, fmtInt, ticksAgo } from './ui/format';
import { History, toSample } from './ui/history';
import { describe, Inspector } from './ui/inspector';
import { updateKpis } from './ui/kpis';
import { Settings } from './ui/settings';
import { applyTheme, cssColor, readTheme, THEME_KEY, THEMES } from './ui/theme';
import { toast } from './ui/toast';
import { applyPatch, buildUrl, parseUrl, randomSeed } from './url';

const SPEEDS = [
  { label: '1×', ups: BASE_UPS },
  { label: '4×', ups: BASE_UPS * 4 },
  { label: '16×', ups: BASE_UPS * 16 },
  { label: 'max', ups: Infinity },
];
const WINDOWS = [5_000, 25_000, 100_000];
const POINTS = 160;
const METEOR_RADIUS = 0.06;
const SCATTER_SEEDS = 400;
const PICK_RADIUS_PX = 14;
/** Extension of a saved world; the CLI's `--resume` reads the same bytes. */
const WORLD_EXT = '.world';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as T;
};

export class App {
  private readonly client = new SimClient();
  private readonly renderer: Renderer;
  private readonly history = new History();
  private readonly inspector: Inspector;
  private settings: Settings | null = null;
  private defaults: Config | null = null;
  private config: Config | null = null;
  private shape: Shape | null = null;
  private version = '';
  private seed = '1';
  private tick = 0;
  private ups = 0;
  private playing = true;
  private speedIdx = 0;
  private windowIdx = 0;
  private follow = false;
  private showVision = false;
  private showPatches = true;
  private showTrail = true;
  private meteorArmed = false;
  private tableOpen = false;
  private selectedId = -1;
  private inspection: Inspection | null = null;
  private family: Family | null = null;
  private relatives = 0;
  private checksum = '';
  /** True while the first world is being built from settings in the URL. */
  private pendingPatch = false;
  private frames = 0;
  private lastSecond = performance.now();
  private lastChartAt = 0;
  private chartsDirty = true;
  private ink: Ink = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#fcfcfb' };
  private color = { herb: '#2a78d6', pred: '#eb6834', plant: '#1baf7a' };
  private readonly canvas = $<HTMLCanvasElement>('world');
  private readonly darkMedia = matchMedia('(prefers-color-scheme: dark)');

  constructor() {
    this.renderer = new Renderer(this.canvas);
    this.inspector = new Inspector(
      () => this.config ?? this.defaults!,
      (id) => this.client.selectId(id),
    );
    this.bindWorker();
    this.bindStage();
    this.bindControls();
    this.bindFiles();
    this.bindTheme();
    this.bindKeys();
  }

  start(): void {
    const url = parseUrl(location.search);
    this.seed = url.seed ?? randomSeed();
    this.client.on('defaults', (m) => {
      this.defaults = m.config;
      this.version = m.version;
      let config = m.config;
      if (url.patch) {
        try {
          config = applyPatch(m.config, url.patch);
        } catch {
          toast('The settings in this link could not be read; using defaults');
        }
      }
      this.settings = new Settings(m.config, config, (c) => this.applyConfig(c));
      this.pendingPatch = config !== m.config;
      this.client.init(this.seed, config);
    });
    this.client.requestDefaults();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ----- worker events --------------------------------------------------

  private bindWorker(): void {
    this.client.on('ready', (m) => {
      this.pendingPatch = false;
      this.seed = m.seed;
      this.tick = m.tick;
      this.config = m.config;
      this.shape = m.shape;
      this.version = m.version;
      this.settings?.reflect(m.config);
      this.history.clear();
      this.inspector.clear();
      this.selectedId = -1;
      this.inspection = null;
      this.family = null;
      this.follow = false;
      this.chartsDirty = true;
      $('seed-text').textContent = 'seed ' + m.seed;
      $('grid').textContent = `grid ${m.config.world.grid_cells}×${m.config.world.grid_cells}`;
      $('ver').textContent = `v${m.version} · ${__BUILD_SHA__}`;
      this.syncUrl();
      this.client.speed(SPEEDS[this.speedIdx]!.ups);
      this.client.play(this.playing);
      $('stage-error').style.display = 'none';
      if (m.tick > 0) toast(`Opened a world at tick ${fmtInt(m.tick)}`);
    });
    this.client.on('frame', (m) => {
      this.tick = m.tick;
      this.ups = m.ups;
      if (m.playing !== this.playing) this.setPlaying(m.playing, false);
      for (const s of m.samples) this.history.push(toSample(s));
      if (m.samples.length) this.chartsDirty = true;
      if (m.checksum) this.checksum = m.checksum;
      if (m.inspection !== undefined) {
        if (m.inspection === null && this.selectedId >= 0) {
          toast((this.inspection && this.inspection.species === 'Predator' ? 'Hawk' : 'Sparrow') + ' #' + this.selectedId + ' died');
          this.follow = false;
        }
        this.inspection = m.inspection;
      }
      if (m.family !== undefined) {
        this.family = m.family;
        this.relatives = m.relatives ?? 0;
      }
      if (m.selectedId !== this.selectedId) this.family = null;
      this.selectedId = m.selectedId;
      if (this.selectedId < 0) this.inspection = null;
      this.renderer.upload(new Float32Array(m.buffer, 0, m.length));
      this.client.recycle(m.buffer);
    });
    this.client.on('event', (m) => this.announce(m.kind, m.detail));
    this.client.on('reset', (m) => {
      this.history.truncateAfter(m.tick);
      this.inspector.clear();
      this.selectedId = -1;
      this.inspection = null;
      this.family = null;
      this.chartsDirty = true;
    });
    this.client.on('genome', (m) => {
      if (!m.inspection) {
        toast('That bird is gone');
        return;
      }
      const a = m.inspection;
      const name = (a.species === 'Predator' ? 'hawk' : 'sparrow') + '-' + a.id;
      const body = {
        format: 'rustywings-genome',
        version: this.version,
        seed: m.seed,
        tick: m.tick,
        id: a.id,
        species: a.species,
        generation: a.generation,
        traits: a.traits,
        weights: a.weights,
      };
      download(name + '.json', new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
      toast('Saved ' + name + '.json');
    });
    this.client.on('export', (m) => {
      const name = `rustywings-${m.seed}-t${m.tick}${WORLD_EXT}`;
      download(name, new Blob([m.bytes], { type: 'application/octet-stream' }));
      toast(`Saved ${name} · open it here later, or run it with \`rustywings run --resume\``, 5000);
    });
    this.client.on('error', (m) => {
      if (m.fatal && this.pendingPatch && this.defaults) {
        // A shared link carried settings the sim refused; the world is still
        // worth showing, so fall back to defaults and say why.
        this.pendingPatch = false;
        toast(`The settings in this link were rejected (${m.message}). Using defaults.`, 6000);
        this.settings?.reflect(this.defaults);
        this.client.init(this.seed, this.defaults);
        return;
      }
      if (m.fatal) {
        const box = $('stage-error');
        box.textContent = m.message;
        box.style.display = '';
      } else toast(m.message, 5000);
    });
  }

  private announce(kind: EventKind, detail: number): void {
    switch (kind) {
      case 'strike':
        toast(`Meteor strike: ${fmtInt(detail)} birds lost`);
        break;
      case 'scatter':
        toast(`${fmtInt(detail)} seeds scattered`);
        break;
      case 'spawn':
        toast(`${fmtInt(detail)} birds released`);
        break;
      case 'introduce':
        toast(`Released bird #${detail} from the file; it is selected`);
        break;
      case 'snapshot':
        toast(`Snapshot saved at tick ${fmtInt(detail)}`);
        break;
      case 'rewind':
        toast(`Rewound to tick ${fmtInt(detail)}`);
        break;
      case 'restart':
        toast('No snapshot yet, so back to tick 0');
        break;
    }
  }

  // ----- per-frame ------------------------------------------------------

  private frame(now: number): void {
    const sel = this.renderer.selected;
    if (this.follow && sel) this.renderer.camera.follow(sel.x, sel.y, 0.18);
    this.renderer.draw({
      showVision: this.showVision,
      showPatches: this.showPatches,
      showTrail: this.showTrail,
      patchRadius: this.config?.plants.patch_radius ?? 0.05,
    });
    this.hud();
    this.callout();
    if (this.inspection && this.shape) this.inspector.update(this.inspection, this.tick, this.shape, this.family, this.relatives);
    else if (this.selectedId < 0) this.inspector.clear();
    if (this.chartsDirty && now - this.lastChartAt > 160) {
      updateKpis(this.history);
      this.renderCharts();
      this.lastChartAt = now;
      this.chartsDirty = false;
    }
    this.frames++;
    if (now - this.lastSecond >= 1000) {
      $('fps').textContent = String(this.frames);
      $('ups').textContent = fmtInt(this.ups);
      $('na').textContent = fmtInt(this.renderer.counts.agents);
      $('sum').textContent = this.checksum || '—';
      this.frames = 0;
      this.lastSecond = now;
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  private hud(): void {
    $('tick').textContent = fmtInt(this.tick);
    const c = this.renderer.counts;
    $('h-herb').textContent = fmtInt(c.herb);
    $('h-pred').textContent = fmtInt(c.pred);
    $('h-plant').textContent = fmtInt(c.plants);
    $('play').textContent = this.playing ? '⏸' : '▶';
    $('play').classList.toggle('on', this.playing);
    $('follow').classList.toggle('on', this.follow);
  }

  private callout(): void {
    const co = $('callout');
    const sel = this.renderer.selected;
    const a = this.inspection;
    if (!sel || !a || !this.config || !this.shape) {
      co.style.display = 'none';
      return;
    }
    const [sx, sy] = this.renderer.camera.worldToScreen(sel.x, sel.y);
    const size = this.renderer.camera.size;
    if (sx < 0 || sy < 0 || sx > size || sy > size) {
      co.style.display = 'none';
      return;
    }
    const left = this.canvas.offsetLeft + sx;
    const top = this.canvas.offsetTop + sy;
    const flip = sx > size - 240;
    co.classList.toggle('flip', flip);
    co.style.left = (flip ? left - 18 : left + 18) + 'px';
    co.style.top = top - 14 + 'px';
    co.style.display = '';
    const name = (a.species === 'Predator' ? 'Hawk' : 'Sparrow') + ' #' + a.id;
    const text = `${name} · ${describe(a, this.tick, this.config, this.shape)} · ${Math.round(sel.energy * 100)}% energy`;
    if (co.dataset['text'] !== text) {
      co.dataset['text'] = text;
      co.innerHTML = '';
      const b = document.createElement('b');
      b.textContent = name;
      co.appendChild(b);
      co.appendChild(document.createTextNode(text.slice(name.length)));
    }
  }

  private renderCharts(): void {
    const w = WINDOWS[this.windowIdx]!;
    const width = w / POINTS;
    const xLabel = (i: number): string => ticksAgo(Math.round(w - (i + 1) * width));
    const herb = this.history.window('herb', w, POINTS).values;
    const pred = this.history.window('pred', w, POINTS).values;
    const plants = this.history.window('plants', w, POINTS).values;
    const fovH = this.history.window('fovH', w, POINTS).values;
    const fovP = this.history.window('fovP', w, POINTS).values;
    const ink = this.ink;
    const color = this.color;
    const mini = { ink, group: 'pop', height: 68, xAxis: false, ml: 40, xLabel, area: true };
    lineChart($('c-herb'), { ...mini, series: [{ name: 'Sparrows', color: color.herb, values: herb }] });
    lineChart($('c-pred'), { ...mini, series: [{ name: 'Hawks', color: color.pred, values: pred }] });
    lineChart($('c-plants'), { ...mini, height: 82, xAxis: true, series: [{ name: 'Seeds', color: color.plant, values: plants }] });
    lineChart($('c-fov'), {
      ink,
      height: 118,
      ml: 40,
      xLabel,
      yFormat: (v) => Math.round(v) + '°',
      legendEl: $('lg-fov'),
      series: [
        { name: 'Sparrows', color: color.herb, values: fovH },
        { name: 'Hawks', color: color.pred, values: fovP },
      ],
    });
    if (this.tableOpen) {
      renderTable(
        $<HTMLTableElement>('tv'),
        [
          { name: 'Sparrows', color: color.herb, values: herb },
          { name: 'Hawks', color: color.pred, values: pred },
          { name: 'Seeds', color: color.plant, values: plants },
        ],
        xLabel,
        8,
      );
    }
    const s = this.history.latest;
    if (s) {
      const wedge = (deg: number): string => {
        const a = (deg * Math.PI) / 180;
        const r = 14;
        const x1 = Math.cos(-a / 2) * r;
        const y1 = Math.sin(-a / 2) * r;
        const x2 = Math.cos(a / 2) * r;
        const y2 = Math.sin(a / 2) * r;
        return `M0 0 L${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
      };
      $('eye-h').setAttribute('d', wedge(Math.min(359.9, s.fovH)));
      $('eye-p').setAttribute('d', wedge(Math.min(359.9, s.fovP)));
      $('e-h').textContent = Math.round(s.fovH) + '°';
      $('e-p').textContent = Math.round(s.fovP) + '°';
    }
  }

  // ----- stage interaction ----------------------------------------------

  private bindStage(): void {
    const stage = $('stage');
    const fit = (): void => {
      const r = stage.getBoundingClientRect();
      const size = Math.max(120, Math.floor(Math.min(r.width, r.height) - 28));
      this.renderer.resize(size);
    };
    new ResizeObserver(fit).observe(stage);
    fit();

    let down: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      down = { x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, moved: false };
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - down.cx;
      const dy = e.clientY - down.cy;
      if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 4) down.moved = true;
      if (down.moved) {
        this.renderer.camera.panByPixels(dx, dy);
        this.follow = false;
      }
      down.cx = e.clientX;
      down.cy = e.clientY;
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down) return;
      const wasClick = !down.moved;
      down = null;
      if (!wasClick) return;
      const r = this.canvas.getBoundingClientRect();
      const [wx, wy] = this.renderer.camera.screenToWorld(e.clientX - r.left, e.clientY - r.top);
      if (this.meteorArmed) {
        this.armMeteor(false);
        this.client.strike(wx, wy, METEOR_RADIUS);
      } else {
        this.client.select(wx, wy, PICK_RADIUS_PX * this.renderer.camera.unitsPerPixel);
      }
    });
    this.canvas.addEventListener('pointercancel', () => (down = null));
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = this.canvas.getBoundingClientRect();
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
        this.renderer.camera.zoomAt(factor, e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );
    this.canvas.addEventListener('dblclick', () => this.renderer.camera.reset());

    if (localStorage.getItem('rustywings.welcomed')) $('welcome').remove();
    $('wx').addEventListener('click', () => {
      localStorage.setItem('rustywings.welcomed', '1');
      $('welcome').remove();
    });
  }

  private armMeteor(on: boolean): void {
    this.meteorArmed = on;
    this.canvas.classList.toggle('aim', on);
    $('meteor').classList.toggle('on', on);
    if (on) toast('Click where the meteor should land · Esc to cancel', 4000);
  }

  // ----- controls -------------------------------------------------------

  private bindControls(): void {
    const speedBox = $('speed');
    speedBox.innerHTML = '';
    SPEEDS.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'btn' + (i === this.speedIdx ? ' on' : '');
      b.textContent = s.label;
      b.title = s.ups === Infinity ? 'As fast as this machine can go' : `${s.ups} ticks per second`;
      b.addEventListener('click', () => this.setSpeed(i));
      speedBox.appendChild(b);
    });
    $('play').addEventListener('click', () => this.setPlaying(!this.playing));
    $('stepbtn').addEventListener('click', () => this.stepOnce());
    $('rewind').addEventListener('click', () => this.client.rewind());
    $('snapshot').addEventListener('click', () => this.client.snapshot());
    $('seeds').addEventListener('click', () => this.client.scatter(SCATTER_SEEDS));
    $('meteor').addEventListener('click', () => this.armMeteor(!this.meteorArmed));
    $('share').addEventListener('click', () => this.share());
    $('help-btn').addEventListener('click', () => this.toggleHelp());
    $('help-close').addEventListener('click', () => this.toggleHelp(false));
    $('dice').addEventListener('click', () => this.newWorld(randomSeed()));
    $('seed').addEventListener('click', () => this.editSeed());

    const windowBox = $('window');
    windowBox.innerHTML = '';
    WINDOWS.forEach((w, i) => {
      const b = document.createElement('button');
      b.className = 'btn' + (i === this.windowIdx ? ' on' : '');
      b.textContent = (w / 1000).toFixed(0) + 'k';
      b.title = `Last ${fmtInt(w)} ticks`;
      b.addEventListener('click', () => {
        this.windowIdx = i;
        windowBox.querySelectorAll('.btn').forEach((x, k) => x.classList.toggle('on', k === i));
        this.chartsDirty = true;
      });
      windowBox.appendChild(b);
    });
    $('tvlink').addEventListener('click', () => {
      this.tableOpen = !this.tableOpen;
      $('tv').style.display = this.tableOpen ? '' : 'none';
      $('tvlink').textContent = this.tableOpen ? 'hide table' : 'table';
      this.chartsDirty = true;
    });

    $('pick').addEventListener('click', () => this.client.selectRandom());
    $('follow').addEventListener('click', () => this.toggleFollow());
    $('save-genome').addEventListener('click', () => {
      if (this.selectedId >= 0) this.client.genome(this.selectedId);
    });

    $('reset-settings').addEventListener('click', () => this.settings?.reset());
    $('copy-config').addEventListener('click', () => {
      if (!this.config) return;
      void copy(JSON.stringify(this.config, null, 2)).then(() =>
        toast('Config copied · save it as a file for `rustywings run --config`', 4000),
      );
    });
    document.querySelectorAll<HTMLElement>('.sw[data-t]').forEach((sw) => {
      sw.addEventListener('click', () => this.toggleSwitch(sw));
    });
  }

  private toggleSwitch(sw: HTMLElement): void {
    const on = sw.classList.toggle('on');
    sw.setAttribute('aria-checked', String(on));
    const name = sw.dataset['t'];
    if (name === 'vision') this.showVision = on;
    else if (name === 'patches') this.showPatches = on;
    else if (name === 'trail') this.showTrail = on;
  }

  private toggle(name: string): void {
    document.querySelector<HTMLElement>(`.sw[data-t="${name}"]`)?.click();
  }

  // ----- files ----------------------------------------------------------

  private bindFiles(): void {
    const input = $<HTMLInputElement>('file-in');
    $('save-world').addEventListener('click', () => this.client.export());
    $('open-world').addEventListener('click', () => {
      input.accept = WORLD_EXT;
      input.click();
    });
    $('release').addEventListener('click', () => {
      input.accept = '.json';
      input.click();
    });
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.value = '';
      if (f) void this.openFile(f);
    });
    // Dropping a file anywhere on the stage opens it.
    const stage = $('stage');
    stage.addEventListener('dragover', (e) => {
      e.preventDefault();
      stage.classList.add('drop');
    });
    stage.addEventListener('dragleave', () => stage.classList.remove('drop'));
    stage.addEventListener('drop', (e) => {
      e.preventDefault();
      stage.classList.remove('drop');
      const f = e.dataTransfer?.files[0];
      if (f) void this.openFile(f);
    });
  }

  /** A `.world` file replaces the world; a genome `.json` releases a bird. */
  private async openFile(f: File): Promise<void> {
    if (f.name.endsWith(WORLD_EXT)) {
      this.client.restore(await f.arrayBuffer());
      return;
    }
    if (f.name.endsWith('.json')) {
      const text = await f.text();
      let species: 0 | 1;
      try {
        const g = JSON.parse(text) as { format?: string; species?: string };
        if (g.format !== 'rustywings-genome') throw new Error('not a genome');
        species = g.species === 'Predator' ? 1 : 0;
      } catch {
        toast(`${f.name} is not a saved genome`);
        return;
      }
      this.client.introduce(species, text);
      return;
    }
    toast(`Drop a ${WORLD_EXT} file to open a world, or a saved genome .json to release a bird`, 4000);
  }

  // ----- theme ----------------------------------------------------------

  private bindTheme(): void {
    const box = $('theme');
    box.innerHTML = '';
    for (const t of THEMES) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = t.label;
      b.dataset['choice'] = t.choice;
      b.addEventListener('click', () => {
        localStorage.setItem(THEME_KEY, t.choice);
        this.syncTheme();
      });
      box.appendChild(b);
    }
    this.darkMedia.addEventListener('change', () => this.syncTheme());
    this.syncTheme();
  }

  /** Apply the stored theme choice and re-read every colour the canvas and charts use. */
  private syncTheme(): void {
    const choice = readTheme();
    $('theme')
      .querySelectorAll<HTMLElement>('.btn')
      .forEach((b) => b.classList.toggle('on', b.dataset['choice'] === choice));
    applyTheme(choice, this.darkMedia.matches);
    this.ink = {
      primary: cssColor('--ink'),
      secondary: cssColor('--ink-2'),
      muted: cssColor('--ink-3'),
      grid: cssColor('--grid'),
      axis: cssColor('--axis'),
      surface: cssColor('--surface'),
    };
    this.color = { herb: cssColor('--herb'), pred: cssColor('--pred'), plant: cssColor('--plant') };
    this.renderer.setTheme({ field: cssColor('--field'), ink: cssColor('--ink') });
    this.chartsDirty = true;
  }

  private applyConfig(c: Config): void {
    this.config = c;
    this.client.setConfig(c);
    this.syncUrl();
  }

  private setSpeed(i: number): void {
    this.speedIdx = clamp(i, 0, SPEEDS.length - 1);
    $('speed')
      .querySelectorAll('.btn')
      .forEach((b, k) => b.classList.toggle('on', k === this.speedIdx));
    this.client.speed(SPEEDS[this.speedIdx]!.ups);
  }

  private setPlaying(p: boolean, tell = true): void {
    this.playing = p;
    if (tell) this.client.play(p);
  }

  private stepOnce(): void {
    this.playing = false;
    this.client.step(1);
  }

  private toggleFollow(): void {
    if (this.selectedId < 0) {
      toast('Click a bird first');
      return;
    }
    this.follow = !this.follow;
  }

  private toggleHelp(force?: boolean): void {
    const d = $<HTMLDialogElement>('help');
    const open = force ?? !d.open;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }

  private newWorld(seed: string): void {
    this.seed = seed;
    this.client.init(seed, this.settings?.config ?? null);
  }

  private editSeed(): void {
    const chip = $('seed');
    if (chip.querySelector('input')) return;
    const text = $('seed-text');
    const input = document.createElement('input');
    input.value = this.seed;
    input.maxLength = 18;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'seed, hexadecimal');
    text.textContent = 'seed ';
    chip.appendChild(input);
    input.focus();
    input.select();
    const finish = (commit: boolean): void => {
      const v = input.value.trim().replace(/^0x/i, '').toLowerCase();
      input.remove();
      text.textContent = 'seed ' + this.seed;
      if (!commit) return;
      if (!/^[0-9a-f]{1,16}$/.test(v)) {
        toast('A seed is 1 to 16 hex digits');
        return;
      }
      if (v !== this.seed) this.newWorld(v);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(false));
  }

  private syncUrl(): void {
    if (!this.defaults || !this.config) return;
    const url = buildUrl(location.href, this.seed, this.config, this.defaults);
    history.replaceState(null, '', url);
  }

  private share(): void {
    if (!this.defaults || !this.config) return;
    const url = buildUrl(location.href, this.seed, this.config, this.defaults);
    void copy(url).then(
      () => toast('Link copied · the same seed and settings replay this world from tick 0', 4000),
      () => toast(url, 6000),
    );
  }

  // ----- keyboard -------------------------------------------------------

  private bindKeys(): void {
    document.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const help = $<HTMLDialogElement>('help');
      if (help.open && e.key !== 'Escape' && e.key !== '?') return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          this.setPlaying(!this.playing);
          break;
        case '.':
          this.stepOnce();
          break;
        case ']':
          this.setSpeed(this.speedIdx + 1);
          break;
        case '[':
          this.setSpeed(this.speedIdx - 1);
          break;
        case 'f':
        case 'F':
          this.toggleFollow();
          break;
        case 'r':
        case 'R':
          this.client.selectRandom();
          break;
        case 'v':
        case 'V':
          this.toggle('vision');
          break;
        case 't':
        case 'T':
          this.toggle('trail');
          break;
        case 'm':
        case 'M':
          this.armMeteor(!this.meteorArmed);
          break;
        case 's':
        case 'S':
          this.client.scatter(SCATTER_SEEDS);
          break;
        case '0':
          this.renderer.camera.reset();
          this.follow = false;
          break;
        case '?':
          this.toggleHelp();
          break;
        case 'Escape':
          if (this.meteorArmed) this.armMeteor(false);
          else if (this.selectedId >= 0) this.client.selectId(-1);
          break;
        default:
          return;
      }
    });
  }
}

async function copy(text: string): Promise<void> {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  throw new Error('clipboard unavailable');
}

function download(name: string, blob: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
