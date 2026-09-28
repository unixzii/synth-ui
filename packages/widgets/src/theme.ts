// The Synthez look: warm paper and ink, and one orange, on a dark screen,
// laid out as ramps so washes and fades land on real palette entries; and
// two pixel faces, the 5×7 for text and a small one for labels.
//
//   neutrals  14  warm greys, void → white. The chrome lives here.
//   accent     4  ember → rust → orange → flame.
//
// An app's palette starts with these and adds its own colours after them,
// and its fonts are these plus its own; widgets find both by name, so the
// order doesn't matter.

import { createToken, type Context, type FontSet, type Palette, type PaletteEntry } from '@synth-ui/core';
import { FONT_5X7, FONT_SMALL } from './fonts.js';

export const THEME_COLORS = [
  ['void', '#0B0A09'],
  ['bg', '#141210'],
  ['panel', '#1A1714'],
  ['raised', '#211D19'],
  ['control', '#2A2520'],
  ['line', '#2E2823'],
  ['border', '#3B352F'],
  ['dim', '#57504A'],
  ['slate', '#736C64'],
  ['muted', '#8C877E'],
  ['ash', '#ADA89E'],
  ['text', '#CFC8BC'],
  ['paper', '#F0E0DD'],
  ['white', '#FFFFFF'],

  ['ember', '#3F2213'],
  ['rust', '#7A3415'],
  ['accent', '#E8591A'],
  ['flame', '#FF9150'],
] as const satisfies readonly PaletteEntry<string>[];

export type ThemeColor = (typeof THEME_COLORS)[number][0];

/** The faces widgets draw with, by the names they ask for. Give them to the host: `fonts: THEME_FONTS`. */
export const THEME_FONTS = {
  text: FONT_5X7,
  small: FONT_SMALL,
} as const satisfies FontSet;

export type ThemeFont = keyof typeof THEME_FONTS;

export interface Theme {
  /** Palette indices by name. */
  colors: Readonly<Record<ThemeColor, number>>;
  /** Registered font names: the 5×7 for text, the small proportional face for labels. */
  fonts: Readonly<Record<ThemeFont, string>>;
}

/** The theme for a palette that includes THEME_COLORS. */
export function themeFor(palette: Palette): Theme {
  const index = palette.index as Readonly<Record<string, number>>;
  const colors = {} as Record<ThemeColor, number>;
  for (const [name] of THEME_COLORS) {
    if (!(name in index)) throw new Error(`synth-ui: the palette has no "${name}"; start it with THEME_COLORS`);
    colors[name] = index[name];
  }
  return { colors, fonts: { text: 'text', small: 'small' } };
}

const cache = new WeakMap<Palette, Theme>();

/** The theme widgets draw with: whatever a region provides, else the one for the current palette and THEME_FONTS. */
export const THEME = createToken<Theme>('theme', (ctx) => {
  let t = cache.get(ctx.palette);
  if (!t) {
    t = themeFor(ctx.palette);
    for (const name of Object.values(t.fonts)) if (!ctx.hasFont(name)) throw new Error(`synth-ui: the host has no font "${name}"; give it THEME_FONTS`);
    cache.set(ctx.palette, t);
  }
  return t;
});

export const useTheme = (ctx: Context): Theme => ctx.use(THEME);

/**
 * Text you click: `rest` (default the text colour), lighter under the
 * pointer, the accent while pressed.
 */
export function clickTone(theme: Theme, it: { hovered: boolean; held: boolean }, rest?: number): number {
  const c = theme.colors;
  return it.held ? c.accent : it.hovered ? c.paper : (rest ?? c.text);
}
