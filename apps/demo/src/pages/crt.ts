// F5: the CRT. Every part of the simulated tube, live, beside a test
// pattern: bright text and blocks for the beam and the glass, thin lines for
// the mask, a sweeping bar for the phosphors' fade, and whatever sits still
// long enough for burn-in.

import type { Context } from '@synth-ui/core';
import { DEFAULT_FX, type MaskType, type WebHost } from '@synth-ui/renderer/web';
import { button, card, checkbox, label, segmented, slider, useTheme } from '@synth-ui/widgets';
import { say } from '../app';

const MASKS: { value: MaskType; label: string; hint: string }[] = [
  { value: 'aperture', label: 'GRILLE', hint: 'APERTURE GRILLE: UNBROKEN STRIPES' },
  { value: 'slot', label: 'SLOT', hint: 'SLOT MASK: STRIPES IN STAGGERED SLOTS' },
  { value: 'shadow', label: 'SHADOW', hint: 'SHADOW MASK: DOTS' },
];

interface Setting {
  name: string;
  hint: string;
  min: number;
  max: number;
  get: () => number;
  set: (v: number) => void;
  reset: number;
  text: (v: number) => string;
  step?: number;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function crtPage(host: WebHost): (ctx: Context) => void {
  const fx = host.fx;
  const d = DEFAULT_FX;
  const settings: Setting[][] = [
    [
      { name: 'SCANLINES', hint: 'HOW THIN A DIM BEAM IS', min: 0, max: 1, get: () => fx.beam.scanlines, set: (v) => (fx.beam.scanlines = v), reset: d.beam.scanlines, text: pct },
      { name: 'BEAM BLOOM', hint: 'HOW MUCH A BRIGHT BEAM WIDENS', min: 0, max: 1, get: () => fx.beam.bloom, set: (v) => (fx.beam.bloom = v), reset: d.beam.bloom, text: pct },
    ],
    [{ name: 'MASK', hint: 'LIGHT LOST BETWEEN THE PHOSPHORS', min: 0, max: 1, get: () => fx.mask.strength, set: (v) => (fx.mask.strength = v), reset: d.mask.strength, text: pct }],
    [
      { name: 'HALATION', hint: 'LIGHT SCATTERED IN THE GLASS', min: 0, max: 0.6, get: () => fx.halation.amount, set: (v) => (fx.halation.amount = v), reset: d.halation.amount, text: pct },
      { name: 'REACH', hint: 'HOW FAR IT SCATTERS', min: 1, max: 6, step: 1, get: () => fx.halation.spread, set: (v) => (fx.halation.spread = v), reset: d.halation.spread, text: (v) => `${2 ** v} PX` },
    ],
    [0, 1, 2].map((i) => ({
      name: `${'RGB'[i]} DECAY`,
      hint: `HOW LONG THE ${['RED', 'GREEN', 'BLUE'][i]} PHOSPHOR GLOWS ON`,
      min: 0,
      max: 60,
      get: () => fx.persistence[i],
      set: (v: number) => (fx.persistence[i] = v),
      reset: d.persistence[i],
      text: (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} MS`,
    })),
    [
      { name: 'BURN-IN', hint: 'WEAR PER HOUR AT FULL BRIGHTNESS', min: 0, max: 60, get: () => fx.burnIn, set: (v) => (fx.burnIn = v), reset: d.burnIn, text: (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)}/H` },
      { name: 'ROOM LIGHT', hint: 'AMBIENT LIGHT ON THE FACEPLATE', min: 0, max: 0.03, get: () => fx.ambient, set: (v) => (fx.ambient = v), reset: d.ambient, text: (v) => (v * 1000).toFixed(1) },
      { name: 'VIGNETTE', hint: 'FALLING OFF TOWARDS THE CORNERS', min: 0, max: 1, get: () => fx.vignette, set: (v) => (fx.vignette = v), reset: d.vignette, text: pct },
    ],
  ];

  return (ctx) => {
    const { colors: c } = useTheme(ctx);
    ctx.allocate(
      ctx.cutLeft(250, 10),
      (col) => {
        const top = card(col, { title: 'THE TUBE', h: 30 });
        top.row({ gap: 10, h: 11, align: 'center' }, (row) => {
          if (checkbox(row, { label: 'CRT', checked: fx.enabled, hint: 'SIMULATE THE CRT, OR SHOW THE PIXELS AS THEY ARE' }).clicked) fx.enabled = !fx.enabled;
          const mask = segmented(row, { options: MASKS, value: fx.mask.type, h: 11 }, row.place({ w: 120, h: 11 }));
          if (mask) fx.mask.type = mask;
        });
        const titles = ['BEAM', 'MASK', 'GLASS', 'PHOSPHOR', 'WEAR AND ROOM'];
        settings.forEach((group, g) => {
          const box = card(col, { title: titles[g], h: group.length * 13 + 17 });
          box.column({ gap: 4 }, (colm) => {
            for (const s of group) {
              colm.row({ gap: 6, h: 9, align: 'center' }, (row) => {
                label(row, s.name, { font: 'small', color: c.text }, row.place({ w: 64, h: 9 }));
                const v = slider(row, { value: s.get(), min: s.min, max: s.max, step: s.step, reset: s.reset, hint: `${s.hint} · DOUBLE-CLICK TO RESET`, key: `crt:${s.name}` }, row.place({ w: 120, h: 9 }));
                if (v !== null) s.set(v);
                label(row, s.text(s.get()), { font: 'small', color: c.muted });
              });
            }
          });
        });
        col.row({ gap: 6, h: 11 }, (row) => {
          if (button(row, { label: 'FRESH TUBE', hint: 'FORGET THE BURN-IN' }).clicked) {
            host.clearBurnIn();
            say('A FRESH TUBE');
          }
          if (button(row, { label: 'DEFAULTS', hint: 'EVERY SETTING BACK TO DEFAULT_FX' }).clicked) {
            Object.assign(fx, structuredClone(DEFAULT_FX));
            say('DEFAULTS');
          }
        });
      },
      { gap: 6 },
    );
    testPattern(card(ctx, { title: 'TEST PATTERN · LEAVE IT A WHILE TO SEE BURN-IN' }));
  };
}

function testPattern(ctx: Context) {
  const { colors: c } = useTheme(ctx);
  const b = ctx.bounds;
  ctx.requestFrame();

  // Brightness steps, the greys and the accents: the beam widens as they brighten.
  const ramp = [c.bg, c.control, c.border, c.dim, c.slate, c.muted, c.ash, c.text, c.paper, c.white];
  const accents = [c.ember, c.rust, c.accent, c.flame];
  const w = Math.floor(b.w / ramp.length);
  ramp.forEach((col, i) => ctx.fillRect({ x: i * w, y: 0, w, h: 16 }, col));
  const aw = Math.floor(b.w / accents.length);
  accents.forEach((col, i) => ctx.fillRect({ x: i * aw, y: 18, w: aw, h: 10 }, col));

  // Text at every weight, then fine lines: single pixels, one apart, for the mask.
  let y = 36;
  for (const col of [c.slate, c.text, c.paper, c.accent]) {
    label(ctx, 'THE QUICK BROWN FOX 0123456789', { color: col }, { x: 0, y, w: b.w, h: 7 });
    y += 11;
  }
  for (let x = 0; x < 60; x += 2) ctx.vline(x, y + 2, 20, c.paper);
  for (let yy = 0; yy < 20; yy += 2) ctx.hline(70, y + 2 + yy, 60, c.paper);
  ctx.fillRect({ x: 140, y: y + 2, w: 30, h: 20 }, c.white);
  ctx.fillRect({ x: 180, y: y + 2, w: 30, h: 20 }, c.accent);
  ctx.circle(235, y + 12, 9, c.paper);
  ctx.fillCircle(235, y + 12, 3, c.flame);
  y += 30;

  // A bar sweeping to and fro: its trail is the phosphors fading.
  const lane = { x: 0, y, w: b.w, h: 24 };
  ctx.strokeRect(lane, c.border);
  const t = ctx.time / 1000;
  const x = Math.round((Math.sin(t * 2.2) * 0.5 + 0.5) * (lane.w - 10));
  ctx.fillRect({ x: lane.x + x + 2, y: lane.y + 3, w: 6, h: lane.h - 6 }, c.paper);
  label(ctx, 'A SWEEPING BAR: THE TRAIL IS THE PHOSPHOR FADING', { font: 'small', color: c.slate }, { x: 0, y: y + 28, w: b.w, h: 5 });
}
