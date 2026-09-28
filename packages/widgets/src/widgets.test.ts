import { NO_MODIFIERS, Palette, UI, bitmap, type Context, type InputEvent, type Modifiers } from '@synth-ui/core';
import { basicTextLayout, type Font, type FontSource } from '@synth-ui/core/backend';
import { describe, expect, it } from 'vitest';
import { button } from './button.js';
import { knob, slider } from './knob.js';
import { list } from './list.js';
import { dropdown } from './menu.js';
import { scrollView } from './scroll.js';
import { statusLine } from './status.js';
import { History, erase, insert, moveTo, wordAt, wordLeft, wordRight, type Edit } from './textedit.js';
import { textField } from './textfield.js';
import { THEME_COLORS, THEME_FONTS } from './theme.js';

const mono: Font = { height: 5, spacing: 1, width: (t, s = 1) => Math.max(0, t.length * 4 - 1) * s };
// Every theme font measures as `mono`.
const fonts: FontSource = { defaultFont: 'text', has: (name) => name in THEME_FONTS, font: () => mono, layoutText: (text, opts) => basicTextLayout(mono, text, opts) };
const palette = new Palette(THEME_COLORS);

function harness(width = 200, height = 150) {
  const ui = new UI({ palette, fonts });
  let time = 0;
  const frame = (paint: (ctx: Context) => void, events: InputEvent[] = []) => ui.frame({ width, height, time: (time += 10), events }, paint);
  /** Frames until animations settle. */
  const settle = (paint: (ctx: Context) => void) => {
    for (let i = 0; i < 300; i++) if (!frame(paint).animating) return;
  };
  return { frame, settle };
}

const m = NO_MODIFIERS;
const down = (x: number, y: number): InputEvent => ({ type: 'pointerdown', x, y, button: 0, mods: m });
const up = (x: number, y: number): InputEvent => ({ type: 'pointerup', x, y, button: 0, mods: m });
const click = (x: number, y: number) => [{ type: 'pointermove', x, y, mods: m } as InputEvent, down(x, y), up(x, y)];
const key = (k: string, mods: Partial<Modifiers> = {}): InputEvent => ({ type: 'keydown', key: k, code: '', repeat: false, mods: { ...m, ...mods } });
const type = (text: string): InputEvent => ({ type: 'text', text });

describe('THEME_FONTS', () => {
  it('has every glyph of a face at the same height', () => {
    for (const face of Object.values(THEME_FONTS)) {
      const heights = new Set(Object.values(face.glyphs).map((rows) => bitmap(rows).h));
      expect(heights.size).toBe(1);
    }
  });
});

describe('text editing', () => {
  const e = (text: string, anchor: number, focus = anchor): Edit => ({ text, anchor, focus });

  it('inserts over the selection, within the length limit', () => {
    expect(insert(e('hello', 1, 4), 'EY')).toEqual(e('hEYo', 3));
    expect(insert(e('abc', 3), 'defg', 5)).toEqual(e('abcde', 5));
  });

  it('moves and deletes by words', () => {
    const t = 'one two  three';
    expect(wordLeft(t, 9)).toBe(4);
    expect(wordRight(t, 3)).toBe(7);
    expect(wordAt(t, 5)).toEqual([4, 7]);
    expect(erase(e(t, 9), -1, wordLeft(t, 9))).toEqual(e('one three', 4));
    expect(moveTo(e(t, 2), 6, true)).toEqual(e(t, 2, 6));
  });

  it('merges a run of typing into one undo step, but not a pause or a caret move', () => {
    const h = new History();
    let s = e('', 0);
    for (const ch of 'abc') {
      h.record(s, 'type', 0);
      s = insert(s, ch);
    }
    h.record(s, 'type', 5000);
    s = insert(s, 'd');
    expect(h.undo(s)).toEqual(e('abc', 3));
    const back = h.undo(e('abc', 3))!;
    expect(back).toEqual(e('', 0));
    expect(h.redo(back)).toEqual(e('abc', 3));
  });
});

