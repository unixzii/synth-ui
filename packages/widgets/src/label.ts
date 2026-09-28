// A line of text. Given a rect, it's cut to fit the width and centred
// vertically; without one, it takes its natural size from the flow.

import { type Context, type Rect } from '@synth-ui/core';
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
  const font = t.fonts[name as keyof typeof t.fonts] ?? name;
  const scale = props.scale ?? 1;
  const r = rect ?? ctx.place({ w: ctx.measureText(text, { font, scale }), h: ctx.fontMetrics(font).height * scale });
  const layout = ctx.layoutText(text, { font, scale, color: props.color ?? t.colors.text, width: r.w, height: r.h, overflow: 'clip', align: props.align, valign: 'middle' });
  ctx.drawText(layout, r.x, r.y);
  return r;
}
