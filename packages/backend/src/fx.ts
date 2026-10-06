// The CRT's settings, as the app changes them. The backend reads them after
// every frame (see `PostFx` in crates/backend/src/fx.rs, field for field).

/** The phosphor pattern behind the glass. */
export type MaskType = 'aperture' | 'slot' | 'shadow';

/**
 * A CRT, modelled physically: every colour is light, per channel, in linear
 * units, and nothing is told how much to glow. What glows is what's bright,
 * the way the tube does it.
 */
export interface PostFx {
  /** Off: the pixels as they are. */
  enabled: boolean;
  beam: {
    /** How thin a dim beam is, leaving dark gaps between rows: 0 flat, 1 thin lines. */
    scanlines: number;
    /** How much a bright beam widens into those gaps: 0 not at all, 1 fully. */
    bloom: number;
  };
  /** The phosphor pattern, and how much light falls between its stripes or dots (0–1). */
  mask: { type: MaskType; strength: number };
  /** Light scattered in the glass around where it's emitted: the share of it, and how far it reaches (1–6, each doubling). */
  halation: { amount: number; spread: number };
  /** How long each phosphor (red, green, blue) takes to fade to a third, in ms. A colour TV's P22 is around 1, 0.1 and 0.05: no trail at 60 Hz. */
  persistence: [number, number, number];
  /**
   * How fast the phosphor wears where it's lit, dimming there for good: the
   * share of its light lost per hour at full drive. A real tube takes years;
   * this is sped up. 0 turns it off. Wear needs half-float render targets
   * (see `ViewHost.wears`).
   */
  burnIn: number;
  /** Room light the faceplate reflects, in linear units; worn phosphor, browned, reflects less. */
  ambient: number;
  /** Light falling off towards the corners: 0 none, 1 half gone there. */
  vignette: number;
}

export const DEFAULT_FX: PostFx = {
  enabled: true,
  beam: { scanlines: 0.94, bloom: 0.4 },
  mask: { type: 'aperture', strength: 0.45 },
  halation: { amount: 0.16, spread: 3 },
  persistence: [3, 0.3, 0.15],
  burnIn: 0,
  ambient: 0,
  vignette: 0.32,
};
