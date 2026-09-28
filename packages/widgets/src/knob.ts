// Continuous values: a knob (a dark dial with an accent pointer inside a
// ring of LEDs that light up to the value) and a slider. Both report the
// new value while they're being changed, else null; the caller stores it.

import { type Context, type Rect, type Size } from '@synth-ui/core';
import { useTheme } from './theme.js';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ------------------------------------------------------------ knob

const KNOB_R = 7;
/** The LED ring: this many dots over a 270° sweep. */
const LEDS = 11;
const LED_R = 10;
export const KNOB_SIZE = LED_R * 2 + 1;
/** Vertical drag, in pixels, that turns a knob end to end. */
export const KNOB_TRAVEL = 90;

export interface KnobProps {
  label: string;
  /** Position 0–1. */
  value: number;
  /** The value as it should read, e.g. "1.2K". */
  text: string;
  /** Double-click resets to this. */
  reset?: number;
  /** Lights outwards from the top, for values either side of a centre. */
  bipolar?: boolean;
  /** Snap to this many steps across the range (e.g. 48 for ±24 semitones). */
  steps?: number;
  hint?: string;
  key?: string;
}

/** Dial, label and value. */
export function knobSize(): Size {
  return { w: 38, h: KNOB_SIZE + 3 + 5 * 2 + 3 };
}

/** Draw just the dial, centred on (cx, cy), for custom layouts. `held`: being turned, its pointer white. */
export function drawKnob(ctx: Context, cx: number, cy: number, value: number, hot: boolean, bipolar = false, held = false): void {
  const { colors: c } = useTheme(ctx);
  ctx.fillCircle(cx, cy, KNOB_R, hot ? c.line : c.control);
  ctx.circle(cx, cy, KNOB_R, hot ? c.dim : c.border);
  const lit = Math.round(value * (LEDS - 1));
  const mid = (LEDS - 1) / 2;
  for (let i = 0; i < LEDS; i++) {
    const a = ((-135 + (i / (LEDS - 1)) * 270) * Math.PI) / 180;
    const on = bipolar ? (i - mid) * (lit - mid) >= 0 && Math.abs(i - mid) <= Math.abs(lit - mid) && lit !== mid : i <= lit && value > 0;
    ctx.pixel(Math.round(cx + LED_R * Math.sin(a)), Math.round(cy - LED_R * Math.cos(a)), on ? (i === lit ? c.flame : c.accent) : bipolar && i === mid ? c.dim : c.border);
  }
  const a = ((-135 + value * 270) * Math.PI) / 180;
  ctx.line(cx, cy, cx + (KNOB_R - 2) * Math.sin(a), cy - (KNOB_R - 2) * Math.cos(a), held ? c.white : hot ? c.flame : c.accent);
}

/**
 * A labelled knob, its dial centred at the top of the rect. Drag up and
 * down (Shift for fine), scroll, or double-click to reset.
 */
export function knob(ctx: Context, props: KnobProps, rect?: Rect): number | null {
  const { colors: c, fonts } = useTheme(ctx);
  const r = rect ?? ctx.place(knobSize());
  const cx = r.x + Math.floor(r.w / 2);
  const dial = { x: cx - Math.floor(KNOB_SIZE / 2) - 2, y: r.y - 2, w: KNOB_SIZE + 4, h: KNOB_SIZE + 4 };
  const id = ctx.makeKey(props.key);
  const it = ctx.interaction(dial, { key: `${id}:dial`, wheel: true, cursor: 'ns-resize', hint: props.hint ?? `${props.label}: DRAG, SCROLL, DOUBLE-CLICK TO RESET` });
  const drag = ctx.state(() => ({ from: 0 }), { key: `${id}:drag` });

  let next: number | null = null;
  if (it.pressed) drag.from = props.value;
  // Released counts too: the last of a quick drag can arrive with the release.
  if (it.held || it.released) next = drag.from - (it.dy / KNOB_TRAVEL) * (ctx.mods.shift ? 0.2 : 1);
  // The press that double-clicks goes on turning from the reset value, not the old one.
  if (it.doubleClicked && props.reset !== undefined) next = drag.from = props.reset;
  if (props.steps) {
    const n = ctx.wheelSteps(it, 40);
    if (n) next = props.value - n / props.steps;
  } else if (it.wheelY) next = props.value - it.wheelY * 0.0015;
  if (next !== null) {
    next = clamp(next, 0, 1);
    if (props.steps) next = Math.round(next * props.steps) / props.steps;
    if (Math.abs(next - props.value) < 1e-9) next = null;
  }

  const hot = it.hovered || it.held;
  drawKnob(ctx, cx, r.y + Math.floor(KNOB_SIZE / 2), props.value, hot, props.bipolar, it.held);
  const font = ctx.font(fonts.small);
  const ly = r.y + KNOB_SIZE + 3;
  ctx.text(props.label, r.x + Math.floor((r.w - font.width(props.label)) / 2), ly, { font, color: hot ? c.accent : c.text });
  ctx.text(props.text, r.x + Math.floor((r.w - font.width(props.text)) / 2), ly + font.height + 3, { font, color: c.muted });
  return next;
}

