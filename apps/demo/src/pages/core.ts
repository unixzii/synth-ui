// F1: the core API. Each card exercises one part of it: flowing layout,
// state kept per call site or by key, rects cut from the bounds, filters,
// animation, clipping, and an overlay above everything else.

import { bitmap, radial, ramp, type Context, type FilterOptions } from '@synth-ui/core';
import { ICONS, button, buttonSize, card, iconButton, label, segmented, sheet, useTheme } from '@synth-ui/widgets';
import { app, say } from '../app';

const MODES = ['SINE', 'SAW', 'SQUARE', 'NOISE'] as const;
const CHIPS = ['KICK', 'SNARE', 'HAT', 'CLAP', 'TOM', 'RIM', 'COWBELL', 'SHAKER', 'CONGA', 'RIDE', 'CRASH', 'TAMB'];
const SONGS = ['BLACK GLASS', 'CIRCUIT LIGHT', 'DAD', 'OVERTAKE', 'SIX-BAR ENGINE', 'SUNFLOWER STANDOFF'];
const STAR = bitmap('..#.. .###. ##### .###. .#.#.');

export function corePage(ctx: Context): void {
  const { colors: c } = useTheme(ctx);
  // Shortcuts. They don't fire while a text widget has focus, or while the sheet has the keyboard.
  if (ctx.shortcut('+') || ctx.shortcut('=')) app.count++;
  if (ctx.shortcut('-')) app.count--;
  if (ctx.shortcut('l')) app.sheet = true;

  const colW = Math.floor((ctx.bounds.w - 10) / 2);
  ctx.allocate(
    ctx.cutLeft(colW, 10),
    (col) => {
      flowDemo(card(col, { title: 'FLOW · NATURAL SIZES IN A ROW', h: 44 }));
      stateDemo(card(col, { title: 'STATE · PER CALL SITE, OR BY KEY', h: 58 }));
      cutsDemo(card(col, { title: 'CUTS · RECTS OFF THE BOUNDS', h: 44 }));
      filtersDemo(card(col, { title: 'FILTERS · REWORK WHAT IS DRAWN', h: 60 }));
    },
    { gap: 8 },
  );
  ctx.allocate(
    ctx.bounds,
    (col) => {
      const anim = card(col, { title: 'ANIMATION · A GLIDING LIGHT', h: 44 });
      const next = segmented(anim, { options: MODES, value: app.mode }, anim.cutTop(13));
      if (next) say(`MODE: ${(app.mode = next)}`);
      strip(card(col, { title: 'CLIPPING · HIT TESTS RESPECT IT', h: 44 }));
      const layers = card(col, { title: 'LAYERS · AN OVERLAY ON TOP', h: 44 });
      layers.row({ gap: 6, h: 11, align: 'center' }, (row) => {
        if (button(row, { label: 'OPEN THE SHEET', hint: 'SLIDE UP A SHEET (L)' }).clicked) app.sheet = true;
        label(row, `PICKED: ${SONGS[app.picked]}`, { font: 'small', color: c.muted });
      });
    },
    { gap: 8 },
  );
  library(ctx);
}

function flowDemo(ctx: Context) {
  const { colors: c } = useTheme(ctx);
  ctx.row({ gap: 3, h: 11, align: 'center' }, (row) => {
    if (button(row, { label: '-', hint: 'ONE LESS (-)' }).clicked) app.count--;
    label(row, String(app.count).padStart(3, ' '), { color: c.paper });
    if (button(row, { label: '+', hint: 'ONE MORE (+)' }).clicked) app.count++;
    if (button(row, { label: 'RESET', disabled: app.count === 0, hint: 'BACK TO ZERO' }).clicked) app.count = 0;
    row.cursor.x += 6;
    if (button(row, { label: 'LOOP', on: app.loop, hint: app.loop ? 'LOOP: ON' : 'LOOP: OFF' }).clicked) app.loop = !app.loop;
  });
  label(ctx, 'THE COUNT IS APP STATE. + AND - KEYS WORK TOO', { font: 'small', color: c.slate }, ctx.cutBottom(5));
}

/**
 * Two of the same component, each keeping its own count. Swap them: with a
 * key, each count follows its counter; by position alone, it would stay put.
 */
function stateDemo(ctx: Context) {
  const swap = ctx.cutRight(buttonSize(ctx, { label: 'SWAP' }).w);
  if (button(ctx, { label: 'SWAP', hint: 'SWAP THE COUNTERS: THE COUNTS GO WITH THEM' }, { ...swap, h: 11 }).clicked) app.swapped = !app.swapped;
  const names = app.swapped ? ['RIGHT', 'LEFT'] : ['LEFT', 'RIGHT'];
  for (const name of names) ctx.allocate({ w: ctx.bounds.w, h: 16 }, (slot) => counter(slot, name), { key: `counter:${name}` });
}

/** A component with its own state, kept under its region's key. */
function counter(ctx: Context, name: string) {
  const { colors: c } = useTheme(ctx);
  const s = ctx.state(() => ({ n: 0 }));
  ctx.row({ gap: 3, h: 11, align: 'center' }, (row) => {
    label(row, name, { font: 'small', color: c.muted }, row.place({ w: 26, h: 11 }));
    if (iconButton(row, { icon: ICONS.minus, hint: `${name}: ONE LESS` }).clicked) s.n--;
    label(row, String(s.n).padStart(3, ' '), { color: c.paper });
    if (iconButton(row, { icon: ICONS.plus, hint: `${name}: ONE MORE` }).clicked) s.n++;
  });
}

