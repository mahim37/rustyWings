/**
 * WebGL2 renderer. One instanced draw call each for seed patches, seeds,
 * vision wedges, relatives' halos, the selected bird's trail, birds and the
 * selection ring, all reading from the packed frame buffer the worker sent.
 */

import { AGENT_STRIDE, FRAME_HEADER, POINT_STRIDE } from '../sim/protocol';
import { Camera } from './camera';
import { buildAtlas, PALETTE } from './sprites';

const VERT_COMMON = `#version 300 es
precision highp float;
uniform vec2 u_center;
uniform float u_zoom;
uniform vec2 u_res;      // canvas size in device pixels
// World position → clip space, wrapped so the torus edge is seamless.
vec2 toClip(vec2 world) {
  vec2 d = world - u_center;
  d -= floor(d + 0.5);
  return d * 2.0 * u_zoom;
}
// A pixel offset (device px) in clip space.
vec2 pxToClip(vec2 px) { return px * 2.0 / u_res; }
`;

const SPRITE_VS =
  VERT_COMMON +
  `
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_inst0;   // x, y, heading, size
layout(location = 2) in vec4 a_inst1;   // energy, species, fov, range
layout(location = 3) in vec2 a_inst2;   // speed (fraction of top speed), kin
uniform float u_time;
uniform float u_dpr;
uniform float u_spritePx;
out vec2 v_uv;
out float v_alpha;
void main() {
  float hawk = step(0.5, a_inst1.y);
  float px = u_spritePx * mix(1.0, 1.55, hawk) * a_inst0.w * u_dpr * pow(u_zoom, 0.55);
  float h = a_inst0.z;
  mat2 rot = mat2(cos(h), sin(h), -sin(h), cos(h));
  vec2 offset = rot * (a_corner * px);
  gl_Position = vec4(toClip(a_inst0.xy) + pxToClip(offset), 0.0, 1.0);
  // Wing beat: faster for sparrows, phase from the instance id. A bird that
  // is not moving holds its wings level instead of flapping on the spot.
  float rate = mix(7.0, 4.5, hawk);
  float phase = float(gl_InstanceID) * 0.618;
  float frame = a_inst2.x < 0.05 ? 0.0 : floor(mod(u_time * rate + phase, 4.0));
  v_uv = (a_corner + 0.5) * vec2(1.0 / 4.0, 0.5) + vec2(frame / 4.0, hawk * 0.5);
  v_alpha = 0.5 + 0.5 * clamp(a_inst1.x, 0.0, 1.0);
}`;

const SPRITE_FS = `#version 300 es
precision mediump float;
uniform sampler2D u_atlas;
in vec2 v_uv;
in float v_alpha;
out vec4 o;
void main() { o = texture(u_atlas, v_uv) * v_alpha; }`;

const DOT_VS =
  VERT_COMMON +
  `
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_pos;
uniform float u_px;      // diameter in device px
out vec2 v_c;
void main() {
  v_c = a_corner * 2.0;
  gl_Position = vec4(toClip(a_pos) + pxToClip(a_corner * u_px), 0.0, 1.0);
}`;

const DOT_FS = `#version 300 es
precision mediump float;
uniform vec4 u_color;    // premultiplied
in vec2 v_c;
out vec4 o;
void main() {
  float d = length(v_c);
  float a = 1.0 - smoothstep(0.75, 1.0, d);
  o = u_color * a;
}`;

// The trail: one dot per recorded tick, fading toward the oldest.
const TRAIL_VS =
  VERT_COMMON +
  `
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_pos;
uniform float u_px;
uniform float u_count;
out vec2 v_c;
out float v_fade;
void main() {
  v_c = a_corner * 2.0;
  v_fade = (float(gl_InstanceID) + 1.0) / u_count;
  gl_Position = vec4(toClip(a_pos) + pxToClip(a_corner * u_px), 0.0, 1.0);
}`;

const TRAIL_FS = `#version 300 es
precision mediump float;
uniform vec4 u_color;
in vec2 v_c;
in float v_fade;
out vec4 o;
void main() {
  float d = length(v_c);
  float a = (1.0 - smoothstep(0.6, 1.0, d)) * v_fade * v_fade;
  o = u_color * a;
}`;

