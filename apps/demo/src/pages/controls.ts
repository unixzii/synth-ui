// F2: controls. Buttons of every kind, chips and segments, checkboxes,
// steppers and scrubbed values, a dropdown and a menu, knobs and sliders.

import type { Context } from '@synth-ui/core';
import {
  ICONS,
  button,
  card,
  checkbox,
  chipGroup,
  dropdown,
  iconButton,
  knob,
  label,
  menu,
  scrubValue,
  segmented,
  slider,
  stepper,
  textButton,
  useTheme,
} from '@synth-ui/widgets';
import { MOODS, ROLES, app, say } from '../app';

const WAVES = [
  { value: 'sine', icon: ICONS.play, hint: 'WAVE: SINE' },
  { value: 'saw', icon: ICONS.right, hint: 'WAVE: SAW' },
  { value: 'square', icon: ICONS.pause, hint: 'WAVE: SQUARE' },
  { value: 'noise', icon: ICONS.menu, hint: 'WAVE: NOISE' },
];
const INSTRUMENTS = ['GLASS LEAD', 'SUPERSAW', 'SYNC LEAD', 'PIANO', 'STRINGS', 'MARIMBA'];
const FILTERS = [
  { value: 'lowpass', label: 'LOW-PASS', hint: 'DARKER' },
  { value: 'bandpass', label: 'BAND-PASS', hint: 'NASAL, THIN' },
  { value: 'highpass', label: 'HIGH-PASS', hint: 'AIRY, NO BOTTOM' },
  { value: 'notch', label: 'NOTCH', disabled: true },
];
const MORE = [
  { label: 'DUPLICATE', shortcut: 'MOD+D' },
  { label: 'RENAME', shortcut: 'F2' },
  { label: 'EXPORT', disabled: true },
  { label: 'DELETE', shortcut: 'DEL' },
];
const KNOBS = [
  { label: 'CUTOFF', text: (v: number) => `${Math.round(200 * 2 ** (v * 6.6))} HZ` },
  { label: 'RESO', text: (v: number) => `${Math.round(v * 100)}%` },
  { label: 'DRIVE', text: (v: number) => (v > 0 ? `${Math.round(v * 100)}%` : 'OFF') },
  { label: 'PITCH', text: (v: number) => `${Math.round(v * 48 - 24)} ST`, bipolar: true, steps: 48 },
  { label: 'ECHO', text: (v: number) => (v > 0 ? `${Math.round(v * 100)}%` : 'OFF') },
];

