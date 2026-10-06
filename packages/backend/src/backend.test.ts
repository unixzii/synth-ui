import { Palette, UI, radial, ramp, type Context } from '@synth-ui/core';
import { describe, expect, it } from 'vitest';
import { WasmBackend, type NativeDraw } from './backend.js';

/** A stand-in for the Rust exports: a 4-pixel monospaced font named 'mono' (narrow 'i'), and a log of calls. */
function fake() {
  const calls: [string, ...unknown[]][] = [];
  const maps: Uint8Array[] = [];
  const log =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const native: NativeDraw = {
    defaultFont: () => 'mono',
    fontId: (name) => (name === 'mono' ? 0 : undefined),
    fontHeight: () => 5,
    fontSpacing: () => 1,
    glyphAdvance: (_, ch) => (calls.push(['glyphAdvance', ch]), ch === 'i' ? 1 : 4),
    setPalette: log('setPalette'),
    addMap: (map) => maps.push(map) - 1,
    clip: log('clip'),
    fill: log('fill'),
    stroke: log('stroke'),
    line: log('line'),
    circle: log('circle'),
    pixel: log('pixel'),
    bitmap: log('bitmap'),
    text: log('text'),
    remap: log('remap'),
    mosaic: log('mosaic'),
    filter: log('filter'),
  };
  return { native, calls, maps };
}

const palette = new Palette([
  ['bg', '#000000'],
  ['fg', '#FFFFFF'],
]);

describe('WasmBackend', () => {
  it('measures as the backend fonts do, asking for each glyph once', () => {
    const { native, calls } = fake();
    const b = new WasmBackend(native);
    expect(b.measureText('mini', 'mono', 1)).toBe(4 + 1 + 1 + 1 + 4 + 1 + 1);
    expect(b.measureText('mini', 'mono', 2)).toBe(26);
    expect(b.measureText('', 'mono', 1)).toBe(0);
    expect(calls.filter((c) => c[0] === 'glyphAdvance').map((c) => c[1])).toEqual(['m', 'i', 'n']);
    expect(b.fontMetrics('mono')).toEqual({ height: 5, spacing: 1 });
    expect(b.hasFont('mono')).toBe(true);
    expect(b.hasFont('nope')).toBe(false);
    expect(() => b.measureText('a', 'nope', 1)).toThrow(/no font/);
  });

  it('hands drawing through by font and colour-map id, uploading each map once a frame', () => {
    const { native, calls, maps } = fake();
    const backend = new WasmBackend(native);
    const ui = new UI({ palette, backend });
    const paint = (ctx: Context) => {
      ctx.allocate({ x: 2, y: 3, w: 20, h: 10 }, (c) => c.text('hi', 1, 1, { color: 1 }), { clip: true });
      ctx.filter({ x: 0, y: 0, w: 8, h: 8 }, { to: 0, strength: ramp('right') });
      ctx.filter({ x: 0, y: 0, w: 8, h: 8 }, { to: 0, strength: radial() });
      ctx.overlay((o) => o.fillRect({ x: 0, y: 0, w: 1, h: 1 }, 1));
    };
    for (let i = 0; i < 2; i++) {
      backend.beginFrame(palette);
      ui.frame({ width: 40, height: 30, time: i * 10, events: [] }, paint);
    }
    // The palette went up once; a map per frame (the same `fill` map both times it's used).
    expect(calls.filter((c) => c[0] === 'setPalette')).toHaveLength(1);
    expect(maps).toHaveLength(2);
    const last = calls.slice(calls.map((c) => c[0]).lastIndexOf('clip'));
    expect(last[0]).toEqual(['clip', 1, 2, 3, 20, 10]);
    expect(last[1]).toEqual(['text', 0, 1, 0, 'hi', 3, 4, 1, 1]);
    const [linear, round] = last.filter((c) => c[0] === 'filter');
    expect(linear.slice(1, 8)).toEqual([0, 0, 0, 0, 8, 8, 1]);
    expect([...(linear[8] as Float64Array)]).toEqual([0.5, 0.5, 7.5, 0.5, 0, 1]);
    expect([...(linear[9] as Uint32Array)]).toEqual([1]);
    expect(round[7]).toBe(2);
    expect([...(round[9] as Uint32Array)]).toEqual([1]);
    expect(last.at(-1)).toEqual(['fill', 1, 0, 0, 0, 1, 1, 1, 0xffff]);
  });
});
