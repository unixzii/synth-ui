// Small controls: text that acts as a button, a row of chips with one lit,
// a segmented choice with a light that glides, and a checkbox.

import { centerIn, type Bitmap, type Context, type Interaction, type Rect, type Size } from '@synth-ui/core';
import { button } from './button.js';
import { label } from './label.js';
import { clickTone, useTheme } from './theme.js';

// ------------------------------------------------------------ textButton

export interface TextButtonProps {
  label: string;
  hint?: string;
  key?: string;
  /** At rest. Default the theme's text colour; lighter under the pointer, the accent while pressed. */
  color?: number;
  /** Dimmed, and deaf to the pointer. */
  disabled?: boolean;
}

/** Text that acts as a button: lighter under the pointer, the accent while pressed. Returns its interaction: check `clicked`. */
export function textButton(ctx: Context, props: TextButtonProps, rect?: Rect): Interaction {
  const theme = useTheme(ctx);
  const font = ctx.font(theme.fonts.text);
  const r = rect ?? ctx.place({ w: font.width(props.label) + 4, h: font.height + 4 });
  const it = ctx.interaction(r, { key: props.key, click: !props.disabled, cursor: props.disabled ? undefined : 'pointer', hint: props.disabled ? undefined : props.hint });
  const at = centerIn(r, { w: font.width(props.label), h: font.height });
  if (props.disabled) ctx.text(props.label, at.x, at.y, { font, color: theme.colors.dim });
  else ctx.text(props.label, at.x, at.y + (it.held ? 1 : 0), { font, color: clickTone(theme, it, props.color) });
  return it;
}

// ------------------------------------------------------------ chipGroup

export interface ChipOption<T> {
  value: T;
  /** Shown if there's no icon; default `String(value)`. */
  label?: string;
  icon?: Bitmap;
  hint?: string;
}

export interface ChipGroupProps<T> {
  options: readonly (ChipOption<T> | (T & string))[];
  /** The lit one, if any. */
  value: T | null;
  key?: string;
  /** Space between chips. Default 3. */
  gap?: number;
  /** Default 11. */
  h?: number;
  /** Space either side of a label, at natural size. Default 4. */
  pad?: number;
}

const option = <T,>(o: ChipOption<T> | (T & string)): ChipOption<T> => (typeof o === 'object' && o !== null ? o : { value: o as T });

/**
 * A row of chips, one of them lit: pick one of a few. Given a rect, the
 * chips share its width; otherwise each is its natural size. Returns the
 * value clicked this frame, if any.
 */
export function chipGroup<T>(ctx: Context, props: ChipGroupProps<T>, rect?: Rect): T | null {
  const { colors: c, fonts } = useTheme(ctx);
  const font = ctx.font(fonts.small);
  const opts = props.options.map(option);
  const gap = props.gap ?? 3;
  const h = props.h ?? 11;
  const pad = props.pad ?? 4;
  const natural = opts.map((o) => (o.icon ? o.icon.w + 6 : font.width(o.label ?? String(o.value)) + pad * 2 + 2));
  const total = natural.reduce((a, b) => a + b, 0) + gap * (opts.length - 1);
  const r = rect ?? ctx.place({ w: total, h });
  // Spare width is shared out, the first chips taking the odd pixels.
  const spare = Math.max(0, r.w - total);
  const widths = natural.map((w, i) => w + Math.floor(spare / opts.length) + (i < spare % opts.length ? 1 : 0));

  const id = ctx.makeKey(props.key);
  let picked: T | null = null;
  let x = r.x;
  opts.forEach((o, i) => {
    const cell = { x, y: r.y, w: widths[i], h: r.h };
    const on = o.value === props.value;
    const key = `${id}:${i}`;
    if (o.icon) {
      const it = ctx.interaction(cell, { key, cursor: 'pointer', hint: o.hint });
      // Pressed, the whole chip sinks a pixel.
      const d = { ...cell, y: cell.y + (it.held ? 1 : 0) };
      if (it.hovered && !on) ctx.fillRect(d, c.raised);
      ctx.strokeRect(d, on ? c.accent : it.hovered ? c.dim : c.border);
      const at = centerIn(d, { w: o.icon.w, h: o.icon.h });
      ctx.bitmap(o.icon, at.x, at.y, on ? c.accent : it.hovered ? c.paper : c.muted);
      if (it.clicked) picked = o.value;
    } else if (button(ctx, { label: o.label ?? String(o.value), on, hint: o.hint, key }, cell).clicked) picked = o.value;
    x += widths[i] + gap;
  });
  return picked;
}

