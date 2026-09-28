// A list of rows, drawn only as far as they show: a scroll view whose
// content is `count` rows of one height, where each frame just the rows in
// view are drawn (and register their interactions), so a list of thousands
// costs what a screenful does. It scrolls a row at a time, gliding; follows
// the selection into view; and takes the arrow keys while it has focus.

import type { Context, Interaction, Rect } from '@synth-ui/core';
import { scrollView, type ScrollProps } from './scroll.js';
import { useTheme } from './theme.js';

export interface ListProps extends Pick<ScrollProps, 'scrollbar' | 'fade' | 'fadeTo'> {
  count: number;
  rowHeight: number;
  /** The selected row, or -1. The list scrolls to it when it changes. */
  selected?: number;
  /** A global key for the list's state (scroll, rows). */
  key?: string;
  /**
   * A row's identity, so its state follows it when rows move (default: its
   * index). Only rows in view are drawn, so row state lives while in view.
   */
  rowKey?: (index: number) => string | number;
  /** Arrow keys, Home, End and Page Up/Down move the selection, Enter activates it, while the list has focus. Default true. */
  keyboard?: boolean;
  /** Scroll by whole rows. Default true. */
  snap?: boolean;
  /** A line above each row. */
  separators?: boolean;
  hint?: (index: number) => string | undefined;
}

export interface ListRow {
  index: number;
  selected: boolean;
  /** The pointer is on the row (even on a button in it). */
  hovered: boolean;
  /** The list has keyboard focus. */
  focused: boolean;
  /** The row's own interaction; anything drawn in the row after it is on top of it. */
  it: Interaction;
}

export interface ListResult {
  /** The selection the user asked for this frame: a row pressed, or the keys. */
  select: number | null;
  /** A row clicked. */
  clicked: number | null;
  /** A row double-clicked, or Enter on the selection. */
  activate: number | null;
  focused: boolean;
}

/**
 * Draw a list, filling `rect` or the rest of the region. `row` draws one
 * row's content into a region the row's size; the list has already drawn its
 * selected or hovered background.
 */
export function list(ctx: Context, props: ListProps, row: (ctx: Context, row: ListRow) => void, rect?: Rect): ListResult {
  const { colors: c } = useTheme(ctx);
  const b = ctx.bounds;
  const r = rect ?? ctx.place({ w: b.x + b.w - ctx.cursor.x, h: b.y + b.h - ctx.cursor.y });
  const { count, rowHeight: rh } = props;
  const selected = props.selected ?? -1;
  const keyboard = props.keyboard ?? true;
  const id = ctx.makeKey(props.key);
  const s = ctx.state(() => ({ followed: -2 }), { key: `${id}:state` });

  // The list itself: under the rows, so they take presses, but it takes the focus.
  const self = ctx.interaction(r, { key: `${id}:list`, click: false, focusable: keyboard });
  const out: ListResult = { select: null, clicked: null, activate: null, focused: self.focused };

  if (self.focused && count > 0) {
    const page = Math.max(1, Math.floor(r.h / rh) - 1);
    const moves: [string, number][] = [
      ['ArrowUp', selected < 0 ? count - 1 : selected - 1],
      ['ArrowDown', selected + 1],
      ['Home', 0],
      ['End', count - 1],
      ['PageUp', selected - page],
      ['PageDown', selected + page],
    ];
    for (const [key, to] of moves) if (ctx.takeKey(key)) out.select = Math.min(count - 1, Math.max(0, to));
    if (selected >= 0 && ctx.takeKey('Enter')) out.activate = selected;
  }

  const follow = out.select ?? selected;
  const rowId = (i: number) => `${id}#${props.rowKey ? props.rowKey(i) : i}`;
  scrollView(
    ctx,
    { key: `${id}:scroll`, content: { h: count * rh }, snap: props.snap === false ? 0 : rh, scrollbar: props.scrollbar, fade: props.fade, fadeTo: props.fadeTo },
    (content, scroll) => {
      if (follow !== s.followed) {
        s.followed = follow;
        if (follow >= 0) scroll.reveal({ x: 0, y: follow * rh, w: 1, h: rh });
      }
      // Only the rows in view.
      const first = Math.max(0, Math.floor(scroll.y / rh));
      const last = Math.min(count - 1, Math.floor((scroll.y + scroll.viewport.h - 1) / rh));
      const w = content.bounds.w;
      for (let i = first; i <= last; i++) {
        content.allocate(
          { x: 0, y: i * rh, w, h: rh },
          (rc) => {
            const box = { x: 0, y: 0, w, h: rh };
            const it = rc.interaction(box, { cursor: 'pointer', hint: props.hint?.(i) });
            const on = i === (out.select ?? selected);
            const hovered = rc.containsPointer(box);
            if (on) rc.fillRect(box, c.line);
            else if (hovered) rc.fillRect(box, c.raised);
            // Centred in what the separator leaves of the row.
            const top = props.separators ? 1 : 0;
            if (on && self.focused) rc.fillRect({ x: 0, y: top + 2, w: 2, h: rh - top - 4 }, c.accent);
            if (props.separators) rc.hline(0, 0, w, c.line);
            row(rc, { index: i, selected: on, hovered, focused: self.focused, it });
            if (it.pressed) out.select = i;
            if (it.clicked) out.clicked = i;
            if (it.doubleClicked) out.activate = i;
          },
          { key: rowId(i) },
        );
      }
    },
    r,
  );
  return out;
}
