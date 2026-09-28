// Popup menus, and a dropdown built on one. A menu opens in the layer
// above, below its anchor (or above, if there's no room), and is modal while
// open: a press anywhere else dismisses it without reaching what's under it,
// and it has the keyboard — arrows, Enter, Escape. It unrolls out of its
// anchor and rolls back into it, carrying the chosen item home.

import { center, type Context, type Rect } from '@synth-ui/core';
import { ICONS } from './icons.js';
import { clickTone, useTheme } from './theme.js';

export interface MenuItem {
  label: string;
  /** Small text at the right, e.g. 'MOD+S'. */
  shortcut?: string;
  hint?: string;
  disabled?: boolean;
}

export interface MenuProps {
  items: readonly MenuItem[];
  /** What it opens from, in the caller's coordinates. */
  anchor: Rect;
  open: boolean;
  /** The item shown as current, in the accent. */
  selected?: number;
  key?: string;
  /** At least this wide. Default the anchor's width. */
  w?: number;
}

export interface MenuResult {
  /** The item chosen this frame, if any. */
  picked: number | null;
  /** Asked to close without choosing: Escape, or a press outside. */
  dismissed: boolean;
}

const ITEM_H = 12;

/** A popup of items at `anchor`, drawn while `open` (and while it rolls shut). Returns the item picked, or that it was dismissed; the caller then closes it. */
export function menu(ctx: Context, props: MenuProps): MenuResult {
  const { colors: c, fonts } = useTheme(ctx);
  const id = ctx.makeKey(props.key);
  const k = (part: string) => `${id}:${part}`;
  // `leaving`: the item that rides the closing panel back into its anchor.
  const s = ctx.state(() => ({ active: -1, opened: false, leaving: -1 }), { key: k('state') });
  const out: MenuResult = { picked: null, dismissed: false };
  const { items, open } = props;
  if (open && !s.opened) {
    s.active = props.selected ?? -1;
    s.leaving = -1;
  }
  if (!open && s.opened && s.leaving < 0) s.leaving = props.selected ?? -1;
  s.opened = open;
  // Opening, it unrolls away from its anchor; closing, it rolls back up into it.
  const reveal = ctx.animatedValue(open ? 1 : 0, { key: k('reveal'), from: 0, easing: 0.18, snap: 0.005 });
  if (reveal === 0) return out;

  ctx.overlay(
    (o) => {
      const small = o.font(fonts.small);
      const text = o.font(fonts.text);
      const natural = Math.max(...items.map((it) => text.width(it.label) + (it.shortcut ? small.width(it.shortcut) + 12 : 0))) + 12;
      const w = Math.max(props.w ?? props.anchor.w, natural);
      const h = items.length * ITEM_H + 4;
      const screen = o.screen;
      const a = props.anchor;
      const below = a.y + a.h + 1;
      const down = below + h <= screen.y + screen.h;
      const y = down ? below : a.y - h - 1;
      const x = Math.max(screen.x, Math.min(a.x, screen.x + screen.w - w));
      const panel = { x, y, w, h };

      if (open) {
        o.captureKeyboard();
        // Keys: move through the enabled items, pick, or close.
        const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
        const step = (by: number) => {
          if (!enabled.length) return;
          const at = enabled.indexOf(s.active);
          s.active = enabled[at < 0 ? (by > 0 ? 0 : enabled.length - 1) : (at + by + enabled.length) % enabled.length];
        };
        if (o.takeKey('ArrowDown')) step(1);
        if (o.takeKey('ArrowUp')) step(-1);
        if (o.takeKey('Enter') && s.active >= 0) out.picked = s.active;
        if (o.takeKey('Escape')) out.dismissed = true;
        if (o.interaction(screen, { key: k('backdrop') }).pressed) out.dismissed = true;
        o.interaction(panel, { key: k('panel') });
      }

      // The items stay put on screen while the far edge sweeps over them.
      const shown = Math.max(1, Math.round(h * reveal));
      o.allocate(
        { x, y: down ? y : y + h - shown, w, h: shown },
        (m) => {
          m.fillRect(m.bounds, c.panel);
          const oy = down ? 0 : shown - h;
          const item = (i: number, top: number, on: boolean) => {
            const it = items[i];
            if (on) m.fillRect({ x: 1, y: top, w: w - 2, h: ITEM_H }, c.line);
            const color = it.disabled ? c.dim : i === props.selected ? c.accent : on ? c.paper : c.text;
            m.text(it.label, 6, top + center(ITEM_H, text.height), { font: text, color });
            if (it.shortcut) m.text(it.shortcut, w - 6 - small.width(it.shortcut), top + center(ITEM_H, small.height), { font: small, color: c.slate });
          };
          // Closing, the leaving item is pushed along by the edge coming in, over the others, into the anchor.
          const leaving = !open && s.leaving >= 0 && s.leaving < items.length;
          const last = shown - ITEM_H - 2;
          const from = oy + 2 + s.leaving * ITEM_H;
          const at = down ? Math.max(2, Math.min(from, last)) : Math.min(last, Math.max(from, 2));
          items.forEach((it, i) => {
            const top = oy + 2 + i * ITEM_H;
            if (!open) {
              // What it has swept past is gone.
              const passed = leaving && (down ? top > at : top < at);
              if (i !== s.leaving && !passed) item(i, top, false);
              return;
            }
            const r = { x: 0, y: top, w, h: ITEM_H };
            const ii = m.interaction(r, { key: k(`item${i}`), click: !it.disabled, cursor: it.disabled ? undefined : 'pointer', hint: it.hint });
            if (ii.hovered && !it.disabled) s.active = i;
            if (ii.clicked && !it.disabled) out.picked = i;
            item(i, top, i === s.active && !it.disabled);
          });
          if (out.picked !== null) s.leaving = out.picked;
          if (leaving) item(s.leaving, at, true);
          m.strokeRect(m.bounds, c.dim);
        },
        { clip: true },
      );
    },
    { key: k('overlay') },
  );
  return out;
}