describe('textField', () => {
  it('edits by typing and keys, and commits on Enter', () => {
    const { frame } = harness();
    let value = 'SONG';
    let res!: ReturnType<typeof textField>;
    const paint = (ctx: Context) => {
      res = textField(ctx, { value }, { x: 0, y: 0, w: 100, h: 9 });
      if (res.committed !== null) value = res.committed;
    };
    frame(paint);
    // Click after the text: the caret goes to the end.
    frame(paint, click(90, 4));
    expect(res.editing).toBe(true);
    frame(paint, [type('S!'), key('Backspace')]);
    expect(res.text).toBe('SONGS');
    // Keys and typing in one frame apply in the order they came.
    frame(paint, [key('ArrowLeft', { ctrl: true }), type('MY ')]);
    expect(res.text).toBe('MY SONGS');
    frame(paint, [key('End'), key('Backspace'), key('Home'), key('Delete')]);
    expect(res.text).toBe('Y SONG');
    // The caret move between them keeps Backspace and Delete separate undo steps.
    frame(paint, [key('z', { ctrl: true })]);
    expect(res.text).toBe('MY SONG');
    frame(paint, [key('Enter')]);
    expect(value).toBe('MY SONG');
    expect(res.editing).toBe(false);
  });

  it('puts the value back on Escape, and undoes with Mod+Z', () => {
    const { frame } = harness();
    let res!: ReturnType<typeof textField>;
    const paint = (ctx: Context) => (res = textField(ctx, { value: 'A' }, { x: 0, y: 0, w: 100, h: 9 }));
    frame(paint);
    frame(paint, [...click(90, 4), type('B')]);
    frame(paint, [type('C')]);
    expect(res.text).toBe('ABC');
    frame(paint, [key('z', { ctrl: true })]);
    expect(res.text).toBe('A');
    frame(paint, [type('X'), key('Escape')]);
    expect(res.cancelled).toBe(true);
    expect(res.committed).toBe(null);
    frame(paint);
    expect(res.text).toBe('A');
  });

  it('selects a word on a double-click, by words as it drags on, and everything on a triple-click', () => {
    const { frame } = harness();
    let res!: ReturnType<typeof textField>;
    const paint = (ctx: Context) => (res = textField(ctx, { value: 'ONE TWO THREE' }, { x: 0, y: 0, w: 100, h: 9 }));
    // Characters are 4 wide from x 2: "TWO" is 4–7, x 18–30.
    const at = (i: number) => 2 + i * 4 + 1;
    // Long enough that the next press starts a new count.
    const pause = () => {
      for (let i = 0; i < 50; i++) frame(paint);
    };
    frame(paint);
    frame(paint, click(at(5), 4));
    // The second press, let go a frame later as a browser does: the word stays selected.
    frame(paint, [down(at(5), 4)]);
    frame(paint, [up(at(6), 4)]);
    frame(paint, [type('X')]);
    expect(res.text).toBe('ONE X THREE');

    // Double-click and drag: a word at a time, either way from the first.
    frame(paint, [key('z', { ctrl: true })]);
    pause();
    frame(paint, click(at(5), 4));
    frame(paint, [down(at(5), 4)]);
    frame(paint, [{ type: 'pointermove', x: at(9), y: 4, mods: m }]);
    frame(paint, [up(at(9), 4), type('X')]);
    expect(res.text).toBe('ONE X');
    frame(paint, [key('z', { ctrl: true })]);
    pause();
    frame(paint, click(at(5), 4));
    frame(paint, [down(at(5), 4)]);
    frame(paint, [up(at(1), 4), type('X')]);
    expect(res.text).toBe('X THREE');

    // Three presses: all of it, however the pointer moves before it's let go.
    frame(paint, [key('z', { ctrl: true })]);
    pause();
    frame(paint, click(at(5), 4));
    frame(paint, click(at(5), 4));
    frame(paint, [down(at(5), 4)]);
    frame(paint, [up(at(2), 4), type('X')]);
    expect(res.text).toBe('X');
  });

  it('commits when the focus moves away', () => {
    const { frame } = harness();
    let committed: string | null = null;
    const paint = (ctx: Context) => {
      const r = textField(ctx, { value: '' }, { x: 0, y: 0, w: 100, h: 9 });
      if (r.committed !== null) committed = r.committed;
      button(ctx, { label: 'OK' }, { x: 0, y: 50, w: 30, h: 11 });
    };
    frame(paint);
    frame(paint, [...click(10, 4), type('HI')]);
    frame(paint, click(10, 55));
    expect(committed).toBe('HI');
  });
});

