// A line of text. Given a rect, it's cut to fit the width and centred
// vertically; without one, it takes its natural size from the flow.

import { truncate, type Context, type Rect } from '@synth-ui/core';
import { useTheme } from './theme.js';

export interface LabelProps {
  /** Palette index. Default: the theme's text colour. */
  color?: number;
  /** 'text' (5×7) or 'small', from the theme, or a registered font name. Default 'text'. */
  font?: 'text' | 'small' | (string & {});
  scale?: number;
  align?: 'left' | 'center' | 'right';
}

/** Draws `text` in `rect`, or at its natural size from the flow. Returns the rect it used. */
export function label(ctx: Context, text: string, props: LabelProps = {}, rect?: Rect): Rect {
  const t = useTheme(ctx);
  const name = props.font ?? 'text';
  const font = ctx.font(t.fonts[name as keyof typeof t.fonts] ?? name);
  const scale = props.scale ?? 1;
  const r = rect ?? ctx.place({ w: font.width(text, scale), h: font.height * scale });
  const shown = truncate(font, text, r.w, scale);
  const w = font.width(shown, scale);
  const x = props.align === 'center' ? r.x + Math.floor((r.w - w) / 2) : props.align === 'right' ? r.x + r.w - w : r.x;
  ctx.text(shown, x, r.y + Math.floor((r.h - font.height * scale) / 2), { font, scale, color: props.color ?? t.colors.text });
  return r;
}
