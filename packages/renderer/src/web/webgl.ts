// WebGL2 backend: a CRT, modelled physically. The surface goes up as an
// 8-bit texture of palette indices and the palette as a 256×1 texture.
// All light is linear and per channel; nothing is weighted by hand, so what
// glows is simply what's bright. Each frame:
//
//   1. wear      the phosphor under what was on screen since the last frame
//                wears, in proportion to how hard the beam drove it and for
//                how long (burn-in). It never recovers.
//   2. phosphor  each pixel's light: its colour, less what wear has taken,
//                or what's left of the last frame's as it fades, whichever
//                is brighter (phosphors light at once and fade slowly).
//   3. halation  the glass scatters some of that light around it: a blur
//                down a chain of half-size targets and back up, each level
//                reaching twice as far, summed into a long-tailed spread.
//   4. present   at device resolution: each row of pixels is a beam with a
//                Gaussian profile that widens with brightness (thin dark
//                gaps between dim rows, bright rows fat enough to close
//                them), through the phosphor mask, plus the scattered
//                light, falling off towards the corners, plus the room
//                light the faceplate reflects, which worn phosphor, browned,
//                reflects less of.
//
// The output can be any size. Across a row, pixels are sampled "sharp
// bilinear": each is a hard-edged block and only the device pixel that
// straddles an edge blends, so non-integer scales stay crisp. Down the
// screen, the beam profile does the same job.
//
// With effects off, both directions are sharp bilinear and nothing else runs.

import type { Palette } from '@synth-ui/core';
import type { Surface } from '../raster/surface.js';
import type { PixelBackend, PostFx } from './backend.js';

const MAX_LEVELS = 6;
const MASKS = { aperture: 1, slot: 2, shadow: 3 } as const;

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const COMMON = `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`;

/** Linear colour of virtual pixel `t` (top-down, clamped to the surface). */
const LOOKUP = `
uniform sampler2D uIndex;
uniform sampler2D uPalette;
uniform vec2 uSize;
vec3 colorAt(ivec2 t) {
  t = clamp(t, ivec2(0), ivec2(uSize) - 1);
  int i = int(texelFetch(uIndex, t, 0).r * 255.0 + 0.5);
  return toLinear(texelFetch(uPalette, ivec2(i, 0), 0).rgb);
}
`;

// Wear builds up like a charging capacitor: the more worn, the less more
// wear does, so it creeps towards dead rather than overshooting.
const WEAR = `${COMMON}${LOOKUP}
uniform sampler2D uWear;
uniform float uRate;
void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  vec3 w = texelFetch(uWear, t, 0).rgb;
  o = vec4(1.0 - (1.0 - w) * exp(-uRate * colorAt(t)), 1.0);
}`;

const PHOSPHOR = `${COMMON}${LOOKUP}
uniform sampler2D uWear;
uniform sampler2D uPrev;
uniform vec3 uDecay;
void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  vec3 lit = colorAt(t) * (1.0 - texelFetch(uWear, t, 0).rgb);
  o = vec4(max(lit, texelFetch(uPrev, t, 0).rgb * uDecay), 1.0);
}`;

const DOWN = `${COMMON}
uniform sampler2D uSrc;
uniform vec2 uDst;
uniform vec2 uTexel;
void main() {
  vec2 uv = gl_FragCoord.xy / uDst;
  vec3 s = texture(uSrc, uv).rgb * 4.0;
  s += texture(uSrc, uv - uTexel).rgb;
  s += texture(uSrc, uv + uTexel).rgb;
  s += texture(uSrc, uv + vec2(uTexel.x, -uTexel.y)).rgb;
  s += texture(uSrc, uv - vec2(uTexel.x, -uTexel.y)).rgb;
  o = vec4(s / 8.0, 1.0);
}`;

