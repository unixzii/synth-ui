// Values you step or scrub: ‹ value › with arrows either side, and a bare
// number you drag or scroll.

import { centerIn, HALF, type Context, type Interaction, type Rect } from '@synth-ui/core';
import { iconButton } from './button.js';
import { ICONS } from './icons.js';
import { clickTone, useTheme } from './theme.js';

// ------------------------------------------------------------ stepper

export interface StepperProps {
  /** What's chosen, as it should read. */
  text: string;
  /** A small square of this colour before the text. */
  swatch?: number;
  /** The text's colour at rest. Default the text colour; lighter under the pointer, the accent while pressed. */
  color?: number;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  hint?: string;
  prevHint?: string;
  nextHint?: string;
  /** The value takes clicks (say, to open what it names): a pointer cursor. Else it's for scrolling. */
  clickable?: boolean;
  key?: string;
  /** Default 13. */
  h?: number;
}

export interface StepperResult {
  /** Steps asked for this frame: −1 or 1 from an arrow, or whole wheel notches over the value (down is forward). */
  step: number;
  /** The value's own interaction, for clicks. */
  value: Interaction;
}

/** ‹ ■ VALUE ›: step through choices with the arrows, or scroll over the value. */
export function stepper(ctx: Context, props: StepperProps, rect?: Rect): StepperResult {
  const theme = useTheme(ctx);
  const { colors: c, fonts } = theme;
  const font = fonts.text;
  const h = props.h ?? 13;
  const r = rect ?? ctx.place({ w: 11 + 1 + (props.swatch !== undefined ? 9 : 0) + ctx.measureText(props.text, { font }) + 8 + 1 + 11, h });
  const id = ctx.makeKey(props.key);
  const k = (part: string) => `${id}:${part}`;
  const prev = { x: r.x, y: r.y, w: 11, h: r.h };
  const next = { x: r.x + r.w - 11, y: r.y, w: 11, h: r.h };
  const box = { x: prev.x + prev.w + 1, y: r.y, w: r.w - prev.w - next.w - 2, h: r.h };

  let step = 0;
  if (iconButton(ctx, { icon: ICONS.left, disabled: props.prevDisabled, hint: props.prevHint, key: k('prev') }, prev).clicked) step--;
  const value = ctx.interaction(box, { key: k('value'), wheel: true, cursor: props.clickable ? 'pointer' : 'ns-resize', hint: props.hint });
  step += ctx.wheelSteps(value, 40);
  if (iconButton(ctx, { icon: ICONS.right, disabled: props.nextDisabled, hint: props.nextHint, key: k('next') }, next).clicked) step++;
  if ((step < 0 && props.prevDisabled) || (step > 0 && props.nextDisabled)) step = 0;

  ctx.fillRect(box, value.hovered ? c.line : c.control);
  let x = box.x + 4;
  if (props.swatch !== undefined) {
    ctx.fillRect({ x, y: box.y + Math.floor((box.h - 5) / 2), w: 5, h: 5 }, props.swatch);
    x += 9;
  }
  const color = clickTone(theme, value, props.color);
  ctx.drawText(ctx.layoutText(props.text, { font, color, width: box.x + box.w - 4 - x, height: box.h, overflow: 'clip', valign: 'middle' }), x, box.y);
  return { step, value };
}

// ------------------------------------------------------------ scrubValue

export interface ScrubValueProps {
  value: number;
  min?: number;
  max?: number;
  /** Default 1. */
  step?: number;
  /** As it should read; default the number. */
  text?: string;
  /**
   * 'underline' (default): small text over a dotted line, dragged up and
   * down or scrolled. 'outline': the value in the 5×7, outlined under the
   * pointer, scrolled only.
   */
  look?: 'underline' | 'outline';
  /** Pixels of vertical drag per step. Default 2; 0 turns dragging off. */
  dragPixels?: number;
  /** Wheel travel per step. Default 30. */
  wheelUnit?: number;
  hint?: string;
  key?: string;
}

/** A number changed by dragging up and down or scrolling: up raises it. Returns the new value while it changes. */
export function scrubValue(ctx: Context, props: ScrubValueProps, rect?: Rect): number | null {
  const { colors: c, fonts } = useTheme(ctx);
  const outline = props.look === 'outline';
  const font = outline ? fonts.text : fonts.small;
  const text = props.text ?? String(props.value);
  const size = { w: ctx.measureText(text, { font }), h: ctx.fontMetrics(font).height };
  const r = rect ?? ctx.place(outline ? { w: size.w + 8, h: size.h + 4 } : { w: size.w + 2, h: size.h + 5 });
  const dragPixels = props.dragPixels ?? (outline ? 0 : 2);
  const id = ctx.makeKey(props.key);
  const it = ctx.interaction(r, { key: `${id}:it`, click: dragPixels > 0, wheel: true, cursor: 'ns-resize', hint: props.hint });
  const drag = ctx.state(() => ({ from: 0 }), { key: `${id}:drag` });
  const step = props.step ?? 1;

  let next: number | null = null;
  if (it.pressed) drag.from = props.value;
  // Released counts too: the last of a quick drag can arrive with the release.
  if ((it.held || it.released) && dragPixels > 0) next = drag.from + Math.round(-it.dy / dragPixels) * step;
  const n = ctx.wheelSteps(it, props.wheelUnit ?? 30);
  if (n) next = props.value - n * step;
  if (next !== null) {
    next = Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, next));
    if (next === props.value) next = null;
  }

  const hot = it.hovered || it.held;
  if (outline) {
    if (hot) ctx.strokeRect(r, c.paper);
    const at = centerIn(r, size);
    ctx.text(text, at.x, at.y, { font, color: c.paper });
  } else {
    ctx.text(text, r.x + 1, r.y + 2, { font, color: hot ? c.paper : c.text });
    ctx.hline(r.x + 1, r.y + 2 + size.h + 1, r.w - 2, hot ? c.accent : c.dim, { pattern: HALF });
  }
  return next;
}