describe('list', () => {
  const rows: number[] = [];
  let res: ReturnType<typeof list>;
  let selected = 0;
  const paint = (ctx: Context) => {
    rows.length = 0;
    res = list(ctx, { count: 1000, rowHeight: 10, selected }, (_, row) => rows.push(row.index), { x: 0, y: 0, w: 100, h: 50 });
    if (res.select !== null) selected = res.select;
  };

  it('draws only the rows in view, and scrolls a row per notch, gliding', () => {
    const { frame, settle } = harness();
    selected = 0;
    frame(paint);
    expect(rows).toEqual([0, 1, 2, 3, 4]);
    frame(paint, [{ type: 'wheel', x: 10, y: 10, dx: 0, dy: 120, mods: m }]);
    // Not there yet: it glides.
    expect(rows[0]).toBeLessThan(3);
    settle(paint);
    expect(rows).toEqual([3, 4, 5, 6, 7]);
  });

  it('selects on press, moves with the arrow keys while focused, and follows the selection', () => {
    const { frame, settle } = harness();
    selected = 0;
    frame(paint);
    frame(paint, click(10, 25));
    expect(selected).toBe(2);
    expect(res.focused).toBe(true);
    for (let i = 0; i < 5; i++) frame(paint, [key('ArrowDown')]);
    expect(selected).toBe(7);
    settle(paint);
    expect(rows).toContain(7);
    expect(rows[rows.length - 1]).toBe(7);
    frame(paint, [key('End')]);
    settle(paint);
    expect(selected).toBe(999);
    expect(rows[rows.length - 1]).toBe(999);
  });
});

describe('scrollView', () => {
  it('keeps the scrollbar thumb long enough to grab, and grabbable beside it', () => {
    const { frame, settle } = harness();
    let y = 0;
    const paint = (ctx: Context) =>
      scrollView(ctx, { content: { h: 100_000 } }, (_, scroll) => void (y = scroll.y), { x: 0, y: 0, w: 100, h: 50 });
    frame(paint);
    const thumb = frame(paint).scene.commands.find((c) => c.op === 'fill' && c.w === 3);
    expect(thumb).toMatchObject({ x: 97, y: 0, h: 16 });
    // Two pixels left of the thumb still grabs it: drag it to the bottom.
    frame(paint, [down(95, 8)]);
    frame(paint, [{ type: 'pointermove', x: 95, y: 60, mods: m }, up(95, 60)]);
    // The content glides after the thumb rather than jumping.
    frame(paint);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(100_000 - 50);
    settle(paint);
    expect(y).toBe(100_000 - 50);
  });


  it('measures what it laid out, and stops at the end', () => {
    const { frame, settle } = harness();
    let y = -1;
    let max = -1;
    const paint = (ctx: Context) =>
      scrollView(
        ctx,
        {},
        (content, scroll) => {
          for (let i = 0; i < 20; i++) content.place({ w: 10, h: 10 });
          y = scroll.y;
          max = scroll.max.y;
        },
        { x: 0, y: 0, w: 100, h: 50 },
      );
    frame(paint);
    frame(paint, [{ type: 'wheel', x: 10, y: 10, dx: 0, dy: 1000, mods: m }]);
    settle(paint);
    expect(max).toBe(150);
    expect(y).toBe(150);
  });
});

describe('double-click to reset', () => {
  const move = (x: number, y: number): InputEvent => ({ type: 'pointermove', x, y, mods: m });

  it('a knob held after the double-click turns from the reset value, not back from the old one', () => {
    const { frame } = harness();
    let value = 0.9;
    const paint = (ctx: Context) => {
      const next = knob(ctx, { label: 'CUT', text: '', value, reset: 0.5 }, { x: 0, y: 0, w: 40, h: 40 });
      if (next !== null) value = next;
    };
    frame(paint);
    frame(paint, click(20, 10));
    frame(paint, [down(20, 10)]);
    expect(value).toBe(0.5);
    frame(paint);
    expect(value).toBe(0.5);
    frame(paint, [move(20, 1)]);
    expect(value).toBeCloseTo(0.5 + 9 / 90);
  });

  it('a slider ignores the pointer until the press that reset it is let go', () => {
    const { frame } = harness();
    let value = 0.2;
    const paint = (ctx: Context) => {
      const next = slider(ctx, { value, reset: 0.5 }, { x: 0, y: 0, w: 103, h: 9 });
      if (next !== null) value = next;
    };
    frame(paint);
    frame(paint, click(21, 4));
    expect(value).toBeCloseTo(0.2);
    frame(paint, [down(21, 4)]);
    expect(value).toBe(0.5);
    frame(paint, [move(80, 4)]);
    frame(paint, [up(80, 4)]);
    expect(value).toBe(0.5);
    frame(paint, [move(91, 4), down(91, 4)]);
    expect(value).toBeCloseTo(0.9);
  });
});

