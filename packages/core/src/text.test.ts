import { describe, expect, it } from 'vitest';
import { SceneRecorder, basicTextLayout } from './backend.js';
import type { Context } from './context.js';
import { Palette } from './palette.js';
import type { AttributedText, TextLayoutOptions } from './text.js';
import { UI } from './ui.js';

// Glyphs 3 wide and 5 tall, a pixel apart: each character advances 4.
const metrics = { height: 5, spacing: 1 };
const width = (t: string, s: number) => Math.max(0, t.length * 4 - 1) * s;
const lay = (text: AttributedText, opts: TextLayoutOptions = {}) => basicTextLayout(metrics, width, text, { ...opts, font: 'mono' });
const lines = (text: AttributedText, opts: TextLayoutOptions = {}) => {
  const l = lay(text, opts);
  return l.lines.map((ln) => l.text.slice(ln.start, ln.end));
};

describe('basicTextLayout', () => {
  it('breaks at spaces, mid-word only for a word too long alone, and always at newlines', () => {
    // 15 pixels: 4 characters.
    expect(lines('ONE TWO THREE', { width: 15, wrap: 'word' })).toEqual(['ONE', 'TWO', 'THRE', 'E']);
    expect(lines('ONE TWO THREE', { width: 15, wrap: 'char' })).toEqual(['ONE ', 'TWO ', 'THRE', 'E']);
    expect(lines('AB\nCD\n')).toEqual(['AB', 'CD', '']);
    expect(lines('')).toEqual(['']);
  });

  it('keeps to maxLines and clips to the width, saying when text was left out', () => {
    const l = lay('ONE TWO THREE', { width: 15, wrap: 'word', maxLines: 2 });
    expect(l.lines.map((ln) => ln.end)).toEqual([3, 7]);
    expect(l.truncated).toBe(true);
    expect(lines('ABCDEF', { width: 10, overflow: 'clip' })).toEqual(['AB']);
    expect(lay('ABCDEF', { width: 10 }).truncated).toBe(false);
    expect(lay('ABCDEF', { width: 10 }).bounds.w).toBe(23);
  });

  it('aligns lines in the box, and stacks them a line gap apart', () => {
    const l = lay('AB\nABCD', { width: 21, height: 20, align: 'right', valign: 'middle', lineGap: 2 });
    expect(l.lines.map((ln) => ln.rect)).toEqual([
      { x: 14, y: 4, w: 7, h: 5 },
      { x: 6, y: 11, w: 15, h: 5 },
    ]);
    expect(l.bounds).toEqual({ x: 6, y: 4, w: 15, h: 12 });
    expect(lay('AB', { width: 20, align: 'center', scale: 2 }).lines[0].rect).toEqual({ x: 3, y: 0, w: 14, h: 10 });
  });

  it('cuts runs where attributes change, later ranges winning', () => {
    const l = lay(
      {
        text: 'ABCDEF',
        attrs: [
          { start: 1, end: 4, color: 2, background: 3 },
          { start: 3, end: 5, color: 4 },
        ],
      },
      { color: 1 },
    );
    expect(l.runs.map((r) => [r.text, r.color, r.background])).toEqual([
      ['A', 1, undefined],
      ['BC', 2, 3],
      ['D', 4, 3],
      ['E', 4, undefined],
      ['F', 1, undefined],
    ]);
    // Glyphs, and the background padded by the spacing either side and half the line gap.
    expect(l.runs[1].rect).toEqual({ x: 4, y: 0, w: 7, h: 5 });
    expect(lay({ text: 'AB', attrs: [{ start: 0, end: 2, background: 1 }] }, { lineGap: 3 }).runs[0].box).toEqual({ x: -1, y: -1, w: 9, h: 7 });
  });

  it('finds carets by index and by point, the later line where two meet', () => {
    const l = lay('ONE TWO', { width: 15, wrap: 'word' });
    expect(l.lineOf(3)).toBe(0);
    expect(l.lineOf(4)).toBe(1);
    expect(l.position(0)).toEqual({ x: 0, y: 0 });
    expect(l.position(3)).toEqual({ x: 12, y: 0 });
    expect(l.position(6)).toEqual({ x: 8, y: 6 });
    // A position off its line is kept to it.
    expect(l.position(6, 0)).toEqual({ x: 12, y: 0 });
    expect(l.indexAt({ x: 9, y: 7 })).toBe(6);
    expect(l.indexAt({ x: 100, y: -5 })).toBe(3);
  });

  it('keeps surrogate pairs whole', () => {
    expect(lines('A😀B', { width: 11, wrap: 'char' })).toEqual(['A😀', 'B']);
  });
});

describe('drawing a layout', () => {
  it('draws backgrounds, then glyphs, then underlines, from the box origin', () => {
    const backend = new SceneRecorder({ defaultFont: 'mono', hasFont: () => true, fontMetrics: () => metrics, measureText: (t, _f, s) => width(t, s) });
    const palette = new Palette([['bg', '#000000']]);
    const ui = new UI({ palette, backend });
    backend.reset(100, 100, palette);
    const paint = (ctx: Context) => {
      const l = ctx.layoutText({ text: 'AB', attrs: [{ start: 1, end: 2, background: 5, underline: 6 }] }, { color: 7 });
      ctx.drawText(l, 10, 20);
    };
    ui.frame({ width: 100, height: 100, time: 0, events: [] }, paint);
    const ops = backend.scene.commands;
    expect(ops.map((c) => c.op)).toEqual(['fill', 'text', 'text', 'fill']);
    expect(ops[0]).toMatchObject({ x: 13, y: 20, w: 5, h: 5, color: 5 });
    expect(ops[2]).toMatchObject({ font: 'mono', text: 'B', x: 14, y: 20, color: 7 });
    expect(ops[3]).toMatchObject({ x: 14, y: 26, w: 3, h: 1, color: 6 });
  });
});
