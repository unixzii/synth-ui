// An 8-bit indexed framebuffer and the drawing primitives on top of it.
// Coordinates are integer pixels from the top left; every call goes through
// the current origin and clip, which save()/restore() stack like Canvas 2D.
// Pure data: no DOM, so it runs (and is tested) anywhere.

import { SOLID, type Bitmap, type ColorMap, type Rect } from '@synth-ui/core';

interface State {
  ox: number;
  oy: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class Surface {
  width = 0;
  height = 0;
  data = new Uint8Array(0);
  /** Current origin and clip rectangle (absolute, end-exclusive). */
  private s: State = { ox: 0, oy: 0, x0: 0, y0: 0, x1: 0, y1: 0 };
  private stack: State[] = [];

  constructor(width = 0, height = 0) {
    this.resize(width, height);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(0, Math.floor(width));
    this.height = Math.max(0, Math.floor(height));
    this.data = new Uint8Array(this.width * this.height);
    this.stack = [];
    this.s = { ox: 0, oy: 0, x0: 0, y0: 0, x1: this.width, y1: this.height };
  }

  // ----------------------------------------------------------- state

  save(): void {
    this.stack.push({ ...this.s });
  }

  restore(): void {
    const s = this.stack.pop();
    if (s) this.s = s;
  }

  translate(dx: number, dy: number): void {
    this.s.ox += Math.round(dx);
    this.s.oy += Math.round(dy);
  }

  /** Intersect the clip with a rectangle in current coordinates. */
  clip(x: number, y: number, w: number, h: number): void {
    const s = this.s;
    const ax = Math.round(x) + s.ox;
    const ay = Math.round(y) + s.oy;
    s.x0 = Math.max(s.x0, ax);
    s.y0 = Math.max(s.y0, ay);
    s.x1 = Math.min(s.x1, ax + Math.round(w));
    s.y1 = Math.min(s.y1, ay + Math.round(h));
  }

  /** Replace the clip with an absolute rectangle (or the whole surface), keeping the origin. */
  setClip(r: Rect | null): void {
    const s = this.s;
    s.x0 = r ? Math.max(0, r.x) : 0;
    s.y0 = r ? Math.max(0, r.y) : 0;
    s.x1 = r ? Math.min(this.width, r.x + r.w) : this.width;
    s.y1 = r ? Math.min(this.height, r.y + r.h) : this.height;
  }

  // ----------------------------------------------------------- pixels

  clear(c: number): void {
    this.data.fill(c);
  }

  pset(x: number, y: number, c: number): void {
    const s = this.s;
    const ax = Math.round(x) + s.ox;
    const ay = Math.round(y) + s.oy;
    if (ax < s.x0 || ay < s.y0 || ax >= s.x1 || ay >= s.y1) return;
    this.data[ay * this.width + ax] = c;
  }

  /** The index at a point, or -1 outside the surface. Ignores the clip. */
  pget(x: number, y: number): number {
    const ax = Math.round(x) + this.s.ox;
    const ay = Math.round(y) + this.s.oy;
    if (ax < 0 || ay < 0 || ax >= this.width || ay >= this.height) return -1;
    return this.data[ay * this.width + ax];
  }

  /** Fill a rectangle, optionally through a dither mask (see `dither`). */
  fillRect(x: number, y: number, w: number, h: number, c: number, mask = SOLID): void {
    const r = this.box(x, y, w, h);
    if (!r) return;
    const [x0, y0, x1, y1] = r;
    const { data, width } = this;
    if (mask === SOLID) {
      for (let yy = y0; yy < y1; yy++) data.fill(c, yy * width + x0, yy * width + x1);
      return;
    }
    for (let yy = y0; yy < y1; yy++) {
      const row = (yy & 3) * 4;
      for (let xx = x0; xx < x1; xx++) if (mask & (1 << (row + (xx & 3)))) data[yy * width + xx] = c;
    }
  }

  hline(x: number, y: number, w: number, c: number): void {
    this.fillRect(x, y, w, 1, c);
  }

  vline(x: number, y: number, h: number, c: number): void {
    this.fillRect(x, y, 1, h, c);
  }

  /** A one-pixel outline just inside the rectangle. */
  rect(x: number, y: number, w: number, h: number, c: number): void {
    if (w <= 0 || h <= 0) return;
    this.hline(x, y, w, c);
    this.hline(x, y + h - 1, w, c);
    this.vline(x, y + 1, h - 2, c);
    this.vline(x + w - 1, y + 1, h - 2, c);
  }

  /** A Bresenham line, both ends included. */
  line(x0: number, y0: number, x1: number, y1: number, c: number): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.pset(x0, y0, c);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Midpoint circle outline of radius r around (cx, cy). */
  circle(cx: number, cy: number, r: number, c: number): void {
    this.midpoint(r, (x, y) => {
      for (const [px, py] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) this.pset(cx + px, cy + py, c);
    });
  }

  fillCircle(cx: number, cy: number, r: number, c: number): void {
    this.midpoint(r, (x, y) => {
      this.hline(cx - x, cy + y, 2 * x + 1, c);
      this.hline(cx - x, cy - y, 2 * x + 1, c);
      this.hline(cx - y, cy + x, 2 * y + 1, c);
      this.hline(cx - y, cy - x, 2 * y + 1, c);
    });
  }

  /** Replace every index in a rectangle through a colour map: washes, fades, tints. */
  remap(x: number, y: number, w: number, h: number, map: ColorMap, mask = SOLID): void {
    const r = this.box(x, y, w, h);
    if (!r) return;
    const [x0, y0, x1, y1] = r;
    const { data, width } = this;
    for (let yy = y0; yy < y1; yy++) {
      const row = (yy & 3) * 4;
      for (let xx = x0; xx < x1; xx++) {
        if (mask !== SOLID && !(mask & (1 << (row + (xx & 3))))) continue;
        const i = yy * width + xx;
        data[i] = map[data[i]];
      }
    }
  }

  /** Replace every index in a rectangle with `fn(index, x, y)`, x and y absolute. */
  apply(x: number, y: number, w: number, h: number, fn: (index: number, x: number, y: number) => number): void {
    const r = this.box(x, y, w, h);
    if (!r) return;
    const [x0, y0, x1, y1] = r;
    const { data, width } = this;
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = yy * width + xx;
        data[i] = fn(data[i], xx, yy);
      }
    }
  }

  /**
   * Pixelate a rectangle: each `size`×`size` block, counted from the
   * rectangle's corner, takes the colour at its centre. 1 leaves it as is.
   */
  mosaic(x: number, y: number, w: number, h: number, size: number): void {
    size = Math.floor(size);
    const r = this.box(x, y, w, h);
    if (size <= 1 || !r) return;
    const [x0, y0, x1, y1] = r;
    const { data, width } = this;
    const half = size >> 1;
    for (let by = y0; by < y1; by += size) {
      const ey = Math.min(y1, by + size);
      const sy = Math.min(ey - 1, by + half);
      for (let bx = x0; bx < x1; bx += size) {
        const ex = Math.min(x1, bx + size);
        const c = data[sy * width + Math.min(ex - 1, bx + half)];
        for (let yy = by; yy < ey; yy++) data.fill(c, yy * width + bx, yy * width + ex);
      }
    }
  }

  /** Stamp a 1-bit image in one colour, each bit as a `scale`×`scale` block. */
  bits(img: Bitmap, x: number, y: number, c: number, scale = 1): void {
    x = Math.round(x);
    y = Math.round(y);
    for (let yy = 0; yy < img.h; yy++) {
      for (let xx = 0; xx < img.w; xx++) {
        if (!img.bits[yy * img.w + xx]) continue;
        if (scale === 1) this.pset(x + xx, y + yy, c);
        else this.fillRect(x + xx * scale, y + yy * scale, scale, scale, c);
      }
    }
  }

  // ----------------------------------------------------------- helpers

  /** A rectangle in current coordinates, clipped, as absolute [x0, y0, x1, y1]; null if empty. */
  private box(x: number, y: number, w: number, h: number): [number, number, number, number] | null {
    const s = this.s;
    const ax = Math.round(x) + s.ox;
    const ay = Math.round(y) + s.oy;
    const x0 = Math.max(s.x0, ax);
    const y0 = Math.max(s.y0, ay);
    const x1 = Math.min(s.x1, ax + Math.round(w));
    const y1 = Math.min(s.y1, ay + Math.round(h));
    return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
  }

  private midpoint(r: number, plot: (x: number, y: number) => void) {
    r = Math.round(r);
    if (r < 0) return;
    let x = r;
    let y = 0;
    let err = 1 - r;
    while (x >= y) {
      plot(x, y);
      y++;
      if (err < 0) err += 2 * y + 1;
      else {
        x--;
        err += 2 * (y - x) + 1;
      }
    }
  }
}
