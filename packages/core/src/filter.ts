// Filters rework what's already drawn in a rectangle, pixel by pixel: a
// strength field says how much each pixel is affected (0–1), and a colour
// map says what an affected pixel becomes. Blended by ordered dither, each
// pixel is either replaced or left alone, so a fade dissolves the way pixel
// art does; blended in steps, every pixel goes through the map for its own
// strength, so it fades through the palette's shades.

import type { Point, Rect } from './geometry.js';
import type { ColorMap, Palette } from './palette.js';

export type Side = 'left' | 'right' | 'top' | 'bottom';

/** How strongly a filter affects each pixel: everywhere the same, or varying across it. */
export type Strength = number | LinearRamp | RadialRamp;

export interface LinearRamp {
  type: 'linear';
  /** Rise towards this edge of the filtered rect: 'right' is `start` at the left edge, `end` at the right. */
  toward?: Side;
  /** Or between two points, in the filter's local coordinates. */
  from?: Point;
  to?: Point;
  start: number;
  end: number;
}

export interface RadialRamp {
  type: 'radial';
  /** Local coordinates; default the rect's centre. */
  center?: Point;
  /** `start` within this radius. Default 0. */
  inner?: number;
  /** `end` beyond this radius. Default the distance from the centre to the rect's corners. */
  outer?: number;
  start: number;
  end: number;
}

/** A strength rising from `start` to `end` towards one edge of the filtered rect, or between two points. */
export function ramp(toward: Side | { from: Point; to: Point }, start = 0, end = 1): LinearRamp {
  return typeof toward === 'string' ? { type: 'linear', toward, start, end } : { type: 'linear', ...toward, start, end };
}

/** A strength rising from `start` at the centre (or within `inner`) to `end` at `outer`: vignettes, spotlights. */
export function radial(opts: { center?: Point; inner?: number; outer?: number } = {}, start = 0, end = 1): RadialRamp {
  return { type: 'radial', ...opts, start, end };
}

export interface FilterOptions {
  /**
   * What an affected pixel becomes: a palette index, a colour map, or a
   * colour map per strength (e.g. `(s) => palette.mixMap(bg, s)`).
   */
  to: number | ColorMap | ((strength: number) => ColorMap);
  /** Default 1 everywhere. */
  strength?: Strength;
  /**
   * 'dither' (default): each pixel is replaced or left as it is, by an
   * ordered dither of its strength. 'steps': every pixel is mapped through
   * the map for its strength; a palette index then means mixing towards it.
   * A single colour map can't be stepped: it applies where strength ≥ ½.
   */
  blend?: 'dither' | 'steps';
}

/** A strength field in absolute coordinates, as a Scene carries it. */
export type StrengthField =
  | { type: 'constant'; value: number }
  | { type: 'linear'; x0: number; y0: number; x1: number; y1: number; start: number; end: number }
  | { type: 'radial'; cx: number; cy: number; inner: number; outer: number; start: number; end: number };

/** Levels a strength is quantised to when choosing among per-strength maps. */
const LEVELS = { dither: 16, steps: 32 };

/** @internal Resolve options against the absolute rect being filtered: the field and the maps by level. */
export function resolveFilter(abs: Rect, opts: FilterOptions, palette: Palette): { field: StrengthField; maps: ColorMap[]; blend: 'dither' | 'steps' } {
  const blend = opts.blend ?? 'dither';
  const { to } = opts;
  let maps: ColorMap[];
  if (typeof to === 'function') maps = levels(LEVELS[blend], to);
  else if (typeof to === 'number') maps = blend === 'steps' ? levels(LEVELS.steps, (s) => palette.mixMap(to, s)) : [fillMap(to)];
  else maps = [to];
  return { field: resolveStrength(abs, opts.strength ?? 1), maps, blend };
}

function levels(n: number, map: (s: number) => ColorMap): ColorMap[] {
  return Array.from({ length: n + 1 }, (_, k) => map(k / n));
}

const fills = new Map<number, ColorMap>();

/** A map turning every index into `color`. */
function fillMap(color: number): ColorMap {
  let map = fills.get(color);
  if (!map) fills.set(color, (map = new Uint8Array(256).fill(color)));
  return map;
}

function resolveStrength(r: Rect, s: Strength): StrengthField {
  if (typeof s === 'number') return { type: 'constant', value: s };
  if (s.type === 'radial') {
    const cx = r.x + (s.center ? s.center.x : r.w / 2);
    const cy = r.y + (s.center ? s.center.y : r.h / 2);
    const corner = Math.max(...[r.x, r.x + r.w].flatMap((x) => [r.y, r.y + r.h].map((y) => Math.hypot(x - cx, y - cy))));
    return { type: 'radial', cx, cy, inner: s.inner ?? 0, outer: s.outer ?? corner, start: s.start, end: s.end };
  }
  if (s.from && s.to) return { type: 'linear', x0: r.x + s.from.x, y0: r.y + s.from.y, x1: r.x + s.to.x, y1: r.y + s.to.y, start: s.start, end: s.end };
  // Edge to edge, pixel centre to pixel centre: the first row or column gets `start`, the last `end`.
  const left = r.x + 0.5;
  const right = r.x + r.w - 0.5;
  const top = r.y + 0.5;
  const bottom = r.y + r.h - 0.5;
  const [x0, y0, x1, y1] = { right: [left, top, right, top], left: [right, top, left, top], bottom: [left, top, left, bottom], top: [left, bottom, left, top] }[s.toward ?? 'right'];
  return { type: 'linear', x0, y0, x1, y1, start: s.start, end: s.end };
}

/** The strength of a field at the centre of pixel (x, y), clamped to 0–1. */
export function strengthAt(f: StrengthField, x: number, y: number): number {
  let s: number;
  if (f.type === 'constant') s = f.value;
  else {
    let t: number;
    if (f.type === 'linear') {
      const dx = f.x1 - f.x0;
      const dy = f.y1 - f.y0;
      const len = dx * dx + dy * dy;
      t = len ? ((x + 0.5 - f.x0) * dx + (y + 0.5 - f.y0) * dy) / len : 1;
    } else {
      const span = f.outer - f.inner;
      const d = Math.hypot(x + 0.5 - f.cx, y + 0.5 - f.cy);
      t = span > 0 ? (d - f.inner) / span : d >= f.outer ? 1 : 0;
    }
    t = Math.min(1, Math.max(0, t));
    s = f.start + (f.end - f.start) * t;
  }
  return Math.min(1, Math.max(0, s));
}
