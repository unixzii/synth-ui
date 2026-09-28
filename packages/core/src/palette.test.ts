import { describe, expect, it } from 'vitest';
import { bitmap, dither } from './bitmap.js';
import { Palette } from './palette.js';

describe('dither', () => {
  it('sets `level` of 16 pixels, and each level contains the one below', () => {
    const count = (m: number) => m.toString(2).split('1').length - 1;
    for (let l = 0; l <= 16; l++) {
      expect(count(dither(l))).toBe(l);
      if (l > 0) expect(dither(l) & dither(l - 1)).toBe(dither(l - 1));
    }
  });
});

describe('bitmap', () => {
  it('parses rows of # and .', () => {
    const b = bitmap('#. .#');
    expect([b.w, b.h, ...b.bits]).toEqual([2, 2, 1, 0, 0, 1]);
  });
});

describe('Palette', () => {
  const pal = new Palette([
    ['black', '#000000'],
    ['grey', '#808080'],
    ['white', '#FFFFFF'],
    ['red', '#FF0000'],
  ] as const);

  it('names indices and packs colours for the GPU', () => {
    expect(pal.index.white).toBe(2);
    expect([...pal.rgba().subarray(8, 16)]).toEqual([255, 255, 255, 255, 255, 0, 0, 255]);
  });

  it('snaps colours to the nearest entry', () => {
    expect(pal.nearest([250, 240, 245])).toBe(pal.index.white);
    expect(pal.nearest([200, 20, 30])).toBe(pal.index.red);
  });

  it('builds cached mix maps that land on palette entries', () => {
    const map = pal.mixMap(pal.index.white, 0.5);
    expect(map[pal.index.black]).toBe(pal.index.grey);
    expect(map[pal.index.white]).toBe(pal.index.white);
    expect(pal.mixMap(pal.index.white, 0.5)).toBe(map);
    expect(pal.mixMap(pal.index.white, 0)[pal.index.black]).toBe(pal.index.black);
  });

  it('rejects duplicate names and bad colours', () => {
    expect(() => new Palette([['a', '#000000'], ['a', '#FFFFFF']])).toThrow();
    expect(() => new Palette([['a', 'red']])).toThrow();
  });
});
