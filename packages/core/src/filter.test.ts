import { describe, expect, it } from 'vitest';
import { radial, ramp, resolveFilter, strengthAt } from './filter.js';
import { Palette } from './palette.js';

const palette = new Palette([
  ['black', '#000000'],
  ['grey', '#808080'],
  ['white', '#FFFFFF'],
]);
const r = { x: 10, y: 20, w: 4, h: 2 };

describe('filter strength', () => {
  it('ramps from the first column to the last towards an edge', () => {
    const { field } = resolveFilter(r, { to: 0, strength: ramp('right') }, palette);
    expect([10, 11, 12, 13].map((x) => strengthAt(field, x, 20))).toEqual([0, 1 / 3, 2 / 3, 1]);
    const { field: up } = resolveFilter(r, { to: 0, strength: ramp('top', 0.5, 1) }, palette);
    expect([strengthAt(up, 10, 21), strengthAt(up, 10, 20)]).toEqual([0.5, 1]);
  });

  it('ramps between two local points, clamped beyond them', () => {
    const { field } = resolveFilter(r, { to: 0, strength: ramp({ from: { x: 0.5, y: 0 }, to: { x: 2.5, y: 0 } }) }, palette);
    expect([9, 10, 11, 12, 13].map((x) => strengthAt(field, x, 20))).toEqual([0, 0, 0.5, 1, 1]);
  });

  it('rises outwards from the centre of a radial ramp', () => {
    const { field } = resolveFilter({ x: 0, y: 0, w: 10, h: 10 }, { to: 0, strength: radial({ inner: 1, outer: 3 }) }, palette);
    expect(strengthAt(field, 4.5, 4.5)).toBe(0);
    expect(strengthAt(field, 6.5, 4.5)).toBeCloseTo(0.5);
    expect(strengthAt(field, 0, 0)).toBe(1);
  });
});

describe('filter maps', () => {
  it('turns a colour into a solid map when dithered, and a mix per level when stepped', () => {
    const dithered = resolveFilter(r, { to: palette.index.white }, palette);
    expect(dithered.maps).toHaveLength(1);
    expect(dithered.maps[0][palette.index.black]).toBe(palette.index.white);
    const stepped = resolveFilter(r, { to: palette.index.white, blend: 'steps' }, palette);
    expect(stepped.maps).toHaveLength(33);
    expect(stepped.maps[16][palette.index.black]).toBe(palette.index.grey);
    expect(stepped.maps[0][palette.index.black]).toBe(palette.index.black);
  });
});
