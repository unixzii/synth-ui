// What a host gives the core: its fonts, to measure and lay text out with,
// and the drawing operations a Context calls as it paints. Apps and widgets
// never see a backend; they name fonts, draw and measure through `UI` and
// `Context`.
//
// Frames belong to the host: it decides when one is due, starts it, runs
// the paint function and finishes it, so nothing here begins or ends one.
// Drawing is in absolute whole pixels and palette indices. Each operation
// names the layer it's in (0 at the root, one more per overlay) and its clip
// (an id from `clip()`; 0 is the whole frame); a host draws the layers in
// order, and each layer's operations in the order they came. `DrawCommand`
// (in ./scene) spells out what each operation does.

import type { Bitmap, Pattern } from './bitmap.js';
import type { StrengthField } from './filter.js';
import type { FontMetrics } from './font.js';
import type { Rect } from './geometry.js';
import type { ColorMap, Palette } from './palette.js';
import type { DrawCommand, Scene } from './scene.js';
import { basicTextLayout, type AttributedText, type TextLayout, type TextLayoutOptions } from './text.js';

export interface Backend {
  // ------------------------------------------------------------ fonts

  /** The name of the font used when none is named. */
  readonly defaultFont: string;
  hasFont(name: string): boolean;
  /** What the font named measures at scale 1; throws if there's none. */
  fontMetrics(font: string): FontMetrics;
  /** Width of `text` at an integer `scale`, without trailing spacing; throws if there's no such font. */
  measureText(text: string, font: string, scale: number): number;
  /** Lay `text` out in the font named by `opts.font`. `basicTextLayout` does this for any font that measures. */
  layoutText(text: AttributedText, opts: TextLayoutOptions & { font: string }): TextLayout;

  // ------------------------------------------------------------ drawing

  /** Define clip `id` (ids count up from 1 each frame) as an absolute rectangle. */
  clip(id: number, rect: Rect): void;
  fill(layer: number, clip: number, x: number, y: number, w: number, h: number, color: number, pattern: Pattern): void;
  stroke(layer: number, clip: number, x: number, y: number, w: number, h: number, color: number): void;
  line(layer: number, clip: number, x0: number, y0: number, x1: number, y1: number, color: number): void;
  circle(layer: number, clip: number, cx: number, cy: number, r: number, color: number, fill: boolean): void;
  pixel(layer: number, clip: number, x: number, y: number, color: number): void;
  bitmap(layer: number, clip: number, image: Bitmap, x: number, y: number, color: number, scale: number): void;
  text(layer: number, clip: number, font: string, text: string, x: number, y: number, color: number, scale: number): void;
  remap(layer: number, clip: number, x: number, y: number, w: number, h: number, map: ColorMap, pattern: Pattern): void;
  mosaic(layer: number, clip: number, x: number, y: number, w: number, h: number, size: number): void;
  filter(layer: number, clip: number, x: number, y: number, w: number, h: number, field: StrengthField, maps: readonly ColorMap[], blend: 'dither' | 'steps'): void;
}

/** The font half of a backend. */
export type BackendFonts = Pick<Backend, 'defaultFont' | 'hasFont' | 'fontMetrics' | 'measureText'>;

/**
 * A backend that draws nothing: it records each frame's drawing as a
 * `Scene`, and measures with the fonts it's given. For tests, and for
 * anything that would rather replay a frame than draw it as it comes.
 */
export class SceneRecorder implements Backend {
  private layers: DrawCommand[][] = [[]];
  private clips: Rect[] = [];
  private frame = { width: 0, height: 0, palette: null as Palette | null, background: 0 };

  constructor(private readonly fonts: BackendFonts) {}

  /** Start recording a new frame. */
  reset(width: number, height: number, palette: Palette, background = 0): void {
    this.frame = { width, height, palette, background };
    this.layers = [[]];
    this.clips = [{ x: 0, y: 0, w: width, h: height }];
  }

  /** What's been recorded since `reset()`, layer by layer. */
  get scene(): Scene {
    const { width, height, palette, background } = this.frame;
    if (!palette) throw new Error('synth-ui: SceneRecorder.reset() was never called');
    return { width, height, palette, background, clips: this.clips, commands: this.layers.flatMap((l) => l ?? []) };
  }

  get defaultFont(): string {
    return this.fonts.defaultFont;
  }

  hasFont(name: string): boolean {
    return this.fonts.hasFont(name);
  }

  fontMetrics(font: string): FontMetrics {
    return this.fonts.fontMetrics(font);
  }

  measureText(text: string, font: string, scale: number): number {
    return this.fonts.measureText(text, font, scale);
  }

  layoutText(text: AttributedText, opts: TextLayoutOptions & { font: string }): TextLayout {
    return basicTextLayout(this.fonts.fontMetrics(opts.font), (t, s) => this.fonts.measureText(t, opts.font, s), text, opts);
  }

  clip(id: number, rect: Rect): void {
    this.clips[id] = rect;
  }

  fill(layer: number, clip: number, x: number, y: number, w: number, h: number, color: number, pattern: Pattern): void {
    this.push(layer, { op: 'fill', clip, x, y, w, h, color, pattern });
  }

  stroke(layer: number, clip: number, x: number, y: number, w: number, h: number, color: number): void {
    this.push(layer, { op: 'stroke', clip, x, y, w, h, color });
  }

  line(layer: number, clip: number, x0: number, y0: number, x1: number, y1: number, color: number): void {
    this.push(layer, { op: 'line', clip, x0, y0, x1, y1, color });
  }

  circle(layer: number, clip: number, cx: number, cy: number, r: number, color: number, fill: boolean): void {
    this.push(layer, { op: 'circle', clip, cx, cy, r, color, fill });
  }

  pixel(layer: number, clip: number, x: number, y: number, color: number): void {
    this.push(layer, { op: 'pixel', clip, x, y, color });
  }

  bitmap(layer: number, clip: number, image: Bitmap, x: number, y: number, color: number, scale: number): void {
    this.push(layer, { op: 'bitmap', clip, image, x, y, color, scale });
  }

  text(layer: number, clip: number, font: string, text: string, x: number, y: number, color: number, scale: number): void {
    this.push(layer, { op: 'text', clip, font, text, x, y, color, scale });
  }

  remap(layer: number, clip: number, x: number, y: number, w: number, h: number, map: ColorMap, pattern: Pattern): void {
    this.push(layer, { op: 'remap', clip, x, y, w, h, map, pattern });
  }

  mosaic(layer: number, clip: number, x: number, y: number, w: number, h: number, size: number): void {
    this.push(layer, { op: 'mosaic', clip, x, y, w, h, size });
  }

  filter(layer: number, clip: number, x: number, y: number, w: number, h: number, field: StrengthField, maps: readonly ColorMap[], blend: 'dither' | 'steps'): void {
    this.push(layer, { op: 'filter', clip, x, y, w, h, field, maps: [...maps], blend });
  }

  private push(layer: number, cmd: DrawCommand) {
    (this.layers[layer] ??= []).push(cmd);
  }
}

export { basicTextLayout } from './text.js';