// A soft disc behind every relative of the selected bird.
const HALO_VS =
  VERT_COMMON +
  `
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_inst0;
layout(location = 2) in vec4 a_inst1;
layout(location = 3) in vec2 a_inst2;
uniform float u_px;
uniform float u_dpr;
out vec2 v_c;
out float v_species;
void main() {
  v_c = a_corner * 2.0;
  v_species = a_inst1.y;
  if (a_inst2.y < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float hawk = step(0.5, a_inst1.y);
  float px = u_px * mix(1.0, 1.4, hawk) * a_inst0.w * u_dpr * pow(u_zoom, 0.55);
  gl_Position = vec4(toClip(a_inst0.xy) + pxToClip(a_corner * px), 0.0, 1.0);
}`;

const HALO_FS = `#version 300 es
precision mediump float;
uniform vec4 u_colorHerb;
uniform vec4 u_colorPred;
in vec2 v_c;
in float v_species;
out vec4 o;
void main() {
  float d = length(v_c);
  float a = 1.0 - smoothstep(0.55, 1.0, d);
  o = mix(u_colorHerb, u_colorPred, step(0.5, v_species)) * a;
}`;

const PATCH_VS =
  VERT_COMMON +
  `
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_pos;
uniform float u_radius;  // world units
out vec2 v_c;
void main() {
  v_c = a_corner * 2.0;
  gl_Position = vec4(toClip(a_pos) + a_corner * 2.0 * u_radius * 2.0 * u_zoom, 0.0, 1.0);
}`;

const PATCH_FS = `#version 300 es
precision mediump float;
uniform vec4 u_color;
in vec2 v_c;
out vec4 o;
void main() {
  float d = length(v_c);
  float a = smoothstep(1.0, 0.0, d);
  o = u_color * a * a;
}`;

const WEDGE_VS =
  VERT_COMMON +
  `
layout(location = 0) in vec2 a_wedge;   // t along the arc, 1 = centre vertex
layout(location = 1) in vec4 a_inst0;
layout(location = 2) in vec4 a_inst1;
out float v_species;
void main() {
  float ang = a_inst0.z - a_inst1.z * 0.5 + a_wedge.x * a_inst1.z;
  vec2 p = a_inst0.xy + (1.0 - a_wedge.y) * a_inst1.w * vec2(cos(ang), sin(ang));
  vec2 d = p - u_center;
  // Wrap the centre, then offset consistently so the wedge never tears.
  vec2 c = a_inst0.xy - u_center;
  c -= floor(c + 0.5);
  d = c + (p - a_inst0.xy);
  gl_Position = vec4(d * 2.0 * u_zoom, 0.0, 1.0);
  v_species = a_inst1.y;
}`;

const WEDGE_FS = `#version 300 es
precision mediump float;
uniform vec4 u_colorHerb;
uniform vec4 u_colorPred;
in float v_species;
out vec4 o;
void main() { o = mix(u_colorHerb, u_colorPred, step(0.5, v_species)); }`;

const RING_VS =
  VERT_COMMON +
  `
layout(location = 0) in vec2 a_corner;
uniform vec2 u_pos;
uniform float u_px;
out vec2 v_c;
void main() {
  v_c = a_corner * 2.0;
  gl_Position = vec4(toClip(u_pos) + pxToClip(a_corner * u_px), 0.0, 1.0);
}`;

const RING_FS = `#version 300 es
precision mediump float;
uniform vec4 u_color;
uniform float u_width;   // ring width as a fraction of radius
in vec2 v_c;
out vec4 o;
void main() {
  float d = length(v_c);
  float a = smoothstep(1.0 - u_width - 0.08, 1.0 - u_width, d) * (1.0 - smoothstep(0.92, 1.0, d));
  o = u_color * a;
}`;

// Outline vertices are wrapped as offsets from an anchor (the bird), like
// the wedge, so an outline that crosses the torus edge never spans the screen.
const LINE_VS =
  VERT_COMMON +
  `
layout(location = 0) in vec2 a_pos;
uniform vec2 u_anchor;
void main() {
  vec2 c = u_anchor - u_center;
  c -= floor(c + 0.5);
  gl_Position = vec4((c + (a_pos - u_anchor)) * 2.0 * u_zoom, 0.0, 1.0);
}`;

const LINE_FS = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 o;
void main() { o = u_color; }`;

const WEDGE_SEGMENTS = 28;
/** The ground. */
const FIELD = '#f7f8f1';
/** Selection ring, trail and outlines. */
const INK = '#0b0b0b';

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error('createShader failed');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error('shader: ' + log);
  }
  return s;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error('createProgram failed');
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  return p;
}

type Rgba = [number, number, number, number];

/** `#rrggbb` to premultiplied RGBA. */
function rgba(hex: string, alpha: number): Rgba {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return [r * alpha, g * alpha, b * alpha, alpha];
}