// ------------------------------------------------------------ segmented

export interface SegmentedProps<T> {
  options: readonly (ChipOption<T> | (T & string))[];
  value: T;
  key?: string;
  /** Default 13. */
  h?: number;
}

/** Equal cells in one bar, the chosen one lit by a light that glides to it. Returns the value clicked, if any. */
export function segmented<T>(ctx: Context, props: SegmentedProps<T>, rect?: Rect): T | null {
  const { colors: c, fonts } = useTheme(ctx);
  const font = ctx.font(fonts.small);
  const opts = props.options.map(option);
  const cellW = Math.max(...opts.map((o) => font.width(o.label ?? String(o.value)))) + 16;
  const r = rect ?? ctx.place({ w: cellW * opts.length, h: props.h ?? 13 });
  const w = Math.floor(r.w / opts.length);
  const at = Math.max(0, opts.findIndex((o) => o.value === props.value));
  const id = ctx.makeKey(props.key);
  const x = ctx.animatedValue(at * w, { key: `${id}:light`, snap: 0.5 });

  ctx.fillRect(r, c.control);
  ctx.fillRect({ x: r.x + Math.round(x), y: r.y, w: at === opts.length - 1 ? r.w - at * w : w, h: r.h }, c.accent);
  let picked: T | null = null;
  opts.forEach((o, i) => {
    const cell = { x: r.x + i * w, y: r.y, w: i === opts.length - 1 ? r.w - i * w : w, h: r.h };
    const it = ctx.interaction(cell, { key: `${id}:${i}`, cursor: 'pointer', hint: o.hint });
    if (it.clicked) picked = o.value;
    // The label goes dark while the light is (mostly) under it.
    const lit = Math.abs(x - i * w) < w / 2;
    label(ctx, o.label ?? String(o.value), { font: 'small', align: 'center', color: lit ? c.bg : it.hovered ? c.paper : c.muted }, cell);
  });
  return picked;
}

// ------------------------------------------------------------ checkbox

export interface CheckboxProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  key?: string;
}

const BOX = 7;

export function checkboxSize(ctx: Context, props: Pick<CheckboxProps, 'label'>): Size {
  return { w: BOX + 4 + ctx.font(useTheme(ctx).fonts.small).width(props.label), h: 9 };
}

/** A box and its label, both clickable; the caller flips `checked` when it's clicked. */
export function checkbox(ctx: Context, props: CheckboxProps, rect?: Rect): Interaction {
  const { colors: c } = useTheme(ctx);
  const r = rect ?? ctx.place(checkboxSize(ctx, props));
  const it = ctx.interaction(r, { key: props.key, click: !props.disabled, cursor: props.disabled ? undefined : 'pointer', hint: props.disabled ? undefined : props.hint });
  const hot = it.hovered && !props.disabled;
  // Pressed, the box sinks a pixel, light and all.
  const box = { x: r.x, y: r.y + Math.floor((r.h - BOX) / 2) + (it.held && !props.disabled ? 1 : 0), w: BOX, h: BOX };
  if (hot) ctx.fillRect(box, c.raised);
  ctx.strokeRect(box, props.disabled ? c.control : hot ? c.dim : c.border);
  // Checked: a lit square inside, like an LED.
  if (props.checked) ctx.fillRect({ x: box.x + 2, y: box.y + 2, w: 3, h: 3 }, props.disabled ? c.dim : c.accent);
  label(ctx, props.label, { font: 'small', color: props.disabled ? c.dim : hot ? c.paper : c.text }, { x: box.x + BOX + 4, y: r.y, w: r.w - BOX - 4, h: r.h });
  return it;
}
