// Fonts, as the app sees them: faces described as data, handed to the host
// in a named set the way colours are handed over in a palette, and named
// wherever text is drawn or measured. The backend turns each face into
// something it can measure and draw (see `Backend` in ./backend), so how
// glyphs are stored, cached or accelerated stays its own business.

/** A bitmap face: every glyph a 1-bit image, as wide as its rows. */
export interface BitmapFace {
  kind: 'bitmap';
  /** Glyph rows, top to bottom, separated by spaces (see `bitmap`). */
  glyphs: Readonly<Record<string, string>>;
  /** Blank pixels between glyphs. Default 1. */
  spacing?: number;
  /** Drawn for characters the face lacks. Default '?'. */
  fallback?: string;
  /** Characters drawn as other characters, e.g. `♯` → `#`. */
  aliases?: Readonly<Record<string, string>>;
  /** Show lowercase as uppercase. */
  caps?: boolean;
}

/** A face a backend can be handed. Backends reject kinds they can't draw. */
export type FontFace = BitmapFace;

/** Faces by name, for a host to register. */
export type FontSet<N extends string = string> = Readonly<Record<N, FontFace>>;

/** What a font measures at scale 1, in pixels. */
export interface FontMetrics {
  /** Height of a line. */
  height: number;
  /** Space between one glyph and the next. */
  spacing: number;
}

export interface TextStyle {
  color: number;
  /** A registered font name. The host's default font when left out. */
  font?: string;
  /** Whole-number magnification. */
  scale?: number;
}
