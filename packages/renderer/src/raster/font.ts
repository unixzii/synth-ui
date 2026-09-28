// Bitmap fonts. Each glyph is a 1-bit image; its width is the length of its
// rows, so one format covers monospaced and proportional faces. Text is drawn
// straight into a Surface in a palette index, at any integer scale.
//
// The faces come from the app, as data (a `FontSet`, like a palette); a
// FontRegistry makes each into a font it can draw, and is the core's
// FontSource: it measures and lays text out by name.

import { bitmap, type AttributedText, type Bitmap, type BitmapFace, type FontFace, type FontSet, type TextLayout, type TextLayoutOptions } from '@synth-ui/core';
import { basicTextLayout, type Font, type FontSource } from '@synth-ui/core/backend';
import type { Surface } from './surface.js';

export class BitmapFont implements Font {
  readonly height: number;
  readonly spacing: number;
  private readonly glyphs = new Map<string, Bitmap>();
  private readonly fallback: Bitmap;

  constructor(private readonly face: BitmapFace) {
    for (const [ch, rows] of Object.entries(face.glyphs)) this.glyphs.set(ch, bitmap(rows));
    if (!this.glyphs.size) throw new Error('synth-ui: a bitmap face needs at least one glyph');
    this.height = Math.max(...[...this.glyphs.values()].map((g) => g.h));
    this.spacing = face.spacing ?? 1;
    this.fallback = this.glyphs.get(face.fallback ?? '?') ?? [...this.glyphs.values()][0];
  }

  glyph(ch: string): Bitmap {
    const { aliases, caps } = this.face;
    const c = aliases?.[ch] ?? (this.glyphs.has(ch) ? ch : caps ? ch.toUpperCase() : ch);
    return this.glyphs.get(c) ?? this.fallback;
  }

  /** Width of a string in pixels, without trailing spacing. */
  width(text: string, scale = 1): number {
    let w = 0;
    for (const ch of text) w += (this.glyph(ch).w + this.spacing) * scale;
    return Math.max(0, w - this.spacing * scale);
  }

  /** Draw text with its top-left at (x, y). Returns the pen position after it, spacing included. */
  draw(s: Surface, text: string, x: number, y: number, color: number, scale = 1): number {
    let cx = Math.round(x);
    for (const ch of text) {
      const g = this.glyph(ch);
      if (ch !== ' ') s.bits(g, cx, y, color, scale);
      cx += (g.w + this.spacing) * scale;
    }
    return cx;
  }
}

/** The font for a face, if the rasterizer can draw its kind. */
function fontFor(name: string, face: FontFace): BitmapFont {
  if (face.kind === 'bitmap') return new BitmapFont(face);
  throw new Error(`synth-ui: the font "${name}" is a ${(face as { kind: string }).kind} face, which this renderer can't draw`);
}

// ---------------------------------------------------------------- registry

/** Fonts by name, made from an app's faces. The default is `defaultFont`, else the set's first. */
export class FontRegistry implements FontSource {
  readonly defaultFont: string;
  private readonly fonts = new Map<string, BitmapFont>();

  constructor(faces: FontSet, defaultFont?: string) {
    for (const [name, face] of Object.entries(faces)) this.register(name, face);
    const first = this.fonts.keys().next();
    this.defaultFont = defaultFont ?? (first.done ? '' : first.value);
    if (!this.fonts.has(this.defaultFont)) throw new Error(defaultFont === undefined ? 'synth-ui: no fonts given' : `synth-ui: no font "${defaultFont}" to be the default`);
  }

  /** Add (or replace) a face. */
  register(name: string, face: FontFace): void {
    this.fonts.set(name, fontFor(name, face));
  }

  has(name: string): boolean {
    return this.fonts.has(name);
  }

  font(name: string): BitmapFont {
    const font = this.fonts.get(name);
    if (!font) throw new Error(`synth-ui: no font registered as "${name}"`);
    return font;
  }

  layoutText(text: AttributedText, opts: TextLayoutOptions & { font: string }): TextLayout {
    return basicTextLayout(this.font(opts.font), text, opts);
  }
}
