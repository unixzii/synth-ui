// An indexed palette: up to 256 named colours. Surfaces store indices, never
// colours, so washes and fades are colour maps (index → index lookups), the
// way 8-bit hardware did them.

export type Rgb = readonly [number, number, number];

/** One entry: name and sRGB hex. */
export type PaletteEntry<N extends string> = readonly [name: N, hex: string];

/** A colour map: `map[i]` is the index to draw instead of `i`. */
export type ColorMap = Uint8Array;

export const MAX_COLORS = 256;

export class Palette<N extends string = string> {
  readonly size: number;
  /** Named indices, e.g. `palette.index.paper`. */
  readonly index: Readonly<Record<N, number>>;
  readonly names: readonly N[];
  private readonly rgb: Rgb[];
  private readonly lab: Rgb[];
  private readonly maps = new Map<string, ColorMap>();
  private rgbaCache: Uint8Array | null = null;

  constructor(entries: readonly PaletteEntry<N>[]) {
    if (entries.length === 0 || entries.length > MAX_COLORS) throw new Error(`A palette holds 1–${MAX_COLORS} colours`);
    this.size = entries.length;
    this.names = entries.map(([name]) => name);
    this.rgb = entries.map(([, hex]) => parseHex(hex));
    this.lab = this.rgb.map(oklab);
    const index = {} as Record<N, number>;
    entries.forEach(([name], i) => {
      if (name in index) throw new Error(`Duplicate palette name: ${name}`);
      index[name] = i;
    });
    this.index = index;
  }

  color(i: number): Rgb {
    return this.rgb[i] ?? this.rgb[0];
  }

  hex(i: number): string {
    return `#${this.color(i).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }

  /** The palette entry perceptually closest to an sRGB colour (OKLab distance). */
  nearest(c: Rgb): number {
    const [l, a, b] = oklab(c);
    let best = 0;
    let bestD = Infinity;
    this.lab.forEach(([l2, a2, b2], i) => {
      const d = (l - l2) ** 2 + (a - a2) ** 2 + (b - b2) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  /**
   * A colour map that moves every colour `t` of the way towards `target`,
   * snapped back into the palette. `t` is quantised to 1/32 so maps can be cached.
   */
  mixMap(target: number, t: number): ColorMap {
    const q = Math.round(Math.min(1, Math.max(0, t)) * 32);
    const key = `${target}:${q}`;
    let map = this.maps.get(key);
    if (map) return map;
    const to = this.color(target);
    map = new Uint8Array(MAX_COLORS);
    for (let i = 0; i < MAX_COLORS; i++) {
      if (i >= this.size) map[i] = i;
      else if (q === 0) map[i] = i;
      else map[i] = this.nearest(mixRgb(this.rgb[i], to, q / 32));
    }
    this.maps.set(key, map);
    return map;
  }

  /** WCAG contrast ratio between two entries. */
  contrast(a: number, b: number): number {
    const [hi, lo] = [luminance(this.color(a)), luminance(this.color(b))].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  luminance(i: number): number {
    return luminance(this.color(i));
  }

  /** 256 RGBA texels for the GPU: sRGB colour, opaque. */
  rgba(): Uint8Array {
    if (this.rgbaCache) return this.rgbaCache;
    const out = new Uint8Array(MAX_COLORS * 4);
    for (let i = 0; i < this.size; i++) {
      out.set(this.rgb[i], i * 4);
      out[i * 4 + 3] = 255;
    }
    return (this.rgbaCache = out);
  }
}

// ------------------------------------------------------------- colour maths

export function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as unknown as Rgb;

const toLinear = (v: number) => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};

export function luminance(c: Rgb): number {
  const [r, g, b] = c.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function oklab(c: Rgb): Rgb {
  const [r, g, b] = c.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
