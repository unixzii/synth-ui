// Bitmap fonts. Each glyph is a 1-bit image; its width is the length of its
// rows, so one format covers monospaced and proportional faces. Text is drawn
// straight into a Surface in a palette index, at any integer scale.
//
// The renderer owns fonts: a FontRegistry is the core's FontSource, and
// widgets ask for faces by name ('5x7', 'small') rather than importing them.

import { DEFAULT_FONT, bitmap, type Bitmap, type Font, type FontSource } from '@synth-ui/core';
import type { Surface } from './surface.js';

export interface FontSpec {
  /** Glyph rows, top to bottom, separated by spaces (see `bitmap`). */
  glyphs: Record<string, string>;
  /** Blank pixels between glyphs. */
  spacing?: number;
  /** Drawn for characters the font lacks. */
  fallback?: string;
  /** Characters drawn as other characters, e.g. `♯` → `#`. */
  aliases?: Record<string, string>;
  /** Show lowercase as uppercase. */
  caps?: boolean;
}

export class BitmapFont implements Font {
  readonly height: number;
  readonly spacing: number;
  private readonly glyphs = new Map<string, Bitmap>();
  private readonly fallback: Bitmap;

  constructor(private readonly spec: FontSpec) {
    for (const [ch, rows] of Object.entries(spec.glyphs)) this.glyphs.set(ch, bitmap(rows));
    this.height = Math.max(...[...this.glyphs.values()].map((g) => g.h));
    this.spacing = spec.spacing ?? 1;
    this.fallback = this.glyphs.get(spec.fallback ?? '?') ?? [...this.glyphs.values()][0];
  }

  glyph(ch: string): Bitmap {
    const { aliases, caps } = this.spec;
    const c = aliases?.[ch] ?? (this.glyphs.has(ch) ? ch : caps ? ch.toUpperCase() : ch);
    return this.glyphs.get(c) ?? this.fallback;
  }

  /** Width of a string in pixels, without trailing spacing. */
  width(text: string, scale = 1): number {
    let w = 0;
    for (const ch of text) w += (this.glyph(ch).w + this.spacing) * scale;
    return Math.max(0, w - this.spacing * scale);
  }

  /** Draw text with its top-left at (x, y). Returns the pen position after it, spacing included. */
  draw(s: Surface, text: string, x: number, y: number, color: number, scale = 1): number {
    let cx = Math.round(x);
    for (const ch of text) {
      const g = this.glyph(ch);
      if (ch !== ' ') s.bits(g, cx, y, color, scale);
      cx += (g.w + this.spacing) * scale;
    }
    return cx;
  }

  /** How many leading characters of `text` fit in `width` pixels. */
  fit(text: string, width: number, scale = 1): number {
    let w = -this.spacing * scale;
    let n = 0;
    for (const ch of text) {
      w += (this.glyph(ch).w + this.spacing) * scale;
      if (w > width) break;
      n++;
    }
    return n;
  }
}

// ------------------------------------------------------------------ 5×7 mono

/** A small raised "m", for minor chords (Am): a plain lowercase m would show as M. */
export const MINOR = 'ₘ';

/** The tracker's face: 5×7, monospaced, uppercase. */
export const FONT_5X7 = new BitmapFont({
  caps: true,
  aliases: { '♯': '#' },
  glyphs: {
    '♭': '#.... #.... #.... ###.. #..#. #..#. ###..',
    '°': '.#... #.#.. .#... ..... ..... ..... .....',
    [MINOR]: '..... ..... ##.#. #.#.# #.#.# #.#.# #...#',
    A: '.###. #...# #...# ##### #...# #...# #...#',
    B: '####. #...# #...# ####. #...# #...# ####.',
    C: '.###. #...# #.... #.... #.... #...# .###.',
    D: '####. #...# #...# #...# #...# #...# ####.',
    E: '##### #.... #.... ####. #.... #.... #####',
    F: '##### #.... #.... ####. #.... #.... #....',
    G: '.###. #...# #.... #.### #...# #...# .####',
    H: '#...# #...# #...# ##### #...# #...# #...#',
    I: '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
    J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
    K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
    L: '#.... #.... #.... #.... #.... #.... #####',
    M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
    N: '#...# #...# ##..# #.#.# #..## #...# #...#',
    O: '.###. #...# #...# #...# #...# #...# .###.',
    P: '####. #...# #...# ####. #.... #.... #....',
    Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
    R: '####. #...# #...# ####. #.#.. #..#. #...#',
    S: '.#### #.... #.... .###. ....# ....# ####.',
    T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
    U: '#...# #...# #...# #...# #...# #...# .###.',
    V: '#...# #...# #...# #...# #...# .#.#. ..#..',
    W: '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
    X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
    Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
    Z: '##### ....# ...#. ..#.. .#... #.... #####',
    '0': '.###. #...# #..## #.#.# ##..# #...# .###.',
    '1': '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
    '2': '.###. #...# ....# ...#. ..#.. .#... #####',
    '3': '##### ...#. ..#.. ...#. ....# #...# .###.',
    '4': '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
    '5': '##### #.... ####. ....# ....# #...# .###.',
    '6': '..##. .#... #.... ####. #...# #...# .###.',
    '7': '##### ....# ...#. ..#.. .#... .#... .#...',
    '8': '.###. #...# #...# .###. #...# #...# .###.',
    '9': '.###. #...# #...# .#### ....# ...#. .##..',
    ' ': '..... ..... ..... ..... ..... ..... .....',
    '-': '..... ..... ..... ##### ..... ..... .....',
    '.': '..... ..... ..... ..... ..... .##.. .##..',
    '·': '..... ..... ..... ..#.. ..... ..... .....',
    '#': '.#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.',
    '=': '..... ..... ##### ..... ##### ..... .....',
    ':': '..... .##.. .##.. ..... .##.. .##.. .....',
    '/': '....# ....# ...#. ..#.. .#... #.... #....',
    '>': '.#... ..#.. ...#. ....# ...#. ..#.. .#...',
    '<': '...#. ..#.. .#... #.... .#... ..#.. ...#.',
    '|': '..#.. ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
    '^': '..#.. .#.#. #...# ..... ..... ..... .....',
    '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
    '%': '##..# ##..# ...#. ..#.. .#... #..## #..##',
    '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
    "'": '..#.. ..#.. .#... ..... ..... ..... .....',
    ',': '..... ..... ..... ..... .##.. ..#.. .#...',
    '(': '...#. ..#.. .#... .#... .#... ..#.. ...#.',
    ')': '.#... ..#.. ...#. ...#. ...#. ..#.. .#...',
    '!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..',
    '[': '.###. .#... .#... .#... .#... .#... .###.',
    ']': '.###. ...#. ...#. ...#. ...#. ...#. .###.',
    '*': '..... #.#.# .###. ##### .###. #.#.# .....',
    '&': '.##.. #..#. .##.. .#... #.#.# #..#. .##.#',
    '_': '..... ..... ..... ..... ..... ..... #####',
    '"': '.#.#. .#.#. ..... ..... ..... ..... .....',
  },
});

