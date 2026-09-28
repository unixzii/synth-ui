// The demo's app state: what the widgets show and change. Widgets keep
// their own UI state (scroll positions, edits in progress); this is the
// data they're about.

export const MOODS = ['CALM', 'BRIGHT', 'DREAMY', 'DRIVING'] as const;
export const ROLES = ['LEAD', 'HARMONY', 'COUNTER', 'ARP', 'CHORDS', 'PAD', 'BASS', 'DRUMS'] as const;

export const app = {
  /** The status line's latest message, highlighted for a moment. */
  message: null as { text: string } | null,

  // Core page
  count: 0,
  loop: false,
  mode: 'SAW' as 'SINE' | 'SAW' | 'SQUARE' | 'NOISE',
  picked: 0,
  sheet: false,
  stars: new Set<string>(),
  swapped: false,

  // Controls page
  on: true,
  mood: 'DREAMY' as (typeof MOODS)[number],
  wave: 'saw',
  shape: 'SQUARE' as string,
  checks: { bloom: true, scanlines: true, metronome: false },
  role: 5,
  instrument: 2,
  bpm: 112,
  bars: 8,
  filter: 'lowpass',
  knobs: [0.5, 0.3, 0.72, 0.5, 0.1],
  sliders: { level: 0.6, pan: 0.5, eq: [0.5, 0.7, 0.35] },
  more: false,

  // Text page
  title: 'SUNFLOWER STANDOFF',
  name: 'GLASS LEAD',
  tempo: '120',
  note: '',
  log: [] as string[],

  // Lists page
  row: 0,
  favourites: new Set<number>(),
};

/** Say something in the status line, for a moment. */
export function say(text: string): void {
  app.message = { text };
}