describe('statusLine', () => {
  it('slides a message up over the permanent text, and back down when its time is up', () => {
    const { frame, settle } = harness();
    let hint = 'HOVERED';
    let message: { text: string } | null = null;
    const paint = (ctx: Context) => statusLine(ctx, { text: hint, message, duration: 1000 }, { x: 0, y: 100, w: 100, h: 9 });
    const texts = () => Object.fromEntries(frame(paint).scene.commands.flatMap((c) => (c.op === 'text' ? [[c.text, [c.y, c.color]]] : [])));
    const [slate, paper] = [palette.index.slate, palette.index.paper];
    expect(texts()).toEqual({ HOVERED: [102, slate] });
    message = { text: 'SAVED' };
    const mid = texts();
    expect(mid.HOVERED[0]).toBeLessThan(102);
    expect(mid.SAVED[0]).toBeGreaterThan(102);
    for (let i = 0; i < 30; i++) frame(paint);
    // The permanent text changing underneath doesn't disturb the message.
    hint = 'ELSEWHERE';
    expect(texts()).toEqual({ ELSEWHERE: [93, slate], SAVED: [102, paper] });
    // A new message swaps in place and restarts the clock.
    message = { text: 'OPENED' };
    expect(texts()).toEqual({ ELSEWHERE: [93, slate], OPENED: [102, paper] });
    for (let i = 0; i < 90; i++) frame(paint);
    expect(texts().OPENED).toEqual([102, paper]);
    settle(paint);
    expect(texts()).toEqual({ ELSEWHERE: [102, slate] });
  });
});

describe('dropdown', () => {
  it('opens a menu that takes the keyboard, and a press outside closes it without reaching what is under it', () => {
    const { frame } = harness();
    let value = 'a';
    let under = false;
    const paint = (ctx: Context) => {
      under = button(ctx, { label: 'UNDER' }, { x: 100, y: 100, w: 40, h: 11 }).clicked;
      const next = dropdown(ctx, { value, options: ['a', 'b', 'c'].map((v) => ({ value: v, label: v.toUpperCase() })) }, { x: 0, y: 0, w: 40, h: 13 });
      if (next !== null) value = next;
    };
    frame(paint);
    frame(paint, click(10, 5));
    frame(paint);
    frame(paint, [key('ArrowDown'), key('Enter')]);
    expect(value).toBe('b');
    // The closed menu's rects route one more frame's input.
    frame(paint);
    frame(paint, click(10, 5));
    frame(paint);
    frame(paint, click(110, 105));
    expect(under).toBe(false);
    frame(paint);
    frame(paint, click(110, 105));
    expect(under).toBe(true);
  });
  it('without a value, every pick counts, the same one again too; disabled, it does not open', () => {
    const { frame } = harness();
    const picks: string[] = [];
    let disabled = false;
    const paint = (ctx: Context) => {
      const next = dropdown(ctx, { value: null, placeholder: 'ADD', disabled, options: ['a', 'b'].map((v) => ({ value: v, label: v.toUpperCase() })) }, { x: 0, y: 0, w: 40, h: 13 });
      if (next !== null) picks.push(next);
    };
    const pickFirst = () => {
      frame(paint, click(10, 5));
      frame(paint);
      frame(paint, [key('ArrowDown'), key('Enter')]);
      frame(paint);
    };
    frame(paint);
    pickFirst();
    pickFirst();
    expect(picks).toEqual(['a', 'a']);
    disabled = true;
    frame(paint);
    pickFirst();
    expect(picks).toEqual(['a', 'a']);
  });
});
