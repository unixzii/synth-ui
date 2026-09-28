// Backends turn an indexed Surface into light on a canvas. The WebGL one
// resolves the palette on the GPU and simulates the CRT; the Canvas 2D one
// is the plain fallback for when WebGL2 isn't available.

import type { Palette } from '@synth-ui/core';
import type { Surface } from '../raster/surface.js';
import { WebGLBackend } from './webgl.js';

/** The phosphor pattern behind the glass. */
export type MaskType = 'aperture' | 'slot' | 'shadow';

/**
 * A CRT, modelled physically: every colour is light, per channel, in linear
 * units, and nothing is told how much to glow. What glows is what's bright,
 * the way the tube does it.
 */
export interface PostFx {
  /** Off: the pixels as they are. */
  enabled: boolean;
  beam: {
    /** How thin a dim beam is, leaving dark gaps between rows: 0 flat, 1 thin lines. */
    scanlines: number;
    /** How much a bright beam widens into those gaps: 0 not at all, 1 fully. */
    bloom: number;
  };
  /** The phosphor pattern, and how much light falls between its stripes or dots (0–1). */
  mask: { type: MaskType; strength: number };
  /** Light scattered in the glass around where it's emitted: the share of it, and how far it reaches (1–6, each doubling). */
  halation: { amount: number; spread: number };
  /** How long each phosphor (red, green, blue) takes to fade to a third, in ms. A colour TV's P22 is around 1, 0.1 and 0.05: no trail at 60 Hz. */
  persistence: [number, number, number];
  /**
   * How fast the phosphor wears where it's lit, dimming there for good: the
   * share of its light lost per hour at full drive. A real tube takes years;
   * this is sped up. 0 turns it off.
   */
  burnIn: number;
  /** Room light the faceplate reflects, in linear units; worn phosphor, browned, reflects less. */
  ambient: number;
  /** Light falling off towards the corners: 0 none, 1 half gone there. */
  vignette: number;
}

export const DEFAULT_FX: PostFx = {
  enabled: true,
  beam: { scanlines: 0.94, bloom: 0.4 },
  mask: { type: 'aperture', strength: 0.45 },
  halation: { amount: 0.16, spread: 3 },
  persistence: [3, 0.3, 0.15],
  burnIn: 0,
  ambient: 0,
  vignette: 0.32,
};

export interface PixelBackend {
  readonly canvas: HTMLCanvasElement;
  /** Whether this backend can run post-processing at all. */
  readonly effects: boolean;
  /**
   * Draw the surface scaled to `out` device pixels (any size; the aspect
   * ratio is the caller's business). `time` in ms drives what changes with
   * time, like phosphors fading and wearing.
   */
  present(surface: Surface, palette: Palette, out: { w: number; h: number }, fx: PostFx, time: number): void;
  /** How long, in ms, the screen keeps changing after a frame with nothing new: the phosphors fading. */
  afterglow(fx: PostFx): number;
  /** A fresh tube: forget the wear. */
  clearBurnIn(): void;
  /** The screen is off (say, the page is hidden) until the next frame: nothing wears or fades meanwhile. */
  suspend(): void;
}

export function createBackend(canvas: HTMLCanvasElement): PixelBackend {
  try {
    const gl = WebGLBackend.create(canvas);
    if (gl) return gl;
  } catch (err) {
    console.warn('WebGL backend unavailable, falling back to Canvas 2D', err);
  }
  return new Canvas2DBackend(canvas);
}

/**
 * Palette lookup on the CPU, no effects. The grid is blown up to the next
 * whole-number scale with hard edges, then smoothly down to the output, so
 * pixels stay even and sharp at any size (sharp bilinear, the cheap way).
 */
export class Canvas2DBackend implements PixelBackend {
  readonly effects = false;
  private readonly g: CanvasRenderingContext2D;
  private readonly grid = document.createElement('canvas');
  private readonly big = document.createElement('canvas');
  private image: ImageData | null = null;
  private lut = new Uint32Array(256);
  private lutFor: Palette | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d', { alpha: false })!;
  }

  afterglow(): number {
    return 0;
  }

  clearBurnIn(): void {}

  suspend(): void {}

  present(surface: Surface, palette: Palette, out: { w: number; h: number }): void {
    const { width: w, height: h } = surface;
    if (!w || !h) return;
    if (this.canvas.width !== out.w || this.canvas.height !== out.h) {
      this.canvas.width = out.w;
      this.canvas.height = out.h;
    }
    const k = Math.max(1, Math.ceil(Math.min(out.w / w, out.h / h)));
    if (this.grid.width !== w || this.grid.height !== h) {
      this.grid.width = w;
      this.grid.height = h;
    }
    if (this.big.width !== w * k || this.big.height !== h * k) {
      this.big.width = w * k;
      this.big.height = h * k;
    }
    const gg = this.grid.getContext('2d')!;
    if (this.image?.width !== w || this.image.height !== h) this.image = gg.createImageData(w, h);
    if (this.lutFor !== palette) {
      this.lut = new Uint32Array(palette.rgba().slice().buffer);
      this.lutFor = palette;
    }
    const px = new Uint32Array(this.image.data.buffer);
    const src = surface.data;
    const lut = this.lut;
    for (let i = 0; i < src.length; i++) px[i] = lut[src[i]];
    gg.putImageData(this.image, 0, 0);

    const bg = this.big.getContext('2d')!;
    bg.imageSmoothingEnabled = false;
    bg.drawImage(this.grid, 0, 0, w * k, h * k);
    this.g.imageSmoothingEnabled = true;
    this.g.imageSmoothingQuality = 'high';
    this.g.drawImage(this.big, 0, 0, out.w, out.h);
  }
}
