// Buttons: a small outlined label (lit with the accent when `on`), and a
// borderless icon that lights up under the pointer. Each takes a rect, or
// without one takes its natural size from the region's flow.

import { centerIn, type Bitmap, type Context, type Interaction, type Rect, type Size } from '@synth-ui/core';
import { useTheme } from './theme.js';

export interface ButtonProps {
  label: string;
  /** Lit: a toggle that's on, or the chosen one of a set. */
  on?: boolean;
  disabled?: boolean;
  hint?: string;
  key?: string;
  /** Space either side of the label. Default 4. */
  pad?: number;
  /** Default 11. */
  h?: number;
}

export function buttonSize(ctx: Context, props: Pick<ButtonProps, 'label' | 'pad' | 'h'>): Size {
  return { w: ctx.measureText(props.label, { font: useTheme(ctx).fonts.small }) + (props.pad ?? 4) * 2 + 2, h: props.h ?? 11 };
}

/** A small outlined label, lit with the accent when `on`; pressed, it sinks a pixel. Returns its interaction: check `clicked`. */
export function button(ctx: Context, props: ButtonProps, rect?: Rect): Interaction {
  const { colors: c, fonts } = useTheme(ctx);
  const r = rect ?? ctx.place(buttonSize(ctx, props));
  const it = ctx.interaction(r, { key: props.key, click: !props.disabled, cursor: props.disabled ? undefined : 'pointer', hint: props.disabled ? undefined : props.hint });
  const font = fonts.small;
  const at = centerIn(r, { w: ctx.measureText(props.label, { font }), h: ctx.fontMetrics(font).height });
  if (props.disabled) {
    ctx.strokeRect(r, c.control);
    ctx.text(props.label, at.x, at.y, { font, color: c.dim });
    return it;
  }
  // Pressed, the whole button sinks a pixel.
  const d = it.held ? 1 : 0;
  const b = { ...r, y: r.y + d };
  if (props.on) ctx.fillRect(b, c.accent);
  else {
    if (it.hovered) ctx.fillRect(b, c.raised);
    ctx.strokeRect(b, it.hovered ? c.dim : c.border);
  }
  ctx.text(props.label, at.x, at.y + d, { font, color: props.on ? c.bg : it.hovered ? c.paper : c.text });
  return it;
}

export interface IconButtonProps {
  icon: Bitmap;
  /** Shown in the accent. */
  on?: boolean;
  disabled?: boolean;
  hint?: string;
  key?: string;
  /** The icon's colour at rest. Default: muted. */
  idle?: number;
}

export const iconButtonSize = (props: Pick<IconButtonProps, 'icon'>): Size => ({ w: props.icon.w + 6, h: props.icon.h + 5 });

/** A borderless icon that lights up under the pointer, in the accent when `on`. Returns its interaction: check `clicked`. */
export function iconButton(ctx: Context, props: IconButtonProps, rect?: Rect): Interaction {
  const { colors: c } = useTheme(ctx);
  const r = rect ?? ctx.place(iconButtonSize(props));
  const it = ctx.interaction(r, { key: props.key, click: !props.disabled, cursor: props.disabled ? undefined : 'pointer', hint: props.disabled ? undefined : props.hint });
  if (it.hovered && !props.disabled) ctx.fillRect(r, c.control);
  const color = props.disabled ? c.line : props.on ? c.accent : it.hovered ? c.paper : (props.idle ?? c.muted);
  const at = centerIn(r, { w: props.icon.w, h: props.icon.h });
  ctx.bitmap(props.icon, at.x, at.y + (it.held ? 1 : 0), color);
  return it;
}
