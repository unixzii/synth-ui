// Fonts belong to the renderer: it loads them, draws them, and answers for
// their metrics. The core only measures, through this interface, and names
// fonts the way CSS names families; which glyphs a name stands for is up to
// the renderer that registered it.

import type { Rect } from './geometry.js';

export interface Font {
  /** Height of a line at scale 1, in pixels. */
  readonly height: number;
  /** Space between one piece of text and the next drawn after it, at scale 1. */
  readonly spacing: number;
  /** Width of `text` at an integer `scale`, without trailing spacing. */
  width(text: string, scale?: number): number;
}

/** Where the core looks fonts up by name; the renderer provides it. */
export interface FontSource {
  /** The font registered as `name`, or the default font when there's no name. */
  font(name?: string): Font;
}

/** The name the default font is registered under. */
export const DEFAULT_FONT = 'default';

export interface TextStyle {
  color: number;
  /** A registered font name, or a font. The default font when left out. */
  font?: string | Font;
  /** Whole-number magnification. */
  scale?: number;
}

/** How many leading characters of `text` fit in `width` pixels. */
export function fitText(font: Font, text: string, width: number, scale = 1): number {
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (font.width(chars.slice(0, mid).join(''), scale) <= width) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join('').length;
}

/** `text` cut to fit `width`, ending in `ellipsis` if anything was cut. */
export function truncate(font: Font, text: string, width: number, scale = 1, ellipsis = ''): string {
  if (font.width(text, scale) <= width) return text;
  const room = width - (ellipsis ? font.width(ellipsis, scale) + scale : 0);
  return text.slice(0, fitText(font, text, room, scale)) + ellipsis;
}

/** Where to draw a line of `text` (its top left) so it's centred in `r`. */
export function centerText(font: Font, text: string, r: Rect, scale = 1): { x: number; y: number } {
  return { x: r.x + Math.floor((r.w - font.width(text, scale)) / 2), y: r.y + Math.floor((r.h - font.height * scale) / 2) };
}
