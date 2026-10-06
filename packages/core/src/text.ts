// Text layout: text set in a box, broken into lines, aligned, and cut into
// runs wherever its attributes change, ready for `Context.drawText()`.
// Positions are UTF-16 indices into the text, as `String.slice` takes them;
// a caret position is the gap before that character.
//
// The backend lays text out, since the fonts are its own (see `Backend`);
// `basicTextLayout` is a layout any backend can use, built on nothing but
// its fonts' measurements.

import type { FontMetrics } from './font.js';
import type { Point, Rect } from './geometry.js';

export interface TextAttrs {
  /** Palette index of the glyphs. */
  color?: number;
  /** Palette index filled behind the glyphs (see `TextRun.box`). */
  background?: number;
  /** Palette index of a line one pixel under the glyphs. */
  underline?: number;
}

/** Attributes over `start`–`end` (end excluded) of some text. */
export interface TextRange extends TextAttrs {
  start: number;
  end: number;
}

/** Text, plain or with attributes over ranges of it. Where ranges overlap, the later one wins. */
export type AttributedText = string | { readonly text: string; readonly attrs?: readonly TextRange[] };

export interface TextLayoutOptions extends TextAttrs {
  /** A registered font name. Default the host's default font. */
  font?: string;
  /** Whole-number magnification. Default 1. */
  scale?: number;
  /** The box's width: where lines wrap or are clipped, and what they're aligned in. Default: no limit. */
  width?: number;
  /** The box's height, for `valign`. Lines past it are laid out all the same. */
  height?: number;
  /**
   * Where a line breaks when it would run past `width`: 'word' at a space
   * (which then belongs to neither line; mid-word only when a word alone is
   * too wide), 'char' anywhere, 'none' never. Lines always break at '\n'.
   * Default 'none'.
   */
  wrap?: 'none' | 'word' | 'char';
  /** At most this many lines; the rest of the text is left out. */
  maxLines?: number;
  /** 'clip' cuts lines at `width`, keeping whole characters. Default 'visible': they run past it. */
  overflow?: 'visible' | 'clip';
  /** Within `width`. Default 'left'. */
  align?: 'left' | 'center' | 'right';
  /** Within `height`. Default 'top'. */
  valign?: 'top' | 'middle' | 'bottom';
  /** Pixels between one line and the next. Default 1. */
  lineGap?: number;
}

export interface TextLine {
  readonly start: number;
  readonly end: number;
  /** Its glyphs, in the layout's box. */
  readonly rect: Rect;
}

/** A piece of one line with one set of attributes. */
export interface TextRun {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** Its glyphs, in the layout's box: the top left is where it's drawn. */
  readonly rect: Rect;
  /** What its background fills: its glyphs, the font's spacing either side, and half the line gap above and below. */
  readonly box: Rect;
  readonly color: number;
  readonly background?: number;
  readonly underline?: number;
}

export interface TextLayout {
  readonly text: string;
  /** The font it's set in, by name, and at what scale. */
  readonly font: string;
  readonly scale: number;
  /** At least one, even for no text. */
  readonly lines: readonly TextLine[];
  /** In drawing order. */
  readonly runs: readonly TextRun[];
  /** What the lines cover, in the layout's box (whose top left is 0, 0). */
  readonly bounds: Rect;
  /** Some of the text was left out: past `maxLines`, or clipped. */
  readonly truncated: boolean;
  /** The line a caret position is on: the later one where two lines meet. */
  lineOf(index: number): number;
  /** Where the glyph at a caret position starts (its top left), on `line` or its own line. At a line's end, just past its last glyph and the spacing after it. */
  position(index: number, line?: number): Point;
  /** The caret position nearest `p`, on the line at its height. */
  indexAt(p: Point): number;
}

/** Width of some text at an integer scale, without trailing spacing. */
export type MeasureText = (text: string, scale: number) => number;

/** Lay `text` out in a font with these metrics, measured by `measure`: a layout for backends whose fonts only measure. */
export function basicTextLayout(metrics: FontMetrics, measure: MeasureText, text: AttributedText, opts: TextLayoutOptions & { font: string }): TextLayout {
  return new BasicTextLayout(metrics, measure, text, opts);
}

