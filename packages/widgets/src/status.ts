// Messages: a status line, and tooltips.

import { type Context, type Rect } from '@synth-ui/core';
import { label } from './label.js';
import { useTheme } from './theme.js';

// ------------------------------------------------------------ statusLine

/** A temporary message. Pass a new object each time something's said, even the same words: that's what shows it again. */
export interface StatusMessage {
  text: string;
  /** How long this one stays, overriding the line's `duration`: Infinity for "working on it". */
  duration?: number;
}

export interface StatusLineProps {
  /** What the line says the rest of the time, plainly: the hint of what the pointer is over, say. */
  text: string;
  /** Something just happened: highlighted, over the permanent text, for `duration`. */
  message?: StatusMessage | null;
  /** How long a message stays, in ms. Default 2500; Infinity keeps it until it's replaced or cleared. */
  duration?: number;
  key?: string;
  /** Default the theme's slate. */
  color?: number;
  /** Default the theme's paper. */
  messageColor?: number;
}

/**
 * One line with two states. The permanent text sits in place, plain; a
 * message slides up from below over it, highlighted, and when its time is
 * up the permanent text slides back down. Text changing within a state just
 * swaps: a new message restarts the clock without sliding again.
 */
export function statusLine(ctx: Context, props: StatusLineProps, rect?: Rect): void {
  const { colors: c, fonts } = useTheme(ctx);
  const font = ctx.font(fonts.small);
  const b = ctx.bounds;
  const r = rect ?? ctx.place({ w: b.x + b.w - ctx.cursor.x, h: font.height + 4 });
  const id = ctx.makeKey(props.key);
  const s = ctx.state(() => ({ message: null as StatusMessage | null, since: 0, shown: '' }), { key: `${id}:state` });
  const message = props.message?.text ? props.message : null;
  if (message !== s.message) {
    s.message = message;
    s.since = ctx.time;
  }
  const live = !!s.message && ctx.time - s.since < (s.message.duration ?? props.duration ?? 2500);
  // Keep the last message's text to slide out with.
  if (live) {
    s.shown = s.message!.text;
    ctx.requestFrame();
  }
  const t = ctx.animatedValue(live ? 1 : 0, { key: `${id}:slide`, easing: 0.2, snap: 0.01 });
  if (t === 0) s.shown = '';

  ctx.allocate(
    r,
    (line) => {
      const h = r.h;
      const y = Math.round(t * h);
      label(line, props.text, { font: 'small', color: props.color ?? c.slate }, { x: 0, y: -y, w: r.w, h });
      if (s.shown) label(line, s.shown, { font: 'small', color: props.messageColor ?? c.paper }, { x: 0, y: h - y, w: r.w, h });
    },
    { clip: true },
  );
}

// ------------------------------------------------------------ tooltip

export interface TooltipProps {
  /** Default the hint of whatever the pointer is over. */
  text?: string;
  /** How long the pointer rests before it shows, in ms. Default 600. */
  delay?: number;
}

/**
 * A small box by the pointer, once it has rested on something with a hint.
 * Call it last, so it's drawn over everything; it takes no input itself.
 */
export function tooltip(ctx: Context, props: TooltipProps = {}): void {
  const { colors: c, fonts } = useTheme(ctx);
  const text = props.text ?? ctx.hint;
  const s = ctx.state(() => ({ text: '', since: 0, x: 0, y: 0, shown: false }), { key: ctx.makeKey() });
  const p = ctx.pointer;
  // Until it shows, any movement restarts the wait: the pointer has to rest.
  const moved = p.x !== s.x || p.y !== s.y;
  if (text !== s.text || ctx.pointerDown || Number.isNaN(p.x) || (!s.shown && moved)) {
    s.text = ctx.pointerDown ? '' : text;
    s.since = ctx.time;
    s.x = p.x;
    s.y = p.y;
    s.shown = false;
  }
  if (!s.text) return;
  if (ctx.time - s.since < (props.delay ?? 600)) {
    ctx.requestFrame();
    return;
  }
  s.shown = true;
  const font = ctx.font(fonts.small);
  const screen = ctx.screen;
  const w = Math.min(font.width(s.text) + 8, screen.w - 4);
  const h = font.height + 6;
  // Below and right of where the pointer came to rest, kept on screen.
  let x = Math.round(s.x) + 6;
  let y = Math.round(s.y) + 12;
  if (y + h > screen.y + screen.h - 2) y = Math.round(s.y) - h - 4;
  x = Math.max(screen.x + 2, Math.min(x, screen.x + screen.w - w - 2));
  ctx.overlay((o) => {
    const box = { x, y, w, h };
    o.fillRect(box, c.panel);
    o.strokeRect(box, c.dim);
    label(o, s.text, { font: 'small', color: c.text }, { x: x + 4, y: y + 3, w: w - 8, h: font.height });
  });
}