// ------------------------------------------------------------ slider

export interface SliderProps {
  value: number;
  /** Default 0–1. */
  min?: number;
  max?: number;
  /** Snap to multiples of this (from `min`). */
  step?: number;
  vertical?: boolean;
  /** Fill from the middle, for values either side of a centre. */
  bipolar?: boolean;
  /** Double-click resets to this. */
  reset?: number;
  hint?: string;
  key?: string;
}

/**
 * A track with a thumb. Press anywhere on it to jump there and drag;
 * scroll to step; double-click to reset.
 */
export function slider(ctx: Context, props: SliderProps, rect?: Rect): number | null {
  const { colors: c } = useTheme(ctx);
  const min = props.min ?? 0;
  const max = props.max ?? 1;
  const vertical = !!props.vertical;
  const r = rect ?? ctx.place(vertical ? { w: 9, h: 60 } : { w: 80, h: 9 });
  const id = ctx.makeKey(props.key);
  const it = ctx.interaction(r, { key: `${id}:track`, wheel: true, cursor: vertical ? 'ns-resize' : 'ew-resize', hint: props.hint });
  // After a double-click resets it, that press doesn't drag until it's let go.
  const s = ctx.state(() => ({ resetting: false }), { key: `${id}:reset` });
  if (it.doubleClicked && props.reset !== undefined) s.resetting = true;

  // Along the track, in pixels from its start (the bottom, when vertical), and back.
  const len = (vertical ? r.h : r.w) - 3;
  const t = (clamp(props.value, min, max) - min) / (max - min || 1);
  const along = (v: number) => Math.round(v * len);
  let next: number | null = null;
  if ((it.held || it.pressed || it.released) && !s.resetting) {
    const p = ctx.pointer;
    const pos = vertical ? r.y + r.h - 2 - p.y : p.x - r.x - 1;
    next = min + clamp(pos / len, 0, 1) * (max - min);
  }
  const unit = props.step ?? (max - min) / 50;
  // Scrolling down lowers it, like a knob; sideways, right raises it.
  const n = (vertical ? 0 : ctx.wheelSteps(it, 30, 'x')) - ctx.wheelSteps(it, 30, 'y');
  if (n) next = props.value + n * unit;
  if (it.doubleClicked && props.reset !== undefined) next = props.reset;
  if (!it.held) s.resetting = false;
  if (next !== null) {
    if (props.step) next = min + Math.round((next - min) / props.step) * props.step;
    next = clamp(next, min, max);
    if (Math.abs(next - props.value) < 1e-9) next = null;
  }

  const hot = it.hovered || it.held;
  const from = props.bipolar ? along(0.5) : 0;
  const to = along(t);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  if (vertical) {
    const cx = r.x + Math.floor(r.w / 2);
    const base = r.y + r.h - 2;
    ctx.vline(cx - 1, r.y + 1, r.h - 2, c.control);
    ctx.vline(cx + 1, r.y + 1, r.h - 2, c.control);
    ctx.vline(cx, r.y + 1, r.h - 2, c.border);
    ctx.fillRect({ x: cx - 1, y: base - hi, w: 3, h: hi - lo + 1 }, it.held ? c.accent : c.rust);
    ctx.fillRect({ x: r.x, y: base - to - 1, w: r.w, h: 3 }, hot ? c.white : c.paper);
  } else {
    const cy = r.y + Math.floor(r.h / 2);
    const base = r.x + 1;
    ctx.hline(r.x + 1, cy - 1, r.w - 2, c.control);
    ctx.hline(r.x + 1, cy + 1, r.w - 2, c.control);
    ctx.hline(r.x + 1, cy, r.w - 2, c.border);
    ctx.fillRect({ x: base + lo, y: cy - 1, w: hi - lo + 1, h: 3 }, it.held ? c.accent : c.rust);
    ctx.fillRect({ x: r.x + to, y: r.y, w: 3, h: r.h }, hot ? c.white : c.paper);
  }
  return next;
}