/** The index after the character at `i`, keeping surrogate pairs whole. */
const after = (text: string, i: number) => i + ((text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1);

class BasicTextLayout implements TextLayout {
  readonly text: string;
  readonly font: string;
  readonly scale: number;
  readonly lines: TextLine[] = [];
  readonly runs: TextRun[] = [];
  readonly bounds: Rect;
  readonly truncated: boolean;
  private readonly spacing: number;
  private readonly pitch: number;

  constructor(
    face: FontMetrics,
    private readonly measure: MeasureText,
    input: AttributedText,
    opts: TextLayoutOptions & { font: string },
  ) {
    const text = (this.text = typeof input === 'string' ? input : input.text);
    const attrs = typeof input === 'string' ? [] : (input.attrs ?? []);
    this.font = opts.font;
    const scale = (this.scale = Math.max(1, Math.round(opts.scale ?? 1)));
    const h = face.height * scale;
    const gap = opts.lineGap ?? 1;
    this.spacing = face.spacing * scale;
    this.pitch = h + gap;
    const width = opts.width ?? Infinity;
    const bounded = Number.isFinite(width);
    const wrap = bounded ? (opts.wrap ?? 'none') : 'none';
    const clip = bounded && opts.overflow === 'clip';
    const maxLines = Math.max(1, opts.maxLines ?? Infinity);

    // Lines, as [start, end): what's between two lines (a newline, a space wrapped at) is in neither.
    const spans: [number, number][] = [];
    let truncated = false;
    for (let start = 0; ; ) {
      const nl = text.indexOf('\n', start);
      const hard = nl < 0 ? text.length : nl;
      let end = hard;
      let next = hard + 1;
      if (wrap !== 'none' || clip) {
        const fits = this.fit(start, hard, width);
        if (fits < hard) {
          if (wrap === 'none') {
            end = fits;
            truncated = true;
          } else {
            const space = wrap === 'word' ? text.lastIndexOf(' ', fits) : -1;
            if (space > start) [end, next] = [space, space + 1];
            else {
              end = next = fits > start ? fits : after(text, start);
              if (end >= hard) [end, next] = [hard, hard + 1];
            }
          }
        }
      }
      spans.push([start, end]);
      if (next > text.length) break;
      if (spans.length >= maxLines) {
        truncated = true;
        break;
      }
      start = next;
    }
    this.truncated = truncated;

    // Where the lines go.
    const total = spans.length * this.pitch - gap;
    const box = opts.height ?? total;
    const top = opts.valign === 'middle' ? Math.floor((box - total) / 2) : opts.valign === 'bottom' ? box - total : 0;
    let left = Infinity;
    let right = -Infinity;
    spans.forEach(([start, end], row) => {
      const w = end > start ? measure(text.slice(start, end), scale) : 0;
      const x = !bounded || opts.align === undefined || opts.align === 'left' ? 0 : opts.align === 'center' ? Math.floor((width - w) / 2) : width - w;
      this.lines.push({ start, end, rect: { x, y: top + row * this.pitch, w, h } });
      left = Math.min(left, x);
      right = Math.max(right, x + w);
    });
    this.bounds = { x: left, y: top, w: right - left, h: total };

    // Runs: each line cut wherever an attribute range starts or ends.
    const base = { color: opts.color ?? 0, background: opts.background, underline: opts.underline };
    const pad = Math.floor(gap / 2);
    for (const line of this.lines) {
      const cuts = new Set([line.start, line.end]);
      for (const r of attrs) {
        if (r.start > line.start && r.start < line.end) cuts.add(r.start);
        if (r.end > line.start && r.end < line.end) cuts.add(r.end);
      }
      const at = [...cuts].sort((a, b) => a - b);
      for (let k = 0; k + 1 < at.length; k++) {
        const [a, b] = [at[k], at[k + 1]];
        const run = { ...base };
        for (const r of attrs) {
          if (r.start > a || r.end < b) continue;
          if (r.color !== undefined) run.color = r.color;
          if (r.background !== undefined) run.background = r.background;
          if (r.underline !== undefined) run.underline = r.underline;
        }
        const x = line.rect.x + this.pen(line, a);
        const w = this.pen(line, b) - this.pen(line, a) - this.spacing;
        this.runs.push({
          text: text.slice(a, b),
          start: a,
          end: b,
          rect: { x, y: line.rect.y, w, h },
          box: { x: x - this.spacing, y: line.rect.y - pad, w: w + this.spacing * 2, h: h + pad * 2 },
          ...run,
        });
      }
    }
  }

  lineOf(index: number): number {
    for (let row = this.lines.length - 1; row > 0; row--) if (index >= this.lines[row].start) return row;
    return 0;
  }

  position(index: number, line = this.lineOf(index)): Point {
    const l = this.lines[Math.min(this.lines.length - 1, Math.max(0, line))];
    return { x: l.rect.x + this.pen(l, Math.min(l.end, Math.max(l.start, index))), y: l.rect.y };
  }

  indexAt(p: Point): number {
    const row = Math.floor((p.y - this.bounds.y) / this.pitch);
    const l = this.lines[Math.min(this.lines.length - 1, Math.max(0, row))];
    let best = l.start;
    let bestD = Math.abs(p.x - l.rect.x);
    for (let i = l.start; i < l.end; ) {
      i = after(this.text, i);
      const d = Math.abs(p.x - l.rect.x - this.pen(l, i));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Pixels from the start of `line` to where the glyph at `i` starts. */
  private pen(line: TextLine, i: number): number {
    return i > line.start ? this.measure(this.text.slice(line.start, i), this.scale) + this.spacing : 0;
  }

  /** The end of the longest stretch from `start`, up to `end`, that fits in `width`. */
  private fit(start: number, end: number, width: number): number {
    let e = start;
    while (e < end) {
      const n = after(this.text, e);
      if (this.measure(this.text.slice(start, n), this.scale) > width) break;
      e = n;
    }
    return e;
  }
}