const UP = `${COMMON}
uniform sampler2D uSrc;
uniform vec2 uDst;
uniform vec2 uTexel;
void main() {
  vec2 uv = gl_FragCoord.xy / uDst;
  vec2 h = uTexel;
  vec3 s = texture(uSrc, uv + vec2(-2.0 * h.x, 0.0)).rgb;
  s += texture(uSrc, uv + vec2(-h.x, h.y)).rgb * 2.0;
  s += texture(uSrc, uv + vec2(0.0, 2.0 * h.y)).rgb;
  s += texture(uSrc, uv + vec2(h.x, h.y)).rgb * 2.0;
  s += texture(uSrc, uv + vec2(2.0 * h.x, 0.0)).rgb;
  s += texture(uSrc, uv + vec2(h.x, -h.y)).rgb * 2.0;
  s += texture(uSrc, uv + vec2(0.0, -2.0 * h.y)).rgb;
  s += texture(uSrc, uv + vec2(-h.x, -h.y)).rgb * 2.0;
  o = vec4(s / 12.0, 1.0);
}`;

const PLAIN = `${COMMON}${LOOKUP}
uniform vec2 uOut;
void main() {
  vec2 scale = uOut / uSize;
  vec2 u = vec2(gl_FragCoord.x, uOut.y - gl_FragCoord.y) / scale - 0.5;
  vec2 i = floor(u);
  vec2 t = clamp((fract(u) - 0.5) * scale + 0.5, 0.0, 1.0);
  ivec2 k = ivec2(i);
  vec3 c = mix(mix(colorAt(k), colorAt(k + ivec2(1, 0)), t.x), mix(colorAt(k + ivec2(0, 1)), colorAt(k + ivec2(1, 1)), t.x), t.y);
  o = vec4(toSrgb(c), 1.0);
}`;

const PRESENT = `${COMMON}
uniform sampler2D uLight;
uniform sampler2D uWear;
uniform sampler2D uHalo;
uniform vec2 uSize;
uniform vec2 uOut;
uniform vec2 uHaloTexel;
uniform float uSigmaDim;
uniform float uSigmaBright;
uniform int uMask;
uniform float uMaskLow;
uniform float uMaskGain;
uniform float uHalation;
uniform float uHaloScale;
uniform float uAmbient;
uniform float uVignette;

// A row's light at column position x, blended sharp-bilinear across the pixel edge. Nothing beyond the top and bottom.
vec3 rowLight(float ix, float tx, float row) {
  if (row < 0.0 || row >= uSize.y) return vec3(0.0);
  int y = int(row);
  int x0 = int(clamp(ix, 0.0, uSize.x - 1.0));
  int x1 = int(clamp(ix + 1.0, 0.0, uSize.x - 1.0));
  return mix(texelFetch(uLight, ivec2(x0, y), 0).rgb, texelFetch(uLight, ivec2(x1, y), 0).rgb, tx);
}

// The halo target is coarser than the grid; a 3×3 tent keeps it smooth however far it's magnified.
vec3 halo(vec2 uv) {
  vec2 d = uHaloTexel;
  vec3 s = texture(uHalo, uv).rgb * 4.0;
  s += (texture(uHalo, uv + vec2(d.x, 0)).rgb + texture(uHalo, uv - vec2(d.x, 0)).rgb +
        texture(uHalo, uv + vec2(0, d.y)).rgb + texture(uHalo, uv - vec2(0, d.y)).rgb) * 2.0;
  s += texture(uHalo, uv + d).rgb + texture(uHalo, uv - d).rgb +
       texture(uHalo, uv + vec2(d.x, -d.y)).rgb + texture(uHalo, uv - vec2(d.x, -d.y)).rgb;
  return s / 16.0;
}

// Which phosphor this device pixel is: the lit channel full, the others at uMaskLow.
vec3 mask(ivec2 p) {
  if (uMask == 0) return vec3(1.0);
  int ch = p.x % 3;
  // Shadow mask: dots, each row of triads a dot along from the one above.
  if (uMask == 3) ch = (p.x + (p.y % 2)) % 3;
  vec3 m = vec3(uMaskLow);
  // Slot mask: the stripes broken every 4 rows, staggered between neighbouring triads.
  if (uMask == 2 && (p.y + ((p.x / 3) % 2) * 2) % 4 == 0) return m;
  m[ch] = 1.0;
  return m;
}

void main() {
  vec2 scale = uOut / uSize;
  vec2 v = vec2(gl_FragCoord.x, uOut.y - gl_FragCoord.y) / scale; // virtual position, top-down

  float u = v.x - 0.5;
  float ix = floor(u);
  float tx = clamp((fract(u) - 0.5) * scale.x + 0.5, 0.0, 1.0);

  // Rows too few device pixels tall can't show a gap cleanly: the beam
  // thickens towards flat there. And each beam is widened by the height of a
  // device pixel, so thin ones are sampled smoothly rather than aliasing.
  float thin = smoothstep(1.5, 2.5, scale.y);
  float dim = mix(0.6, uSigmaDim, thin);
  float bright = mix(0.6, uSigmaBright, thin);
  float aa = 1.0 / (12.0 * scale.y * scale.y);
  float row = floor(v.y);
  vec3 c = vec3(0.0);
  for (int k = -2; k <= 2; k++) {
    float r = row + float(k);
    vec3 I = rowLight(ix, tx, r);
    vec3 s = mix(vec3(dim), vec3(bright), sqrt(clamp(I, 0.0, 1.0)));
    s = sqrt(s * s + aa);
    float d = v.y - (r + 0.5);
    // Normalised: however wide, a beam carries its row's light, no more.
    c += I * exp(-0.5 * d * d / (s * s)) / (s * 2.5066283);
  }
  c *= mask(ivec2(gl_FragCoord.xy)) * uMaskGain;

  // The scattered light carries none of the mask or the rows: it left them behind in the glass.
  vec2 uv = v / uSize;
  c = mix(c, halo(uv) * uHaloScale, uHalation);

  vec2 q = uv * 2.0 - 1.0;
  c *= max(0.0, 1.0 - uVignette * 0.5 * dot(q, q));

  // Browned phosphor absorbs more blue than red.
  vec3 w = texture(uWear, uv).rgb;
  float worn = (w.r + w.g + w.b) / 3.0;
  c += uAmbient * (1.0 - worn * vec3(0.35, 0.5, 0.7));
  o = vec4(toSrgb(c), 1.0);
}`;

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

