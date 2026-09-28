// 1-bit images (glyphs, icons, masks) and ordered-dither fill patterns: the
// two ways pixel art draws shape and shade without more colours.

/** A 1-bit image: glyphs, icons, masks. */
export interface Bitmap {
  readonly w: number;
  readonly h: number;
  /** Row-major, one byte per pixel, non-zero = set. */
  readonly bits: Uint8Array;
}

/** Parse rows of `#` (set) and `.` (clear), separated by spaces or newlines. */
export function bitmap(rows: string): Bitmap {
  const lines = rows.trim().split(/\s+/);
  const w = Math.max(...lines.map((l) => l.length));
  const bits = new Uint8Array(w * lines.length);
  lines.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) if (line[x] === '#') bits[y * w + x] = 1;
  });
  return { w, h: lines.length, bits };
}

/**
 * A fill pattern: a 4×4 ordered dither as a 16-bit mask (bit `y*4+x`, in
 * screen coordinates, so neighbouring fills line up).
 */
export type Pattern = number;

/** Every pixel. */
export const SOLID: Pattern = 0xffff;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * The ordered-dither pattern with `level` of its sixteen pixels set (0–16,
 * rounded). Levels nest, so a fade through them doesn't shimmer.
 */
export function dither(level: number): Pattern {
  const l = Math.round(level);
  let mask = 0;
  for (let i = 0; i < 16; i++) if (BAYER[i] < l) mask |= 1 << i;
  return mask;
}

/**
 * The ordered-dither threshold at pixel (x, y), 0–15: a pixel is set at
 * dither level `l` when its threshold is below `l`, as in `dither()`.
 */
export const bayer = (x: number, y: number): number => BAYER[(y & 3) * 4 + (x & 3)];

/** The dither closest to `amount` (0–1) of coverage. */
export const shade = (amount: number): Pattern => dither(Math.min(1, Math.max(0, amount)) * 16);

/** A 50% checkerboard: pixel art's way of saying "half". */
export const HALF: Pattern = dither(8);
