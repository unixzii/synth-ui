// Rectangles and points in whole virtual pixels. Every rect is x, y, w, h
// from the top left; the right and bottom edges are exclusive.

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

export const inside = (r: Rect, x: number, y: number): boolean => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

export const isEmpty = (r: Rect): boolean => r.w <= 0 || r.h <= 0;

/** The overlap of two rectangles (empty, with zero size, when they don't meet). */
export function intersect(a: Rect, b: Rect): Rect {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Shrink a rectangle by padding on each side, CSS order: left, top, right, bottom. */
export function inset(r: Rect, left: number, top = left, right = left, bottom = top): Rect {
  return { x: r.x + left, y: r.y + top, w: Math.max(0, r.w - left - right), h: Math.max(0, r.h - top - bottom) };
}

/** Where to start something `inner` long to centre it in `outer`, on whole pixels. */
export const center = (outer: number, inner: number): number => Math.floor((outer - inner) / 2);

/** A rect of `size` centred in `r`. */
export const centerIn = (r: Rect, size: Size): Rect => ({ x: r.x + center(r.w, size.w), y: r.y + center(r.h, size.h), w: size.w, h: size.h });
