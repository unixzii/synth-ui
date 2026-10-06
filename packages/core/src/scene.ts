// A frame's drawing, as a flat list of commands to replay in order: what
// each of a `Backend`'s drawing operations means, and what `SceneRecorder`
// records them as. Coordinates are absolute whole pixels; colours are
// palette indices. Each command names its clip rectangle by index into
// `clips`, so replaying needs no stack. `remap`, `mosaic` and `filter` rework
// what's already been drawn under them, so order matters and is kept, layer
// by layer.

import type { Bitmap, Pattern } from './bitmap.js';
import type { StrengthField } from './filter.js';
import type { Rect } from './geometry.js';
import type { ColorMap, Palette } from './palette.js';

interface Base {
  /** Index into `Scene.clips`. */
  clip: number;
}

export type DrawCommand =
  | (Base & { op: 'fill'; x: number; y: number; w: number; h: number; color: number; pattern: Pattern })
  /** A one-pixel outline just inside the rectangle. */
  | (Base & { op: 'stroke'; x: number; y: number; w: number; h: number; color: number })
  /** Both ends included. */
  | (Base & { op: 'line'; x0: number; y0: number; x1: number; y1: number; color: number })
  | (Base & { op: 'circle'; cx: number; cy: number; r: number; color: number; fill: boolean })
  | (Base & { op: 'pixel'; x: number; y: number; color: number })
  /** A 1-bit image in one colour, each bit a `scale`×`scale` block. */
  | (Base & { op: 'bitmap'; image: Bitmap; x: number; y: number; color: number; scale: number })
  /** A line of text in a registered font, its top left at (x, y). */
  | (Base & { op: 'text'; font: string; text: string; x: number; y: number; color: number; scale: number })
  /** Replace every index in the rectangle through a colour map: washes, fades, tints. */
  | (Base & { op: 'remap'; x: number; y: number; w: number; h: number; map: ColorMap; pattern: Pattern })
  /** Pixelate: each `size`×`size` block, from the rectangle's corner, takes the colour at its centre. */
  | (Base & { op: 'mosaic'; x: number; y: number; w: number; h: number; size: number })
  /**
   * Rework each pixel by its strength in `field` (0–1). 'dither': pixels
   * whose `bayer()` threshold is below round(strength × 16) are mapped, the
   * rest left alone. 'steps': every pixel is mapped. Either way through
   * `maps[round(strength × (maps.length − 1))]`, or `maps[0]` if there's
   * one ('steps' then maps only where strength ≥ ½).
   */
  | (Base & { op: 'filter'; x: number; y: number; w: number; h: number; field: StrengthField; maps: ColorMap[]; blend: 'dither' | 'steps' });

export interface Scene {
  width: number;
  height: number;
  palette: Palette;
  /** Index the frame starts cleared to. */
  background: number;
  /** Clip rectangles, absolute; `clips[0]` is the whole frame. */
  clips: Rect[];
  commands: DrawCommand[];
}
