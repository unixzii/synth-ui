// An editable line (or a few wrapped lines) of pixel text. The field does
// all of its own editing — caret, selection by pointer and keys, words,
// undo and redo, the clipboard, input-method composition — and takes typed
// text from the core's text input events, never from a platform text box.
// The app keeps the value; while it's being edited, the field keeps the
// text in progress, and hands it back when editing ends with Enter or by
// moving the focus away. Escape puts the value back.

import { type AttributedText, type Context, type Interaction, type Rect, type TextLayout, type TextRange } from '@synth-ui/core';
import { History, erase, hasSelection, insert, moveTo, selEnd, selStart, selected, step, wordAt, wordLeft, wordRight, type Edit } from './textedit.js';
import { useTheme } from './theme.js';

export interface TextFieldProps {
  /** The value, as the app has it. */
  value: string;
  key?: string;
  placeholder?: string;
  maxLength?: number;
  hint?: string;
  /**
   * Type sizes to try, largest first, each with how many lines it may wrap
   * to. Default [[1, 1]]: one line at scale 1, scrolling sideways when long.
   */
  sizes?: readonly (readonly [scale: number, lines: number])[];
  /** 'text' (default) or 'small' from the theme, or a registered font name. */
  font?: 'text' | 'small' | (string & {});
  /** Rework typed or pasted text before it goes in: uppercase it, keep only digits. */
  filter?: (text: string) => string;
  /** Width when placed by the flow; default the rest of the region. */
  w?: number;
}

export interface TextFieldResult {
  it: Interaction;
  editing: boolean;
  /** The text as shown: the edit in progress, else the value. */
  text: string;
  /** The edit in progress changed this frame. */
  changed: boolean;
  /** Editing ended with a new text (Enter, or the focus moved away): store it. */
  committed: string | null;
  /** Escape: editing ended and the value stays. */
  cancelled: boolean;
}

interface Fit {
  layout: TextLayout;
  /** One line that scrolls sideways, rather than wrapping. */
  single: boolean;
}

const BLINK_MS = 530;

