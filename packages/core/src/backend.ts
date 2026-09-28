// What a renderer gives the core: its fonts, by name, to measure and lay
// text out with. Apps and widgets never hold a font; they name one, and
// measure and lay out through `UI` and `Context`.

import type { AttributedText, TextLayout, TextLayoutOptions } from './text.js';

/** A font as the renderer made it from a face: what the core measures. */
export interface Font {
  /** Height of a line at scale 1, in pixels. */
  readonly height: number;
  /** Space between one glyph and the next, at scale 1. */
  readonly spacing: number;
  /** Width of `text` at an integer `scale`, without trailing spacing. */
  width(text: string, scale?: number): number;
}

/** The renderer's fonts, for the core to look up by name. */
export interface FontSource {
  /** The name of the font used when none is named. */
  readonly defaultFont: string;
  has(name: string): boolean;
  /** The font registered as `name`; throws if there's none. */
  font(name: string): Font;
  /** Lay `text` out in the font named by `opts.font`. `basicTextLayout` does this for any font. */
  layoutText(text: AttributedText, opts: TextLayoutOptions & { font: string }): TextLayout;
}

export { basicTextLayout } from './text.js';