type Program = { prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
type Programs = Record<'wear' | 'phosphor' | 'down' | 'up' | 'plain' | 'present', Program>;

export class WebGLBackend implements PixelBackend {
  readonly effects = true;
  private indexTex!: WebGLTexture;
  private paletteTex!: WebGLTexture;
  private programs!: Programs;
  /** Ping-ponged at the surface's size: the phosphors' light (`current` is this frame's), and their wear (the first is current). */
  private light: Target[] = [];
  private wear: Target[] = [];
  private current = 0;
  private levels: Target[] = [];
  /** How many levels the halo was summed from. */
  private haloLevels = 1;
  private floatTargets = false;
  private uploaded: { palette: Palette | null; w: number; h: number } = { palette: null, w: 0, h: 0 };
  /** When the last frame was presented; null after a suspend or with effects off. */
  private last: number | null = null;
  private lost = false;

  static create(canvas: HTMLCanvasElement): WebGLBackend | null {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    });
    return gl ? new WebGLBackend(canvas, gl) : null;
  }

  private constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
  ) {
    this.init();
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.levels = [];
      this.light = [];
      this.wear = [];
      this.last = null;
      this.uploaded = { palette: null, w: 0, h: 0 };
      this.init();
      this.lost = false;
    });
  }

  private init() {
    const { gl } = this;
    this.floatTargets = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');

    // One triangle that covers the viewport.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const lookup = ['uIndex', 'uPalette', 'uSize'];
    this.programs = {
      wear: this.program(WEAR, [...lookup, 'uWear', 'uRate']),
      phosphor: this.program(PHOSPHOR, [...lookup, 'uWear', 'uPrev', 'uDecay']),
      down: this.program(DOWN, ['uSrc', 'uDst', 'uTexel']),
      up: this.program(UP, ['uSrc', 'uDst', 'uTexel']),
      plain: this.program(PLAIN, [...lookup, 'uOut']),
      present: this.program(PRESENT, [
        'uLight', 'uWear', 'uHalo', 'uSize', 'uOut', 'uHaloTexel', 'uSigmaDim', 'uSigmaBright',
        'uMask', 'uMaskLow', 'uMaskGain', 'uHalation', 'uHaloScale', 'uAmbient', 'uVignette',
      ]),
    };

    this.indexTex = this.texture(gl.NEAREST);
    this.paletteTex = this.texture(gl.NEAREST);
  }

  afterglow(fx: PostFx): number {
    // Seven time constants: faded below a thousandth.
    return fx.enabled ? 7 * Math.max(0, ...fx.persistence) : 0;
  }

  clearBurnIn(): void {
    const { gl } = this;
    for (const t of this.wear) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  suspend(): void {
    this.last = null;
  }

  present(surface: Surface, palette: Palette, out: { w: number; h: number }, fx: PostFx, time: number): void {
    const { gl } = this;
    const { width: w, height: h } = surface;
    if (this.lost || !w || !h || gl.isContextLost()) return;
    const { w: dw, h: dh } = out;
    if (this.canvas.width !== dw || this.canvas.height !== dh) {
      this.canvas.width = dw;
      this.canvas.height = dh;
    }
    const resized = this.uploaded.w !== w || this.uploaded.h !== h;
    if (resized) this.ensureTargets(w, h);
    const dt = this.last === null || resized ? 0 : Math.max(0, time - this.last);
    this.last = fx.enabled ? time : null;

    // Wear from what's been on screen since the last frame, before it's replaced.
    const burn = fx.enabled && fx.burnIn > 0 && this.floatTargets && dt > 0;
    if (burn) this.wearPass(w, h, (fx.burnIn * dt) / 3_600_000);

    this.upload(surface, palette);

    if (!fx.enabled) {
      const p = this.programs.plain;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, dw, dh);
      gl.useProgram(p.prog);
      gl.uniform1i(p.u.uIndex, 0);
      gl.uniform1i(p.u.uPalette, 1);
      gl.uniform2f(p.u.uSize, w, h);
      gl.uniform2f(p.u.uOut, dw, dh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return;
    }

    // The phosphors' light this frame, into the other half of the pair.
    const prev = this.light[this.current];
    this.current ^= 1;
    const light = this.light[this.current];
    const wear = this.wear[0];
    const p = this.programs.phosphor;
    this.bindTarget(light);
    gl.useProgram(p.prog);
    this.bindTex(2, wear.tex);
    this.bindTex(3, prev.tex);
    gl.uniform1i(p.u.uIndex, 0);
    gl.uniform1i(p.u.uPalette, 1);
    gl.uniform1i(p.u.uWear, 2);
    gl.uniform1i(p.u.uPrev, 3);
    gl.uniform2f(p.u.uSize, w, h);
    const decay = fx.persistence.map((tau) => (tau > 0 && dt > 0 ? Math.exp(-dt / tau) : 0));
    gl.uniform3f(p.u.uDecay, decay[0], decay[1], decay[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const halation = fx.halation.amount > 0;
    if (halation) this.halation(light, Math.max(1, Math.min(MAX_LEVELS, Math.round(fx.halation.spread))));

    // Present at device resolution.
    const q = this.programs.present;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, dw, dh);
    gl.useProgram(q.prog);
    this.bindTex(2, light.tex);
    this.bindTex(3, wear.tex);
    this.bindTex(4, halation ? this.levels[0].tex : light.tex);
    gl.uniform1i(q.u.uLight, 2);
    gl.uniform1i(q.u.uWear, 3);
    gl.uniform1i(q.u.uHalo, 4);
    gl.uniform2f(q.u.uSize, w, h);
    gl.uniform2f(q.u.uOut, dw, dh);
    const first = this.levels[0];
    gl.uniform2f(q.u.uHaloTexel, first ? 1 / first.w : 0, first ? 1 / first.h : 0);

    // Beam widths, as a standard deviation in rows: 0.6 is flat.
    const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
    const dim = 0.6 - 0.48 * clamp01(fx.beam.scanlines);
    gl.uniform1f(q.u.uSigmaDim, dim);
    gl.uniform1f(q.u.uSigmaBright, dim + (0.6 - dim) * clamp01(fx.beam.bloom));

    // The mask takes light away between its phosphors; the tube is driven harder to make up for it.
    const strength = clamp01(fx.mask.strength);
    const low = 1 - strength;
    const type = strength > 0 ? MASKS[fx.mask.type] : 0;
    const stripe = (1 + 2 * low) / 3;
    const mean = type === 2 ? stripe * 0.75 + low * 0.25 : stripe;
    gl.uniform1i(q.u.uMask, type);
    gl.uniform1f(q.u.uMaskLow, low);
    gl.uniform1f(q.u.uMaskGain, type ? 1 / mean : 1);

    // The halo is the sum of every level, each carrying the whole light: average them.
    gl.uniform1f(q.u.uHalation, halation ? clamp01(fx.halation.amount) : 0);
    gl.uniform1f(q.u.uHaloScale, halation ? 1 / this.haloLevels : 1);
    gl.uniform1f(q.u.uAmbient, Math.max(0, fx.ambient));
    gl.uniform1f(q.u.uVignette, clamp01(fx.vignette));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private upload(surface: Surface, palette: Palette) {
    const { gl } = this;
    const { width: w, height: h } = surface;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.indexTex);
    if (this.uploaded.w !== w || this.uploaded.h !== h) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, surface.data);
      this.uploaded.w = w;
      this.uploaded.h = h;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.UNSIGNED_BYTE, surface.data);
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    if (this.uploaded.palette !== palette) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, palette.rgba());
      this.uploaded.palette = palette;
    }
  }

  /** Wear under the surface still on the GPU (the last frame's), `rate` × its light. */
  private wearPass(w: number, h: number, rate: number) {
    const { gl } = this;
    const p = this.programs.wear;
    const [from, to] = this.wear;
    this.bindTarget(to);
    gl.useProgram(p.prog);
    this.bindTex(2, from.tex);
    gl.uniform1i(p.u.uIndex, 0);
    gl.uniform1i(p.u.uPalette, 1);
    gl.uniform1i(p.u.uWear, 2);
    gl.uniform2f(p.u.uSize, w, h);
    gl.uniform1f(p.u.uRate, rate);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.wear.reverse();
  }

  private halation(src: Target, count: number) {
    const { gl } = this;
    const levels = this.levels.slice(0, Math.min(count, this.levels.length));
    this.haloLevels = levels.length;

    // Down the chain, from the full-size light...
    const d = this.programs.down;
    gl.useProgram(d.prog);
    gl.uniform1i(d.u.uSrc, 2);
    for (let i = 0; i < levels.length; i++) {
      const from = i === 0 ? src : levels[i - 1];
      this.bindTarget(levels[i]);
      this.bindTex(2, from.tex);
      gl.uniform2f(d.u.uDst, levels[i].w, levels[i].h);
      gl.uniform2f(d.u.uTexel, 1 / from.w, 1 / from.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ...and back up, adding each blurrier level onto the sharper one.
    const u = this.programs.up;
    gl.useProgram(u.prog);
    gl.uniform1i(u.u.uSrc, 2);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = levels.length - 1; i > 0; i--) {
      const from = levels[i];
      this.bindTarget(levels[i - 1]);
      this.bindTex(2, from.tex);
      gl.uniform2f(u.u.uDst, levels[i - 1].w, levels[i - 1].h);
      gl.uniform2f(u.u.uTexel, 0.5 / from.w, 0.5 / from.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
  }

  /** The light and wear pairs at the surface's size, and half-size halation targets down to a few pixels. Wear starts fresh. */
  private ensureTargets(w: number, h: number) {
    const { gl } = this;
    for (const t of [...this.light, ...this.wear, ...this.levels]) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    this.light = [this.target(w, h), this.target(w, h)];
    this.wear = [this.target(w, h), this.target(w, h)];
    this.levels = [];
    let lw = Math.ceil(w / 2);
    let lh = Math.ceil(h / 2);
    for (let i = 0; i < MAX_LEVELS && lw >= 2 && lh >= 2; i++) {
      this.levels.push(this.target(lw, lh));
      lw = Math.ceil(lw / 2);
      lh = Math.ceil(lh / 2);
    }
    this.current = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** A render target, cleared to black: half-float where the GPU can render to it. */
  private target(w: number, h: number): Target {
    const { gl } = this;
    const tex = this.texture(gl.LINEAR);
    if (this.floatTargets) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fbo, w, h };
  }

  private bindTarget(t: Target) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
  }

  private bindTex(unit: number, tex: WebGLTexture) {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  private texture(filter: number): WebGLTexture {
    const { gl } = this;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private program(frag: string, uniforms: string[]): Program {
    const { gl } = this;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(prog, 0, 'p');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
    return { prog, u: Object.fromEntries(uniforms.map((n) => [n, gl.getUniformLocation(prog, n)])) };
  }
}
