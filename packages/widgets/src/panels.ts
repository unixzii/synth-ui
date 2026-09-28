// Structure: page tabs, titled cards, and a sheet that slides up over
// everything.

import { center, type Context, type Rect } from '@synth-ui/core';
import { iconButton } from './button.js';
import { ICONS } from './icons.js';
import { label } from './label.js';
import { useTheme } from './theme.js';

// ------------------------------------------------------------ tabs

export interface Tab {
  label: string;
  /** Its key, shown small before the label, e.g. 'F1'. */
  shortcut?: string;
  hint?: string;
}

export interface TabsProps {
  tabs: readonly Tab[];
  selected: number;
  key?: string;
  /** Default 12. */
  h?: number;
  /** Default 2. */
  gap?: number;
}

/** A row of tabs; the selected one's backing glides to it. Returns the tab pressed this frame, if any. */
export function tabs(ctx: Context, props: TabsProps, rect?: Rect): number | null {
  const { colors: c, fonts } = useTheme(ctx);
  const text = ctx.font(fonts.text);
  const small = ctx.font(fonts.small);
  const gap = props.gap ?? 2;
  const widths = props.tabs.map((t) => (t.shortcut ? small.width(t.shortcut) + 3 : 0) + text.width(t.label) + 10);
  const r = rect ?? ctx.place({ w: widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1), h: props.h ?? 12 });
  const xs = widths.map((_, i) => r.x + widths.slice(0, i).reduce((a, b) => a + b + gap, 0));
  const sel = Math.min(Math.max(0, props.selected), props.tabs.length - 1);
  const id = ctx.makeKey(props.key);
  const k = (part: string) => `${id}:${part}`;
  const lx = ctx.animatedValue(xs[sel], { key: k('x'), snap: 0.5, easing: 0.3 });
  const lw = ctx.animatedValue(widths[sel], { key: k('w'), snap: 0.5, easing: 0.3 });

  let picked: number | null = null;
  const its = props.tabs.map((t, i) => ctx.interaction({ x: xs[i], y: r.y, w: widths[i], h: r.h }, { key: k(String(i)), cursor: 'pointer', hint: t.hint }));
  its.forEach((it, i) => {
    if (it.hovered && i !== sel) ctx.fillRect({ x: xs[i], y: r.y, w: widths[i], h: r.h }, c.raised);
  });
  ctx.fillRect({ x: Math.round(lx), y: r.y, w: Math.round(lw), h: r.h }, c.line);
  props.tabs.forEach((t, i) => {
    const on = i === sel;
    if (its[i].pressed) picked = i;
    let x = xs[i] + 5;
    if (t.shortcut) x = ctx.text(t.shortcut, x, r.y + center(r.h, small.height), { font: small, color: on ? c.accent : c.slate }) + 2;
    ctx.text(t.label, x, r.y + center(r.h, text.height), { font: text, color: on ? c.paper : its[i].hovered ? c.text : c.muted });
  });
  return picked;
}

// ------------------------------------------------------------ card

export interface CardProps {
  title: string;
  /** Small text at the right end of the title line. */
  right?: string;
  /** Height when placed by the flow; default the rest of the region. */
  h?: number;
  /** Padding inside the frame. Default 5. */
  pad?: number;
}

/** A titled frame: a label above a one-pixel box. Returns the region inside it. */
export function card(ctx: Context, props: CardProps, rect?: Rect): Context {
  const { colors: c, fonts } = useTheme(ctx);
  const b = ctx.bounds;
  const r = rect ?? ctx.place({ w: b.x + b.w - ctx.cursor.x, h: props.h ?? b.y + b.h - ctx.cursor.y });
  const font = ctx.font(fonts.small);
  label(ctx, props.title, { font: 'small', color: c.muted }, { x: r.x, y: r.y, w: r.w - (props.right ? font.width(props.right) + 6 : 0), h: font.height });
  if (props.right) ctx.text(props.right, r.x + r.w - font.width(props.right), r.y, { font, color: c.slate });
  const top = r.y + font.height + 3;
  const frame = { x: r.x, y: top, w: r.w, h: r.y + r.h - top };
  ctx.strokeRect(frame, c.line);
  const pad = (props.pad ?? 5) + 1;
  return ctx.region({ x: frame.x + pad, y: frame.y + pad, w: Math.max(0, frame.w - pad * 2), h: Math.max(0, frame.h - pad * 2) });
}

// ------------------------------------------------------------ sheet

export interface SheetProps {
  open: boolean;
  title?: string;
  /** Default 400 (or the screen, if narrower). */
  w?: number;
  h: number;
  key?: string;
  /** How far the screen behind darkens, 0–1. Default 0.83. */
  dim?: number;
  /** The largest pixel blocks the screen behind breaks into. Default 4. */
  mosaic?: number;
  /** A close button in the header. Default true. */
  closeButton?: boolean;
}

export interface SheetResult {
  /** Asked to close: Escape, the close button, or a press outside it. */
  dismissed: boolean;
  /** How far it's slid in, 0–1. */
  shown: number;
}

/**
 * A panel that slides up from the bottom of the screen over everything,
 * which pixelates and dims behind it. While it's there, nothing under it
 * gets the pointer or the keyboard. `fn` draws its content, below the
 * header; the caller closes it by setting `open` to false.
 */
export function sheet(ctx: Context, props: SheetProps, fn: (content: Context) => void): SheetResult {
  const { colors: c } = useTheme(ctx);
  const id = ctx.makeKey(props.key);
  const k = (part: string) => `${id}:${part}`;
  const shown = ctx.animatedValue(props.open ? 1 : 0, { key: k('shown'), easing: 0.2, snap: 0.005 });
  const out: SheetResult = { dismissed: false, shown };
  if (shown === 0) return out;

  ctx.overlay(
    (o) => {
      o.captureKeyboard();
      if (props.open && o.takeKey('Escape')) out.dismissed = true;
      const screen = o.screen;
      o.mosaic(screen, Math.round(shown * (props.mosaic ?? 4)));
      o.remap(screen, o.palette.mixMap(c.void, shown * (props.dim ?? 0.83)));
      // Presses anywhere outside the panel dismiss it; nothing under the overlay sees them.
      if (o.interaction(screen, { key: k('backdrop'), hint: 'CLICK TO CLOSE (ESC)' }).pressed && props.open) out.dismissed = true;

      const w = Math.min(props.w ?? 400, screen.w);
      const panel = { x: screen.x + center(screen.w, w), y: screen.y + screen.h - Math.round(props.h * shown), w, h: props.h };
      o.interaction(panel, { key: k('panel') });
      o.fillRect(panel, c.panel);
      o.strokeRect({ ...panel, h: panel.h + 1 }, c.line);
      o.hline(panel.x, panel.y, panel.w, c.accent);

      const head = 24;
      if (props.title) label(o, props.title, { font: 'small', color: c.muted }, { x: panel.x + 10, y: panel.y, w: panel.w - 36, h: head });
      if ((props.closeButton ?? true) && iconButton(o, { icon: ICONS.close, hint: 'CLOSE (ESC)', key: k('close') }, { x: panel.x + panel.w - 23, y: panel.y + 6, w: 13, h: 12 }).clicked) {
        out.dismissed = true;
      }
      o.allocate({ x: panel.x + 10, y: panel.y + head, w: panel.w - 20, h: panel.h - head - 8 }, fn, { key: k('content') });
    },
    { key: k('overlay') },
  );
  return out;
}
