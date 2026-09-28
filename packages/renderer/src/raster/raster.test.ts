import { describe, expect, it } from 'vitest';
import { Palette, UI, bitmap, dither, ramp, type BitmapFace, type Context, type Scene } from '@synth-ui/core';
import { BitmapFont, FontRegistry } from './font.js';
import { rasterize } from './rasterize.js';
import { Surface } from './surface.js';

// A 3×3 face with a narrow I, caps only.
const FACE: BitmapFace = {
  kind: 'bitmap',
  caps: true,
  glyphs: { '?': '### ..# .#.', A: '.#. ### #.#', I: '# # #', ' ': '... ... ...' },
};

const rows = (s: Surface) =>
  Array.from({ length: s.height }, (_, y) => Array.from(s.data.subarray(y * s.width, (y + 1) * s.width)).join(''));

describe('Surface', () => {
  it('fills rectangles clipped to the surface', () => {
    const s = new Surface(4, 3);
    s.fillRect(-1, 1, 3, 5, 7);
    expect(rows(s)).toEqual(['0000', '7700', '7700']);
  });

  it('draws through the current origin and clip, restored by restore()', () => {
    const s = new Surface(5, 3);
    s.save();
    s.translate(1, 1);
    s.clip(0, 0, 2, 1);
    s.fillRect(0, 0, 4, 4, 1);
    s.restore();
    s.pset(4, 2, 2);
    expect(rows(s)).toEqual(['00000', '01100', '00002']);
  });

  it('draws one-pixel outlines and Bresenham lines with both ends', () => {
    const s = new Surface(4, 4);
    s.rect(0, 0, 4, 4, 1);
    expect(rows(s)).toEqual(['1111', '1001', '1001', '1111']);
    const t = new Surface(4, 4);
    t.line(0, 0, 3, 3, 1);
    expect(rows(t)).toEqual(['1000', '0100', '0010', '0001']);
  });

  it('draws symmetric circles', () => {
    const s = new Surface(7, 7);
    s.circle(3, 3, 3, 1);
    const r = rows(s);
    expect(r).toEqual([...r].reverse());
    expect(r.map((l) => [...l].reverse().join(''))).toEqual(r);
    expect(r[0]).toBe('0011100');
  });

  it('remaps indices through a colour map', () => {
    const s = new Surface(2, 1);
    s.data.set([1, 2]);
    const map = new Uint8Array(256).map((_, i) => i);
    map[2] = 9;
    s.remap(0, 0, 2, 1, map);
    expect([...s.data]).toEqual([1, 9]);
  });

  it('pixelates a rectangle into blocks of their centre colour', () => {
    const s = new Surface(6, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) s.pset(x, y, y * 6 + x);
    s.mosaic(1, 0, 5, 4, 2);
    // Column 0 is outside; blocks start at x=1, the last one only one pixel wide.
    expect(Array.from(s.data.slice(0, 6))).toEqual([0, 8, 8, 10, 10, 11]);
    expect(Array.from(s.data.slice(6, 12))).toEqual([6, 8, 8, 10, 10, 11]);
    expect(Array.from(s.data.slice(18, 24))).toEqual([18, 20, 20, 22, 22, 23]);
    const before = s.data.slice();
    s.mosaic(0, 0, 6, 4, 1);
    expect(s.data).toEqual(before);
  });

  it('stamps bitmaps at integer scales', () => {
    const s = new Surface(4, 2);
    s.bits(bitmap('#. .#'), 0, 0, 3, 1);
    s.bits(bitmap('#'), 2, 0, 5, 2);
    expect(rows(s)).toEqual(['3055', '0355']);
  });
});

describe('dithered fills', () => {
  it('fills a checkerboard at 50%', () => {
    const s = new Surface(4, 2);
    s.fillRect(0, 0, 4, 2, 1, dither(8));
    expect(rows(s)).toEqual(['1010', '0101']);
  });
});

describe('BitmapFont', () => {
  const font = new BitmapFont(FACE);

  it('measures without trailing spacing, proportionally, and draws uppercase', () => {
    expect(font.width('AI')).toBe(5);
    expect(font.width('AI', 2)).toBe(10);
    const s = new Surface(6, 3);
    expect(font.draw(s, 'ai', 0, 0, 1)).toBe(6);
    expect(rows(s)).toEqual(['010010', '111010', '101010']);
  });

  it('falls back for missing glyphs', () => {
    expect(font.glyph('Z')).toBe(font.glyph('?'));
  });
});

describe('FontRegistry', () => {
  it('makes fonts from faces, the first the default unless one is named', () => {
    const fonts = new FontRegistry({ a: FACE, b: { ...FACE, spacing: 2 } });
    expect(fonts.defaultFont).toBe('a');
    expect(fonts.font('b').spacing).toBe(2);
    expect(new FontRegistry({ a: FACE, b: FACE }, 'b').defaultFont).toBe('b');
    expect(() => fonts.font('nope')).toThrow();
    expect(() => new FontRegistry({ a: FACE }, 'nope')).toThrow();
    expect(() => new FontRegistry({})).toThrow();
  });
});

describe('rasterize', () => {
  const palette = new Palette([
    ['a', '#000000'],
    ['b', '#FFFFFF'],
  ]);
  const scene = (commands: Scene['commands'], clips = [{ x: 0, y: 0, w: 4, h: 3 }]): Scene => ({ width: 4, height: 3, palette, background: 0, clips, commands });

  it('replays commands in order, each through its clip', () => {
    const s = new Surface();
    rasterize(
      scene(
        [
          { op: 'fill', clip: 1, x: 0, y: 0, w: 4, h: 3, color: 1, pattern: 0xffff },
          { op: 'pixel', clip: 0, x: 3, y: 2, color: 2 },
        ],
        [
          { x: 0, y: 0, w: 4, h: 3 },
          { x: 1, y: 1, w: 2, h: 1 },
        ],
      ),
      s,
      new FontRegistry({ face: FACE }),
    );
    expect(rows(s)).toEqual(['0000', '0110', '0002']);
  });

  it('draws text in the fonts it names', () => {
    const s = new Surface();
    rasterize(scene([{ op: 'text', clip: 0, font: 'face', text: 'II', x: 0, y: 0, color: 1, scale: 1 }]), s, new FontRegistry({ face: FACE }));
    expect(rows(s)).toEqual(['1010', '1010', '1010']);
  });

  it('fades the edge of a region into a colour by ordered dither, within its clip', () => {
    const fonts = new FontRegistry({ face: FACE });
    const ui = new UI({ palette, fonts });
    const paint = (ctx: Context) => {
      ctx.fillRect({ x: 0, y: 0, w: 8, h: 4 }, 1);
      ctx.allocate({ x: 0, y: 0, w: 6, h: 4 }, (c) => c.filter({ x: 2, y: 0, w: 6, h: 4 }, { to: 0, strength: ramp('right') }), { clip: true });
    };
    const s = new Surface();
    rasterize(ui.frame({ width: 8, height: 4, time: 0, events: [] }, paint).scene, s, fonts);
    // How many of each column's pixels became 0: none at the start, all at the end, more each step.
    const faded = Array.from({ length: 8 }, (_, x) => rows(s).filter((row) => row[x] === '0').length);
    expect(faded.slice(0, 3)).toEqual([0, 0, 0]);
    expect(faded.slice(2, 6)).toEqual([...faded.slice(2, 6)].sort((a, b) => a - b));
    // Past the clip, nothing changes; inside, the fade had reached 4/5 of the way.
    expect(faded.slice(6)).toEqual([0, 0]);
    expect(faded[5]).toBeGreaterThanOrEqual(3);
  });
});