export function controlsPage(ctx: Context): void {
  const { colors: c } = useTheme(ctx);
  const colW = Math.floor((ctx.bounds.w - 10) / 2);

  ctx.allocate(
    ctx.cutLeft(colW, 10),
    (col) => {
      const buttons = card(col, { title: 'BUTTONS', h: 44 });
      buttons.row({ gap: 3, h: 11, align: 'center' }, (row) => {
        if (button(row, { label: 'NEW', hint: 'A PLAIN BUTTON' }).clicked) say('NEW!');
        if (button(row, { label: app.on ? 'ON' : 'OFF', on: app.on, hint: 'A TOGGLE' }).clicked) app.on = !app.on;
        button(row, { label: 'LOCKED', disabled: true });
        row.cursor.x += 6;
        if (iconButton(row, { icon: ICONS.play, hint: 'AN ICON BUTTON' }).clicked) say('PLAY');
        if (iconButton(row, { icon: ICONS.loop, on: app.loop, hint: 'AN ICON TOGGLE' }).clicked) app.loop = !app.loop;
      });
      buttons.cursor.y += 4;
      buttons.row({ gap: 8 }, (row) => {
        for (const name of ['OPEN', 'SAVE', 'WAV', 'MIDI']) if (textButton(row, { label: name, hint: `TEXT BUTTON: ${name}` }).clicked) say(name);
      });

      const chips = card(col, { title: 'CHIPS AND SEGMENTS', h: 60 });
      const mood = chipGroup(chips, { options: MOODS.map((m) => ({ value: m, hint: `A ${m} SONG` })), value: app.mood }, chips.cutTop(11, 4));
      if (mood) say(`MOOD: ${(app.mood = mood)}`);
      chips.row({ gap: 8, h: 13 }, (row) => {
        const wave = chipGroup(row, { options: WAVES, value: app.wave, h: 13 });
        if (wave) app.wave = wave;
        const shape = segmented(row, { options: ['SINE', 'SQUARE', 'SAW'], value: app.shape }, row.place({ w: row.bounds.w - row.cursor.x, h: 13 }));
        if (shape) app.shape = shape;
      });

      const checks = card(col, { title: 'CHECKBOXES', h: 30 });
      checks.row({ gap: 12, h: 9 }, (row) => {
        for (const [key, name] of [['bloom', 'BLOOM'], ['scanlines', 'SCANLINES'], ['metronome', 'METRONOME']] as const) {
          if (checkbox(row, { label: name, checked: app.checks[key], hint: `TURN ${name} ${app.checks[key] ? 'OFF' : 'ON'}` }).clicked) app.checks[key] = !app.checks[key];
        }
        checkbox(row, { label: 'LOCKED', checked: true, disabled: true });
      });

      const values = card(col, { title: 'STEPPERS, VALUES, MENUS', h: 88 });
      values.column({ gap: 5 }, (colm) => {
        colm.row({ gap: 6, h: 13, align: 'center' }, (row) => {
          label(row, 'ROLE', { font: 'small', color: c.text }, row.place({ w: 30, h: 13 }));
          const channel = [c.accent, c.flame, c.paper, c.ash, c.rust, c.accent, c.text, c.muted][app.role];
          const role = stepper(row, { text: ROLES[app.role], swatch: channel, hint: 'SCROLL TO CHANGE', prevHint: 'PREVIOUS ROLE', nextHint: 'NEXT ROLE' }, row.place({ w: 110, h: 13 }));
          if (role.step) app.role = (app.role + role.step + ROLES.length * 8) % ROLES.length;
        });
        colm.row({ gap: 6, h: 13, align: 'center' }, (row) => {
          label(row, 'SOUND', { font: 'small', color: c.text }, row.place({ w: 30, h: 13 }));
          const inst = stepper(
            row,
            { text: `0${app.instrument + 1} ${INSTRUMENTS[app.instrument]}`, clickable: true, prevDisabled: app.instrument === 0, nextDisabled: app.instrument === INSTRUMENTS.length - 1, hint: 'CLICK TO EDIT IT' },
            row.place({ w: 140, h: 13 }),
          );
          if (inst.step) app.instrument += inst.step;
          if (inst.value.clicked) say(`EDIT ${INSTRUMENTS[app.instrument]}`);
        });
        colm.row({ gap: 6, h: 13, align: 'center' }, (row) => {
          const bpm = scrubValue(row, { value: app.bpm, min: 40, max: 240, text: `${app.bpm} BPM`, hint: 'DRAG OR SCROLL TO CHANGE THE TEMPO' });
          if (bpm !== null) app.bpm = bpm;
          label(row, 'BARS', { font: 'small', color: c.muted });
          const bars = scrubValue(row, { value: app.bars, min: 2, max: 32, step: 2, look: 'outline', text: String(app.bars).padStart(2, ' '), hint: 'SCROLL TO CHANGE THE LENGTH' });
          if (bars !== null) app.bars = bars;
          row.cursor.x += 6;
          const filter = dropdown(row, { options: FILTERS, value: app.filter, hint: 'FILTER TYPE' });
          if (filter) say(`FILTER: ${(app.filter = filter).toUpperCase()}`);
          const anchor = row.place({ w: 40, h: 13 });
          if (button(row, { label: 'MORE', on: app.more, hint: 'A MENU' }, anchor).pressed) app.more = true;
          const res = menu(row, { items: MORE, anchor, open: app.more });
          if (res.dismissed) app.more = false;
          if (res.picked !== null) {
            app.more = false;
            say(`MENU: ${MORE[res.picked].label}`);
          }
        });
      });
    },
    { gap: 8 },
  );

  ctx.allocate(
    ctx.bounds,
    (col) => {
      const knobs = card(col, { title: 'KNOBS · DRAG, SHIFT FOR FINE, SCROLL, DOUBLE-CLICK', h: 62 });
      const w = Math.floor(knobs.bounds.w / KNOBS.length);
      KNOBS.forEach((k, i) => {
        const v = knob(knobs, { label: k.label, value: app.knobs[i], text: k.text(app.knobs[i]), reset: 0.5, bipolar: k.bipolar, steps: k.steps }, { x: i * w, y: 3, w, h: 40 });
        if (v !== null) app.knobs[i] = v;
      });

      const sliders = card(col, { title: 'SLIDERS · PRESS ANYWHERE ON ONE, SCROLL, DOUBLE-CLICK', h: 104 });
      sliders.column({ gap: 6 }, (colm) => {
        const row = (name: string, fn: (r: Context) => void) =>
          colm.row({ gap: 6, h: 9, align: 'center' }, (r) => {
            label(r, name, { font: 'small', color: c.text }, r.place({ w: 34, h: 9 }));
            fn(r);
          });
        row('LEVEL', (r) => {
          const v = slider(r, { value: app.sliders.level, reset: 0.6, hint: 'LEVEL' }, r.place({ w: 140, h: 9 }));
          if (v !== null) app.sliders.level = v;
          label(r, `${Math.round(app.sliders.level * 100)}%`, { font: 'small', color: c.muted });
        });
        row('PAN', (r) => {
          const v = slider(r, { value: app.sliders.pan, bipolar: true, step: 0.02, reset: 0.5, hint: 'LEFT OR RIGHT' }, r.place({ w: 140, h: 9 }));
          if (v !== null) app.sliders.pan = v;
          const p = Math.round((app.sliders.pan - 0.5) * 200);
          label(r, p === 0 ? 'C' : `${p < 0 ? 'L' : 'R'}${Math.abs(p)}`, { font: 'small', color: c.muted });
        });
      });
      sliders.cursor.y += 8;
      sliders.row({ gap: 14, h: 50 }, (r) => {
        label(r, 'EQ', { font: 'small', color: c.text }, r.place({ w: 20, h: 50 }));
        app.sliders.eq.forEach((v, i) => {
          const next = slider(r, { value: v, vertical: true, reset: 0.5, hint: ['LOW', 'MID', 'HIGH'][i] }, r.place({ w: 9, h: 50 }));
          if (next !== null) app.sliders.eq[i] = next;
        });
      });
    },
    { gap: 8 },
  );
}