/** An editable field for `value`. Returns the text shown and what happened to it; store `committed` when it's set. */
export function textField(ctx: Context, props: TextFieldProps, rect?: Rect): TextFieldResult {
  const { colors: c, fonts } = useTheme(ctx);
  const name = props.font ?? 'text';
  const font = fonts[name as keyof typeof fonts] ?? name;
  const sizes = props.sizes ?? [[1, 1]];
  const id = ctx.makeKey(props.key);
  const s = ctx.state(
    () => ({
      editing: false,
      edit: { text: '', anchor: 0, focus: 0 } as Edit,
      history: new History(),
      composing: '',
      blink: 0,
      scrollX: 0,
      caret: { x: 0, y: 0, w: 1, h: 1 } as Rect,
      /** What the press that's held picked, which a drag extends: characters, a word (and which), or everything. */
      picked: { unit: 'char', from: 0, to: 0 } as { unit: 'char' | 'word' | 'all'; from: number; to: number },
    }),
    { key: `${id}:state` },
  );

  // Where it goes: the layout of what it shows now decides its height.
  const shown = () => (s.editing ? display(s.edit, s.composing) : { text: props.value, compA: -1, compB: -1, caret: -1 });
  const b = ctx.bounds;
  const outerW = rect?.w ?? props.w ?? b.x + b.w - ctx.cursor.x;
  let lay = fit(ctx, shown().text, outerW - 4, sizes, { font });
  const lineH = (f: Fit) => ctx.fontMetrics(font).height * f.layout.scale + f.layout.scale + 1;
  const r = rect ?? ctx.place({ w: outerW, h: lay.layout.lines.length * lineH(lay) + 3 });
  const it = ctx.interaction(r, { key: `${id}:it`, focusable: true, text: true, cursor: 'text', hint: props.hint });
  const out: TextFieldResult = { it, editing: false, text: props.value, changed: false, committed: null, cancelled: false };

  const end = (commit: boolean) => {
    if (commit && s.edit.text !== props.value) out.committed = s.edit.text;
    if (!commit) out.cancelled = true;
    s.editing = false;
    s.composing = '';
    s.scrollX = 0;
  };

  // Focus in and out of editing.
  const wasEditing = s.editing;
  if (it.focused && !s.editing) {
    s.editing = true;
    s.history = new History();
    s.composing = '';
    s.scrollX = 0;
    // Tabbed (or focused by the app): everything selected. Clicked: the caret goes where the click was, below.
    s.edit = { text: props.value, anchor: 0, focus: props.value.length };
    s.blink = ctx.time;
  } else if (!it.focused && s.editing) end(true);

  if (s.editing) {
    const before = s.edit;
    const tx = r.x + 2 - s.scrollX;
    const ty = r.y + 2;
    const pointed = () => lay.layout.indexAt({ x: ctx.pointer.x - tx, y: ctx.pointer.y - ty });

    // The pointer: click to place the caret, Shift-click or drag to select; double-click for a word
    // (drag on for more, a word at a time), triple-click for everything.
    const text = s.edit.text;
    if (it.pressed) {
      const i = pointed();
      if (it.presses >= 3) {
        s.picked = { unit: 'all', from: 0, to: text.length };
        s.edit = { text, anchor: 0, focus: text.length };
      } else if (it.presses === 2) {
        const [from, to] = wordAt(text, i);
        s.picked = { unit: 'word', from, to };
        s.edit = { text, anchor: from, focus: to };
      } else {
        s.picked = { unit: 'char', from: i, to: i };
        s.edit = moveTo(s.edit, i, ctx.mods.shift && wasEditing);
      }
      s.history.breakRun();
    } else if (it.held || it.released) {
      const i = pointed();
      const { unit, from, to } = s.picked;
      if (unit === 'char') s.edit = moveTo(s.edit, i, true);
      else if (unit === 'word') {
        // From the word first picked to the word under the pointer, whichever side it's on.
        const [a, b] = wordAt(text, i);
        s.edit = a < from ? { text, anchor: to, focus: a } : { text, anchor: from, focus: Math.max(b, to) };
      }
    }

    // Typing, pasting, cutting and composing, and keys, in the order they came.
    const texts = ctx.textInput(it, { caret: s.caret, selection: selected(s.edit) });
    const keys = ctx.keyEvents().filter((ev) => ev.type === 'keydown');
    for (const ev of [...texts, ...keys].sort((a, b) => a.seq - b.seq)) {
      if (!s.editing) break;
      if ('combo' in ev) {
        // While an input method is composing, the keys are its own.
        if (!s.composing && key(ev.key, ev.mods)) ev.consumed = true;
      } else if (ev.type === 'composition') s.composing = ev.text;
      else if (ev.type === 'cut') {
        if (hasSelection(s.edit)) {
          s.history.record(s.edit, 'other', ctx.time);
          s.edit = insert(s.edit, '');
        }
      } else {
        let t = ev.text.replace(/\r?\n/g, ' ');
        if (props.filter) t = props.filter(t);
        if (!t) continue;
        s.history.record(s.edit, ev.type === 'paste' ? 'other' : 'type', ctx.time);
        s.edit = insert(s.edit, t, props.maxLength);
        s.composing = '';
      }
    }
    if (s.edit !== before) s.blink = ctx.time;
    out.changed = s.edit.text !== before.text;
  }

  /** One key while editing; true if the field used it. */
  function key(k: string, m: { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean }): boolean {
    const mac = ctx.mac;
    const mod = mac ? m.meta : m.ctrl;
    const byWord = mac ? m.alt : m.ctrl;
    const e = s.edit;
    const { layout } = lay;
    const line = layout.lineOf(e.focus);
    const lineStart = lay.single ? 0 : layout.lines[line].start;
    const lineEnd = lay.single ? e.text.length : layout.lines[line].end;
    const edit = (next: Edit, kind: string) => {
      if (next.text !== e.text) s.history.record(e, kind, ctx.time);
      s.edit = next;
    };
    const move = (to: number) => {
      s.edit = moveTo(e, to, m.shift);
      s.history.breakRun();
    };
    switch (k) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        const dir = k === 'ArrowLeft' ? -1 : 1;
        if (mac && m.meta) move(dir < 0 ? lineStart : lineEnd);
        else if (byWord) move(dir < 0 ? wordLeft(e.text, e.focus) : wordRight(e.text, e.focus));
        else {
          s.edit = step(e, dir, m.shift);
          s.history.breakRun();
        }
        return true;
      }
      case 'Home':
        move(lineStart);
        return true;
      case 'End':
        move(lineEnd);
        return true;
      case 'ArrowUp':
      case 'ArrowDown': {
        const to = line + (k === 'ArrowUp' ? -1 : 1);
        if (lay.single || to < 0 || to >= layout.lines.length) move(k === 'ArrowUp' ? 0 : e.text.length);
        else move(layout.indexAt({ x: layout.position(e.focus, line).x, y: layout.lines[to].rect.y }));
        return true;
      }
      case 'Backspace':
        edit(erase(e, -1, hasSelection(e) ? undefined : mac && m.meta ? lineStart : byWord ? wordLeft(e.text, e.focus) : undefined), 'delete');
        return true;
      case 'Delete':
        edit(erase(e, 1, hasSelection(e) ? undefined : byWord ? wordRight(e.text, e.focus) : undefined), 'delete');
        return true;
      case 'Enter':
        end(true);
        ctx.blur();
        return true;
      case 'Escape':
        end(false);
        ctx.blur();
        return true;
    }
    if (!mod || m.alt) return false;
    switch (k.toLowerCase()) {
      case 'a':
        s.edit = { text: e.text, anchor: 0, focus: e.text.length };
        return true;
      case 'z': {
        const to = m.shift ? s.history.redo(e) : s.history.undo(e);
        if (to) s.edit = to;
        return true;
      }
      case 'y': {
        if (mac) return false;
        const to = s.history.redo(e);
        if (to) s.edit = to;
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------- drawing
  // Just committed: show the new text now, not the old value for a frame.
  const d = s.editing ? display(s.edit, s.composing) : { text: out.committed ?? props.value, compA: -1, compB: -1, caret: -1 };
  const editing = s.editing;
  const selA = editing && !s.composing ? selStart(s.edit) : -1;
  const selB = editing && !s.composing ? selEnd(s.edit) : -1;
  const caret = editing ? (s.composing ? d.caret : s.edit.focus) : -1;
  // The selection lit in the accent; what an input method is composing, underlined.
  const attrs: TextRange[] = [];
  if (selB > selA) attrs.push({ start: selA, end: selB, color: c.bg, background: c.accent });
  if (d.compB > d.compA) attrs.push({ start: d.compA, end: d.compB, color: c.flame, underline: c.accent });
  lay = fit(ctx, { text: d.text, attrs }, r.w - 4, sizes, { font, color: c.paper });
  const { layout } = lay;
  const sc = layout.scale;

  // One line that's too long scrolls to keep the caret in view.
  if (editing && lay.single) {
    const area = r.w - 4;
    const cx = layout.position(caret).x;
    if (cx - s.scrollX > area - sc) s.scrollX = cx - area + sc;
    if (cx - s.scrollX < 0) s.scrollX = cx;
    s.scrollX = Math.max(0, Math.min(s.scrollX, layout.bounds.w + sc - area));
  }

  if (it.hovered && !editing) ctx.hline(r.x + 2, r.y + r.h - 1, r.w - 4, c.line);
  ctx.allocate(
    r,
    (box) => {
      const x0 = 2 - s.scrollX;
      box.drawText(layout, x0, 2);
      if (editing) {
        const row = layout.lineOf(caret);
        const p = layout.position(caret, row);
        const caretRect = { x: x0 + p.x - sc, y: 2 + p.y - 1, w: sc, h: layout.lines[row].rect.h + 2 };
        s.caret = { ...caretRect, x: caretRect.x + r.x, y: caretRect.y + r.y };
        if (Math.floor((ctx.time - s.blink) / BLINK_MS) % 2 === 0) box.fillRect(caretRect, c.accent);
      }
      if (!d.text && !editing && props.placeholder) box.text(props.placeholder, 2, 2, { font, scale: sc, color: c.dim });
    },
    { clip: true },
  );

  if (editing) {
    // Tell the platform where the caret is now, and what copying would take.
    ctx.textInput(it, { caret: s.caret, selection: selected(s.edit) });
    ctx.requestFrame();
  }
  out.editing = editing;
  out.text = editing ? s.edit.text : props.value;
  return out;
}

/** The text as drawn: an input method's composition sits in place of the selection. */
function display(e: Edit, composing: string): { text: string; compA: number; compB: number; caret: number } {
  if (!composing) return { text: e.text, compA: -1, compB: -1, caret: e.focus };
  const a = selStart(e);
  return { text: e.text.slice(0, a) + composing + e.text.slice(selEnd(e)), compA: a, compB: a + composing.length, caret: a + composing.length };
}

/** The largest size whose lines fit (one-line sizes don't wrap, they scroll), else the last, cut to its lines. */
function fit(ctx: Context, text: AttributedText, width: number, sizes: readonly (readonly [number, number])[], style: { font: string; color?: number }): Fit {
  for (let n = 0; n < sizes.length; n++) {
    const [scale, max] = sizes[n];
    const last = n === sizes.length - 1;
    const opts = { ...style, scale, lineGap: scale + 1 };
    if (max <= 1) {
      const layout = ctx.layoutText(text, opts);
      if (last || layout.bounds.w <= width) return { layout, single: true };
      continue;
    }
    const layout = ctx.layoutText(text, { ...opts, width, wrap: 'word', maxLines: max });
    if (!layout.truncated || last) return { layout, single: false };
  }
  return { layout: ctx.layoutText(text, { ...style, lineGap: 2 }), single: true };
}