// ------------------------------------------------------------ dropdown

export interface DropdownOption<T> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export interface DropdownProps<T> {
  options: readonly DropdownOption<T>[];
  /** The current choice. Null for none: the placeholder shows, and any pick counts, e.g. a menu of things to add. */
  value: T | null;
  /** Shown, dimmer, when there's no value. */
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
  key?: string;
  /** Default 13. */
  h?: number;
}

/** A button showing the current choice; press it for a menu of the others. Returns the value chosen this frame, if it's a change. */
export function dropdown<T>(ctx: Context, props: DropdownProps<T>, rect?: Rect): T | null {
  const theme = useTheme(ctx);
  const { colors: c, fonts } = theme;
  const font = ctx.font(fonts.text);
  const id = ctx.makeKey(props.key);
  const k = (part: string) => `${id}:${part}`;
  const s = ctx.state(() => ({ open: false }), { key: k('state') });
  const current = props.options.findIndex((o) => o.value === props.value);
  const r = rect ?? ctx.place({ w: Math.max(...[...props.options.map((o) => o.label), props.placeholder ?? ''].map((l) => font.width(l))) + 8 + 12, h: props.h ?? 13 });

  const it = ctx.interaction(r, { key: k('button'), click: !props.disabled, cursor: props.disabled ? undefined : 'pointer', hint: props.disabled ? undefined : props.hint });
  if (props.disabled) {
    s.open = false;
    ctx.strokeRect(r, c.control);
    ctx.text(props.options[current]?.label ?? props.placeholder ?? '', r.x + 4, r.y + center(r.h, font.height), { font, color: c.dim });
    ctx.bitmap(ICONS.down, r.x + r.w - 9, r.y + center(r.h, ICONS.down.h), c.line);
    menu(ctx, { items: props.options, anchor: r, open: false, key: k('menu') });
    return null;
  }
  if (it.pressed) s.open = !s.open;
  const hot = it.hovered || s.open;
  // Pressed, it sinks a pixel; the menu still opens from where it rests.
  const b = { ...r, y: r.y + (it.held ? 1 : 0) };
  ctx.fillRect(b, hot ? c.line : c.control);
  ctx.strokeRect(b, s.open ? c.accent : hot ? c.dim : c.border);
  const shown = props.options[current]?.label;
  // Open reads as pressed.
  const tone = clickTone(theme, { hovered: it.hovered, held: it.held || s.open }, shown === undefined ? c.muted : undefined);
  ctx.text(shown ?? props.placeholder ?? '', b.x + 4, b.y + center(b.h, font.height), { font, color: tone });
  ctx.bitmap(ICONS.down, b.x + b.w - 9, b.y + center(b.h, ICONS.down.h), s.open ? c.accent : c.muted);

  const res = menu(ctx, { items: props.options, anchor: r, open: s.open, selected: current < 0 ? undefined : current, key: k('menu') });
  if (res.dismissed) s.open = false;
  if (res.picked !== null) {
    s.open = false;
    const picked = props.options[res.picked].value;
    return picked === props.value ? null : picked;
  }
  return null;
}
