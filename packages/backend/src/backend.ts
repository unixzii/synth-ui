// Core's `Backend`, implemented on what the Rust backend exports: its fonts,
// measured and laid out, and drawing, handed straight through as the
// Context draws. The only bridge between the core and Rust.

import type { AttributedText, Bitmap, ColorMap, FontMetrics, Palette, Pattern, Rect, StrengthField, TextLayout, TextLayoutOptions } from '@synth-ui/core';
import { basicTextLayout, type Backend } from '@synth-ui/core/backend';

/** The drawing and font API the Rust backend exports (`WebDraw`), as this uses it. */
export interface NativeDraw {
  defaultFont(): string;
  fontId(name: string): number | undefined;
  fontHeight(font: number): number;
  fontSpacing(font: number): number;
  glyphAdvance(font: number, ch: string): number;
  setPalette(rgba: Uint8Array): void;
  addMap(map: Uint8Array): number;
  clip(id: number, x: number, y: number, w: number, h: number): void;
  fill(layer: number, clip: number, x: number, y: number, w: number, h: number, c: number, pattern: number): void;
  stroke(layer: number, clip: number, x: number, y: number, w: number, h: number, c: number): void;
  line(layer: number, clip: number, x0: number, y0: number, x1: number, y1: number, c: number): void;
  circle(layer: number, clip: number, cx: number, cy: number, r: number, c: number, fill: boolean): void;
  pixel(layer: number, clip: number, x: number, y: number, c: number): void;
  bitmap(layer: number, clip: number, bits: Uint8Array, w: number, h: number, x: number, y: number, c: number, scale: number): void;
  text(layer: number, clip: number, font: number, text: string, x: number, y: number, c: number, scale: number): void;
  remap(layer: number, clip: number, x: number, y: number, w: number, h: number, map: number, pattern: number): void;
  mosaic(layer: number, clip: number, x: number, y: number, w: number, h: number, size: number): void;
  filter(layer: number, clip: number, x: number, y: number, w: number, h: number, kind: number, field: Float64Array, maps: Uint32Array, steps: boolean): void;
}

interface Font {
  id: number;
  metrics: FontMetrics;
  /** Glyph advances by character, fetched as they're first measured. */
  advances: Map<string, number>;
}

export class WasmBackend implements Backend {
  readonly defaultFont: string;
  private readonly fonts = new Map<string, Font | null>();
  /** This frame's colour maps, by the id the backend knows each by. */
  private maps = new Map<ColorMap, number>();
  private palette: Palette | null = null;

  constructor(private readonly native: NativeDraw) {
    this.defaultFont = native.defaultFont();
  }

  /** The host started a frame: last frame's colour maps are gone, and the palette goes up if it changed. */
  beginFrame(palette: Palette): void {
    this.maps.clear();
    if (palette !== this.palette) {
      this.native.setPalette(palette.rgba());
      this.palette = palette;
    }
  }

  // ------------------------------------------------------------ fonts

  hasFont(name: string): boolean {
    return this.lookup(name) !== null;
  }

  fontMetrics(font: string): FontMetrics {
    return { ...this.font(font).metrics };
  }

  measureText(text: string, font: string, scale: number): number {
    const f = this.font(font);
    const { spacing } = f.metrics;
    let w = 0;
    for (const ch of text) {
      let advance = f.advances.get(ch);
      if (advance === undefined) f.advances.set(ch, (advance = this.native.glyphAdvance(f.id, ch)));
      w += (advance + spacing) * scale;
    }
    return Math.max(0, w - spacing * scale);
  }

  layoutText(text: AttributedText, opts: TextLayoutOptions & { font: string }): TextLayout {
    return basicTextLayout(this.font(opts.font).metrics, (t, s) => this.measureText(t, opts.font, s), text, opts);
  }

  private lookup(name: string): Font | null {
    let f = this.fonts.get(name);
    if (f === undefined) {
      const id = this.native.fontId(name);
      f = id === undefined ? null : { id, metrics: { height: this.native.fontHeight(id), spacing: this.native.fontSpacing(id) }, advances: new Map() };
      this.fonts.set(name, f);
    }
    return f;
  }

  private font(name: string): Font {
    const f = this.lookup(name);
    if (!f) throw new Error(`synth-ui: no font registered as "${name}"`);
    return f;
  }

  // ------------------------------------------------------------ drawing

  clip(id: number, r: Rect): void {
    this.native.clip(id, r.x, r.y, r.w, r.h);
  }

  fill(layer: number, clip: number, x: number, y: number, w: number, h: number, color: number, pattern: Pattern): void {
    this.native.fill(layer, clip, x, y, w, h, color, pattern);
  }

  stroke(layer: number, clip: number, x: number, y: number, w: number, h: number, color: number): void {
    this.native.stroke(layer, clip, x, y, w, h, color);
  }

  line(layer: number, clip: number, x0: number, y0: number, x1: number, y1: number, color: number): void {
    this.native.line(layer, clip, x0, y0, x1, y1, color);
  }

  circle(layer: number, clip: number, cx: number, cy: number, r: number, color: number, fill: boolean): void {
    this.native.circle(layer, clip, cx, cy, r, color, fill);
  }

  pixel(layer: number, clip: number, x: number, y: number, color: number): void {
    this.native.pixel(layer, clip, x, y, color);
  }

  bitmap(layer: number, clip: number, image: Bitmap, x: number, y: number, color: number, scale: number): void {
    this.native.bitmap(layer, clip, image.bits, image.w, image.h, x, y, color, scale);
  }

  text(layer: number, clip: number, font: string, text: string, x: number, y: number, color: number, scale: number): void {
    this.native.text(layer, clip, this.font(font).id, text, x, y, color, scale);
  }

  remap(layer: number, clip: number, x: number, y: number, w: number, h: number, map: ColorMap, pattern: Pattern): void {
    this.native.remap(layer, clip, x, y, w, h, this.map(map), pattern);
  }

  mosaic(layer: number, clip: number, x: number, y: number, w: number, h: number, size: number): void {
    this.native.mosaic(layer, clip, x, y, w, h, size);
  }

  filter(layer: number, clip: number, x: number, y: number, w: number, h: number, field: StrengthField, maps: readonly ColorMap[], blend: 'dither' | 'steps'): void {
    const [kind, values] =
      field.type === 'constant'
        ? [0, [field.value]]
        : field.type === 'linear'
          ? [1, [field.x0, field.y0, field.x1, field.y1, field.start, field.end]]
          : [2, [field.cx, field.cy, field.inner, field.outer, field.start, field.end]];
    const ids = Uint32Array.from(maps, (m) => this.map(m));
    this.native.filter(layer, clip, x, y, w, h, kind, Float64Array.from(values), ids, blend === 'steps');
  }

  /** The id of a colour map this frame, uploading it the first time it's used. */
  private map(map: ColorMap): number {
    let id = this.maps.get(map);
    if (id === undefined) this.maps.set(map, (id = this.native.addMap(map)));
    return id;
  }
}