function cutsDemo(ctx: Context) {
  const { colors: c } = useTheme(ctx);
  ctx.allocate(ctx.cutTop(11), (bar) => {
    // Right to left, like the tracker's track list header.
    for (const name of ['DELETE', 'COPY', 'NEW']) {
      const r = bar.cutRight(buttonSize(bar, { label: name, pad: 3 }).w, 3);
      if (button(bar, { label: name, pad: 3, hint: `${name} A TRACK` }, r).clicked) say(`${name}!`);
    }
    label(bar, 'TRACKS 04/16', { font: 'small', color: c.muted }, bar.bounds);
  });
  label(ctx, 'CUT FROM THE RIGHT, THE LABEL GETS THE REST', { font: 'small', color: c.slate }, ctx.cutBottom(5));
}

/** The same block three ways: dissolved by dither, faded through the palette in steps, and a dithered vignette. */
function filtersDemo(ctx: Context) {
  const { colors: c } = useTheme(ctx);
  const w = Math.floor((ctx.bounds.w - 12) / 3);
  const swatches: [string, FilterOptions][] = [
    ['DITHER', { to: c.bg, strength: ramp('right') }],
    ['STEPS', { to: c.bg, strength: ramp('right'), blend: 'steps' }],
    ['RADIAL', { to: c.bg, strength: radial({ inner: 4 }) }],
  ];
  ctx.row({ gap: 6 }, (row) =>
    swatches.forEach(([name, filter]) =>
      row.allocate({ w, h: 34 }, (sw) => {
        const r = sw.cutTop(24, 3);
        sw.fillRect(r, c.accent);
        label(sw, 'SYNTH', { scale: 2, align: 'center', color: c.paper }, r);
        sw.filter(r, filter);
        label(sw, name, { font: 'small', color: c.muted }, sw.bounds);
      }),
    ),
  );
}

/** Chips in a clipped window that scrolls a chip at a time, gliding; half-hidden chips answer only inside it. */
function strip(ctx: Context) {
  const { colors: c } = useTheme(ctx);
  const s = ctx.state(() => ({ first: 0, picked: -1 }));
  const pitch = 44;
  const row = ctx.cutTop(11);
  const next = { ...row, x: row.x + row.w - 11, w: 11 };
  const prev = { ...next, x: next.x - 12 };
  const view = { ...row, w: prev.x - 4 - row.x };
  const fits = Math.floor(view.w / pitch);
  const max = CHIPS.length - fits;

  // Registered before the chips, so they sit on top for presses; only this takes the wheel.
  const area = ctx.interaction(view, { click: false, wheel: true, hint: 'SCROLL OR SWIPE' });
  const by = ctx.wheelSteps(area, 30) + ctx.wheelSteps(area, 30, 'x');
  if (iconButton(ctx, { icon: ICONS.left, disabled: s.first <= 0, hint: 'SCROLL LEFT' }, prev).clicked) s.first--;
  if (iconButton(ctx, { icon: ICONS.right, disabled: s.first >= max, hint: 'SCROLL RIGHT' }, next).clicked) s.first++;
  s.first = Math.max(0, Math.min(max, s.first + by));
  const scroll = ctx.animatedValue(s.first * pitch, { snap: 0.5 });

  ctx.allocate(
    view,
    (win) => {
      CHIPS.forEach((name, i) => {
        const r = { x: i * pitch - Math.round(scroll), y: 0, w: pitch - 3, h: 11 };
        if (button(win, { label: name, on: i === s.picked, hint: `PICK ${name}` }, r).clicked) {
          s.picked = i;
          say(`PICKED ${name}`);
        }
      });
      // Fade out whichever edge has more beyond it.
      const fade = 32;
      if (scroll > 0.5) win.filter({ x: 0, y: 0, w: fade, h: 11 }, { to: c.bg, strength: ramp('left') });
      if (scroll < max * pitch - 0.5) win.filter({ x: win.bounds.w - fade, y: 0, w: fade, h: 11 }, { to: c.bg, strength: ramp('right') });
    },
    { clip: true },
  );
  label(ctx, `${s.first + 1}-${s.first + fits} OF ${CHIPS.length}`, { font: 'small', color: c.slate }, ctx.cutBottom(5));
}

/** The library sheet: rows with a star each; the row lights while the pointer is anywhere on it. */
function library(ctx: Context) {
  const { colors: c } = useTheme(ctx);
  const rowH = 18;
  const res = sheet(ctx, { open: app.sheet, title: 'LIBRARY', w: 300, h: 26 + SONGS.length * rowH + 8 }, (p) => {
    SONGS.forEach((song, i) => {
      const r = { x: -6, y: i * rowH, w: p.bounds.w + 12, h: rowH };
      const row = p.interaction(r, { cursor: 'pointer', hint: `OPEN ${song}` });
      if (p.containsPointer(r)) p.fillRect(r, c.line);
      if (i === app.picked) p.fillRect({ x: r.x, y: r.y + 3, w: 2, h: r.h - 6 }, c.accent);
      label(p, song, { color: i === app.picked ? c.accent : c.text }, { x: 4, y: r.y, w: 200, h: r.h });
      const star = app.stars.has(song);
      if (iconButton(p, { icon: STAR, on: star, hint: star ? 'UNSTAR' : 'STAR' }, { x: r.x + r.w - 20, y: r.y + 3, w: 12, h: 12 }).clicked) {
        if (star) app.stars.delete(song);
        else app.stars.add(song);
      }
      if (row.clicked) {
        app.picked = i;
        app.sheet = false;
        say(`OPENED ${song}`);
      }
    });
  });
  if (res.dismissed) app.sheet = false;
}