/** Horizontal advance per 5×7 character: the tracker grid is laid out in these. */
export const ADVANCE = 6;

// ---------------------------------------------------------- 5px proportional

/** A small proportional face for labels and dense controls: caps 5px tall. */
export const FONT_SMALL = new BitmapFont({
  caps: true,
  aliases: { '♯': '#', '…': '.' },
  glyphs: {
    '♭': '#.. #.. ##. #.# ##.',
    '°': '.#. #.# .#. ... ...',
    [MINOR]: '..... ####. #.#.# #.#.# #.#.#',
    A: '.##. #..# #### #..# #..#',
    B: '###. #..# ###. #..# ###.',
    C: '.### #... #... #... .###',
    D: '###. #..# #..# #..# ###.',
    E: '### #.. ##. #.. ###',
    F: '### #.. ##. #.. #..',
    G: '.### #... #.## #..# .###',
    H: '#..# #..# #### #..# #..#',
    I: '### .#. .#. .#. ###',
    J: '...# ...# ...# #..# .##.',
    K: '#..# #.#. ##.. #.#. #..#',
    L: '#.. #.. #.. #.. ###',
    M: '#...# ##.## #.#.# #...# #...#',
    N: '#..# ##.# #.## #..# #..#',
    O: '.##. #..# #..# #..# .##.',
    P: '###. #..# ###. #... #...',
    Q: '.##. #..# #..# #.#. .#.#',
    R: '###. #..# ###. #.#. #..#',
    S: '.### #... .##. ...# ###.',
    T: '### .#. .#. .#. .#.',
    U: '#..# #..# #..# #..# .##.',
    V: '#...# #...# #...# .#.#. ..#..',
    W: '#...# #...# #.#.# ##.## #...#',
    X: '#.# #.# .#. #.# #.#',
    Y: '#.# #.# .#. .#. .#.',
    Z: '#### ...# .##. #... ####',
    '0': '### #.# #.# #.# ###',
    '1': '.#. ##. .#. .#. ###',
    '2': '##. ..# .#. #.. ###',
    '3': '##. ..# .#. ..# ##.',
    '4': '#.# #.# ### ..# ..#',
    '5': '### #.. ##. ..# ##.',
    '6': '.## #.. ### #.# ###',
    '7': '### ..# .#. .#. .#.',
    '8': '### #.# ### #.# ###',
    '9': '### #.# ### ..# ##.',
    ' ': '.. .. .. .. ..',
    '.': '. . . . #',
    ',': '.. .. .. .# #.',
    ':': '. # . # .',
    '·': '. . # . .',
    '-': '... ... ### ... ...',
    '_': '... ... ... ... ###',
    '/': '..# ..# .#. #.. #..',
    '%': '#.# ..# .#. #.. #.#',
    '#': '.#.#. ##### .#.#. ##### .#.#.',
    '+': '... .#. ### .#. ...',
    '=': '... ### ... ### ...',
    '(': '.# #. #. #. .#',
    ')': '#. .# .# .# #.',
    '[': '## #. #. #. ##',
    ']': '## .# .# .# ##',
    '!': '# # # . #',
    '?': '##. ..# .#. ... .#.',
    "'": '# # . . .',
    '"': '#.# #.# ... ... ...',
    '>': '#.. .#. ..# .#. #..',
    '<': '..# .#. #.. .#. ..#',
    '*': '... #.# .#. #.# ...',
    '&': '.#. #.# .#. #.# .##',
  },
});

// ---------------------------------------------------------------- registry

/** Fonts by name, for the core to look up. Starts with the built-in faces; the 5×7 is the default. */
export class FontRegistry implements FontSource {
  private readonly fonts = new Map<string, BitmapFont>([
    ['5x7', FONT_5X7],
    ['small', FONT_SMALL],
  ]);
  private fallback = '5x7';

  /** Add (or replace) a font; `asDefault` makes it the one used when none is named. */
  register(name: string, font: BitmapFont, asDefault = false): void {
    this.fonts.set(name, font);
    if (asDefault) this.fallback = name;
  }

  font(name: string = DEFAULT_FONT): BitmapFont {
    const font = this.fonts.get(name === DEFAULT_FONT ? this.fallback : name);
    if (!font) throw new Error(`synth-ui: no font registered as "${name}"`);
    return font;
  }
}