interface Pass {
  prog: WebGLProgram;
  vao: WebGLVertexArrayObject;
  u: Record<string, WebGLUniformLocation | null>;
}

export interface RenderOptions {
  showVision: boolean;
  showPatches: boolean;
  showTrail: boolean;
  patchRadius: number;
}

/** Selected bird's row, copied out of the frame so it survives recycling. */
export interface SelectedRow {
  x: number;
  y: number;
  heading: number;
  size: number;
  energy: number;
  species: number;
  fov: number;
  range: number;
}

export class Renderer {
  readonly camera = new Camera();
  readonly gl: WebGL2RenderingContext;
  private dpr = 1;
  private readonly quad: WebGLBuffer;
  private readonly agents: WebGLBuffer;
  private readonly plants: WebGLBuffer;
  private readonly patches: WebGLBuffer;
  private readonly trailBuf: WebGLBuffer;
  private readonly wedgeGeom: WebGLBuffer;
  private readonly line: WebGLBuffer;
  private readonly sprite: Pass;
  private readonly dot: Pass;
  private readonly trail: Pass;
  private readonly halo: Pass;
  private readonly patch: Pass;
  private readonly wedge: Pass;
  private readonly wedgeOne: Pass;
  private readonly ring: Pass;
  private readonly outline: Pass;
  private agentCount = 0;
  private herbCount = 0;
  private plantCount = 0;
  private patchCount = 0;
  private trailCount = 0;
  private selectedIndex = -1;
  selected: SelectedRow | null = null;
  private readonly lineScratch = new Float32Array((WEDGE_SEGMENTS + 2) * 2);
  private readonly start = performance.now();

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.quad = this.buffer(new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]));
    this.agents = gl.createBuffer();
    this.plants = gl.createBuffer();
    this.patches = gl.createBuffer();
    this.trailBuf = gl.createBuffer();
    this.line = gl.createBuffer();
    // Wedge fan as a triangle list: (centre, t_i, t_{i+1}).
    const wedge = new Float32Array(WEDGE_SEGMENTS * 6);
    for (let i = 0; i < WEDGE_SEGMENTS; i++) {
      wedge.set([0, 1, i / WEDGE_SEGMENTS, 0, (i + 1) / WEDGE_SEGMENTS, 0], i * 6);
    }
    this.wedgeGeom = this.buffer(wedge);

    const view = ['u_center', 'u_zoom', 'u_res'];
    this.sprite = this.pass(SPRITE_VS, SPRITE_FS, [...view, 'u_time', 'u_dpr', 'u_spritePx', 'u_atlas'], () => {
      this.cornerAttrib(0);
      this.agentAttribs();
    });
    this.dot = this.pass(DOT_VS, DOT_FS, [...view, 'u_px', 'u_color'], () => {
      this.cornerAttrib(0);
      this.pointAttrib(1, this.plants);
    });
    this.trail = this.pass(TRAIL_VS, TRAIL_FS, [...view, 'u_px', 'u_count', 'u_color'], () => {
      this.cornerAttrib(0);
      this.pointAttrib(1, this.trailBuf);
    });
    this.halo = this.pass(HALO_VS, HALO_FS, [...view, 'u_px', 'u_dpr', 'u_colorHerb', 'u_colorPred'], () => {
      this.cornerAttrib(0);
      this.agentAttribs();
    });
    this.patch = this.pass(PATCH_VS, PATCH_FS, [...view, 'u_radius', 'u_color'], () => {
      this.cornerAttrib(0);
      this.pointAttrib(1, this.patches);
    });
    this.wedge = this.pass(WEDGE_VS, WEDGE_FS, [...view, 'u_colorHerb', 'u_colorPred'], () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.wedgeGeom);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.agentAttribs();
    });
    // Same shaders, own VAO: its attribute pointers are re-based to the
    // selected row each frame (WebGL2 has no base-instance draw).
    this.wedgeOne = this.pass(WEDGE_VS, WEDGE_FS, [...view, 'u_colorHerb', 'u_colorPred'], () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.wedgeGeom);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.agentAttribs();
    });
    this.ring = this.pass(RING_VS, RING_FS, [...view, 'u_pos', 'u_px', 'u_color', 'u_width'], () => {
      this.cornerAttrib(0);
    });
    this.outline = this.pass(LINE_VS, LINE_FS, [...view, 'u_anchor', 'u_color'], () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.line);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    });

    // Atlas texture.
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, buildAtlas());
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private buffer(data: Float32Array): WebGLBuffer {
    const gl = this.gl;
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }

  private pass(vs: string, fs: string, uniforms: string[], setup: () => void): Pass {
    const gl = this.gl;
    const prog = program(gl, vs, fs);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    setup();
    gl.bindVertexArray(null);
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const name of uniforms) u[name] = gl.getUniformLocation(prog, name);
    return { prog, vao, u };
  }

  private cornerAttrib(loc: number): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  private pointAttrib(loc: number, buf: WebGLBuffer): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(loc, 1);
  }

  /** Per-bird attributes 1..3 over the agent buffer, starting at row `base`. */
  private agentAttribs(base = 0): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.agents);
    const stride = AGENT_STRIDE * 4;
    const off = base * stride;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, off);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, off + 16);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, off + 32);
    gl.vertexAttribDivisor(3, 1);
  }

  /** Match the canvas to `sizeCss` pixels square at the current DPR. */
  resize(sizeCss: number): void {
    this.dpr = window.devicePixelRatio || 1;
    const px = Math.max(1, Math.round(sizeCss * this.dpr));
    if (this.canvas.width !== px || this.canvas.height !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    this.canvas.style.width = sizeCss + 'px';
    this.canvas.style.height = sizeCss + 'px';
    this.camera.size = sizeCss;
    this.gl.viewport(0, 0, px, px);
  }

  /** Upload a packed frame. The buffer may be recycled as soon as this returns. */
  upload(frame: Float32Array): void {
    const gl = this.gl;
    const n = frame[0]! | 0;
    const m = frame[1]! | 0;
    const p = frame[2]! | 0;
    this.selectedIndex = frame[3]! | 0;
    const t = frame[4]! | 0;
    this.agentCount = n;
    this.plantCount = m;
    this.patchCount = p;
    this.trailCount = t;
    let off = FRAME_HEADER;
    const agents = frame.subarray(off, off + n * AGENT_STRIDE);
    off += n * AGENT_STRIDE;
    const plants = frame.subarray(off, off + m * POINT_STRIDE);
    off += m * POINT_STRIDE;
    const patches = frame.subarray(off, off + p * POINT_STRIDE);
    off += p * POINT_STRIDE;
    const trail = frame.subarray(off, off + t * POINT_STRIDE);
    let herb = 0;
    for (let i = 5; i < agents.length; i += AGENT_STRIDE) if (agents[i]! < 0.5) herb++;
    this.herbCount = herb;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.agents);
    gl.bufferData(gl.ARRAY_BUFFER, agents, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.plants);
    gl.bufferData(gl.ARRAY_BUFFER, plants, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.patches);
    gl.bufferData(gl.ARRAY_BUFFER, patches, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailBuf);
    gl.bufferData(gl.ARRAY_BUFFER, trail, gl.DYNAMIC_DRAW);
    if (this.selectedIndex >= 0 && this.selectedIndex < n) {
      const b = this.selectedIndex * AGENT_STRIDE;
      this.selected = {
        x: agents[b]!,
        y: agents[b + 1]!,
        heading: agents[b + 2]!,
        size: agents[b + 3]!,
        energy: agents[b + 4]!,
        species: agents[b + 5]!,
        fov: agents[b + 6]!,
        range: agents[b + 7]!,
      };
    } else {
      this.selected = null;
    }
  }

  private common(pass: Pass): void {
    const gl = this.gl;
    gl.useProgram(pass.prog);
    gl.bindVertexArray(pass.vao);
    gl.uniform2f(pass.u['u_center']!, this.camera.cx, this.camera.cy);
    gl.uniform1f(pass.u['u_zoom']!, this.camera.zoom);
    gl.uniform2f(pass.u['u_res']!, this.canvas.width, this.canvas.height);
  }

  draw(opts: RenderOptions): void {
    const gl = this.gl;
    const dpr = this.dpr;
    const zoomScale = Math.pow(this.camera.zoom, 0.55);
    const field = rgba(FIELD, 1);
    gl.clearColor(field[0], field[1], field[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (opts.showPatches && this.patchCount > 0) {
      this.common(this.patch);
      gl.uniform1f(this.patch.u['u_radius']!, opts.patchRadius * 2.4);
      gl.uniform4f(this.patch.u['u_color']!, ...rgba(PALETTE.plant, 0.13));
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.patchCount);
    }
    if (this.plantCount > 0) {
      this.common(this.dot);
      gl.uniform1f(this.dot.u['u_px']!, 3.4 * dpr * Math.pow(this.camera.zoom, 0.4));
      gl.uniform4f(this.dot.u['u_color']!, ...rgba(PALETTE.plant, 0.95));
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.plantCount);
    }
    if (opts.showVision && this.agentCount > 0) {
      this.common(this.wedge);
      gl.uniform4f(this.wedge.u['u_colorHerb']!, ...rgba(PALETTE.herb.body, 0.045));
      gl.uniform4f(this.wedge.u['u_colorPred']!, ...rgba(PALETTE.pred.body, 0.06));
      gl.drawArraysInstanced(gl.TRIANGLES, 0, WEDGE_SEGMENTS * 3, this.agentCount);
    }
    const sel = this.selected;
    if (sel) {
      // The selected bird's own wedge, darker, then its outline.
      this.common(this.wedgeOne);
      this.agentAttribs(this.selectedIndex);
      const ink = rgba(INK, 0.07);
      gl.uniform4f(this.wedgeOne.u['u_colorHerb']!, ...ink);
      gl.uniform4f(this.wedgeOne.u['u_colorPred']!, ...ink);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, WEDGE_SEGMENTS * 3, 1);
      this.drawWedgeOutline(sel);
    }
    if (this.agentCount > 0) {
      // Halos sit under every bird; the shader discards rows that are not kin.
      this.common(this.halo);
      gl.uniform1f(this.halo.u['u_px']!, 34);
      gl.uniform1f(this.halo.u['u_dpr']!, dpr);
      gl.uniform4f(this.halo.u['u_colorHerb']!, ...rgba(PALETTE.herb.body, 0.2));
      gl.uniform4f(this.halo.u['u_colorPred']!, ...rgba(PALETTE.pred.body, 0.22));
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.agentCount);
    }
    if (opts.showTrail && this.trailCount > 1) {
      this.common(this.trail);
      gl.uniform1f(this.trail.u['u_px']!, 3.2 * dpr * zoomScale);
      gl.uniform1f(this.trail.u['u_count']!, this.trailCount);
      gl.uniform4f(this.trail.u['u_color']!, ...rgba(INK, 0.55));
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.trailCount);
    }
    if (this.agentCount > 0) {
      this.common(this.sprite);
      gl.uniform1f(this.sprite.u['u_time']!, (performance.now() - this.start) / 1000);
      gl.uniform1f(this.sprite.u['u_dpr']!, dpr);
      gl.uniform1f(this.sprite.u['u_spritePx']!, 15);
      gl.uniform1i(this.sprite.u['u_atlas']!, 0);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.agentCount);
    }
    if (sel) {
      this.common(this.ring);
      gl.uniform2f(this.ring.u['u_pos']!, sel.x, sel.y);
      const radius = (sel.species > 0.5 ? 20 : 15) * sel.size * zoomScale + 8;
      gl.uniform1f(this.ring.u['u_px']!, radius * 2 * dpr);
      gl.uniform1f(this.ring.u['u_width']!, 1.6 / radius);
      gl.uniform4f(this.ring.u['u_color']!, ...rgba(INK, 1));
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
    }
  }

  private drawWedgeOutline(sel: SelectedRow): void {
    const gl = this.gl;
    const pts = this.lineScratch;
    // Centre, arc, back to centre. Offsets kept relative so the wrap is
    // consistent with the wedge shader.
    pts[0] = sel.x;
    pts[1] = sel.y;
    for (let i = 0; i <= WEDGE_SEGMENTS; i++) {
      const a = sel.heading - sel.fov / 2 + (i / WEDGE_SEGMENTS) * sel.fov;
      pts[2 + i * 2] = sel.x + Math.cos(a) * sel.range;
      pts[3 + i * 2] = sel.y + Math.sin(a) * sel.range;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.line);
    gl.bufferData(gl.ARRAY_BUFFER, pts, gl.DYNAMIC_DRAW);
    this.common(this.outline);
    gl.uniform2f(this.outline.u['u_anchor']!, sel.x, sel.y);
    gl.uniform4f(this.outline.u['u_color']!, ...rgba(INK, 0.3));
    gl.drawArrays(gl.LINE_LOOP, 0, WEDGE_SEGMENTS + 2);
  }

  /** Live counts from the last uploaded frame. */
  get counts(): { agents: number; herb: number; pred: number; plants: number } {
    return { agents: this.agentCount, herb: this.herbCount, pred: this.agentCount - this.herbCount, plants: this.plantCount };
  }
}
