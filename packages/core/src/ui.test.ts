import { describe, expect, it } from 'vitest';
import type { Context, Interaction } from './context.js';
import { SceneRecorder, type BackendFonts } from './backend.js';
import { NO_MODIFIERS, canonicalCombo, comboOf, type InputEvent } from './input.js';
import { Palette } from './palette.js';
import { UI } from './ui.js';

const fonts: BackendFonts = {
  defaultFont: 'mono',
  hasFont: (name) => name === 'mono',
  fontMetrics: () => ({ height: 7, spacing: 1 }),
  measureText: (t, _font, s) => Math.max(0, t.length * 6 - 1) * s,
};
const palette = new Palette([
  ['bg', '#000000'],
  ['fg', '#FFFFFF'],
]);

/** A UI and a way to run frames of it, 10 ms apart. */
function harness(mac = false) {
  const backend = new SceneRecorder(fonts);
  const ui = new UI({ palette, backend, mac });
  let time = 0;
  const frame = (paint: (ctx: Context) => void, events: InputEvent[] = []) => {
    backend.reset(100, 100, palette);
    return { ...ui.frame({ width: 100, height: 100, time: (time += 10), events }, paint), scene: backend.scene };
  };
  return { ui, frame };
}

const m = NO_MODIFIERS;
const move = (x: number, y: number): InputEvent => ({ type: 'pointermove', x, y, mods: m });
const down = (x: number, y: number): InputEvent => ({ type: 'pointerdown', x, y, button: 0, mods: m });
const up = (x: number, y: number): InputEvent => ({ type: 'pointerup', x, y, button: 0, mods: m });
const click = (x: number, y: number) => [down(x, y), up(x, y)];
const key = (k: string, mods = m): InputEvent => ({ type: 'keydown', key: k, code: '', repeat: false, mods });

describe('interaction routing', () => {
  it('gives presses to the rect registered last, the one on top', () => {
    const { frame } = harness();
    const got: Record<string, Interaction> = {};
    const paint = (ctx: Context) => {
      got.under = ctx.interaction({ x: 0, y: 0, w: 50, h: 50 });
      got.over = ctx.interaction({ x: 10, y: 10, w: 10, h: 10 });
    };
    frame(paint);
    frame(paint, [move(15, 15), ...click(15, 15)]);
    expect(got.over.clicked).toBe(true);
    expect(got.over.hovered).toBe(true);
    expect(got.under.pressed).toBe(false);
    expect(got.under.hovered).toBe(false);
    frame(paint, click(30, 30));
    expect(got.under.clicked).toBe(true);
  });

  it('blocks lower layers with an overlay, for the wheel too', () => {
    const { frame } = harness();
    let list!: Interaction;
    let modal = false;
    const paint = (ctx: Context) => {
      list = ctx.interaction({ x: 0, y: 0, w: 100, h: 100 }, { wheel: true });
      if (modal) ctx.overlay((o) => o.interaction({ x: 20, y: 20, w: 40, h: 40 }));
    };
    frame(paint);
    frame(paint, [{ type: 'wheel', x: 30, y: 30, dx: 0, dy: 40, mods: m }]);
    expect(list.wheelY).toBe(40);
    modal = true;
    frame(paint);
    frame(paint, [{ type: 'wheel', x: 30, y: 30, dx: 0, dy: 40, mods: m }, ...click(30, 30)]);
    expect(list.wheelY).toBe(0);
    expect(list.clicked).toBe(false);
    // Outside the overlay's rect, the list still answers.
    frame(paint, click(90, 90));
    expect(list.clicked).toBe(true);
  });

  it('passes presses through things that only take the wheel', () => {
    const { frame } = harness();
    let button!: Interaction;
    let scroller!: Interaction;
    const paint = (ctx: Context) => {
      button = ctx.interaction({ x: 0, y: 0, w: 20, h: 20 });
      scroller = ctx.interaction({ x: 0, y: 0, w: 100, h: 100 }, { click: false, wheel: true });
    };
    frame(paint);
    frame(paint, [...click(5, 5), { type: 'wheel', x: 5, y: 5, dx: 0, dy: 10, mods: m }]);
    expect(button.clicked).toBe(true);
    expect(scroller.wheelY).toBe(10);
  });

  it('leaves the hover to what is under a catcher that does not take it', () => {
    const { frame } = harness();
    let cell!: Interaction;
    let catcher!: Interaction;
    const paint = (ctx: Context) => {
      cell = ctx.interaction({ x: 0, y: 0, w: 50, h: 50 }, { hint: 'CELL' });
      catcher = ctx.interaction({ x: 0, y: 0, w: 100, h: 100 }, { click: false, wheel: true, hover: false });
    };
    frame(paint);
    frame(paint, [move(10, 10), { type: 'wheel', x: 10, y: 10, dx: 0, dy: 10, mods: m }]);
    expect(cell.hovered).toBe(true);
    expect(catcher.hovered).toBe(false);
    expect(catcher.wheelY).toBe(10);
  });

  it('hit-tests only the part of a rect inside its clip', () => {
    const { frame } = harness();
    let chip!: Interaction;
    const paint = (ctx: Context) => {
      ctx.allocate({ x: 0, y: 0, w: 50, h: 20 }, (c) => (chip = c.interaction({ x: 40, y: 0, w: 30, h: 20 })), { clip: true });
    };
    frame(paint);
    frame(paint, click(60, 5));
    expect(chip.clicked).toBe(false);
    frame(paint, click(45, 5));
    expect(chip.clicked).toBe(true);
  });

  it('keeps the pointer with what was pressed, and reports the drag', () => {
    const { frame } = harness();
    let knob!: Interaction;
    let other!: Interaction;
    const paint = (ctx: Context) => {
      knob = ctx.interaction({ x: 0, y: 0, w: 10, h: 10 });
      other = ctx.interaction({ x: 50, y: 50, w: 10, h: 10 });
    };
    frame(paint);
    frame(paint, [down(5, 5)]);
    expect(knob.pressed && knob.held).toBe(true);
    frame(paint, [move(55, 55)]);
    expect(knob.held).toBe(true);
    expect(knob.hovered).toBe(true);
    expect(other.hovered).toBe(false);
    expect([knob.dx, knob.dy]).toEqual([50, 50]);
    frame(paint, [up(55, 55)]);
    expect(knob.released).toBe(true);
    expect(knob.clicked).toBe(false);
    expect(knob.held).toBe(false);
  });

  it('sees a press and release inside one frame as a click, and a quick second press as a double', () => {
    const { frame } = harness();
    let b!: Interaction;
    const paint = (ctx: Context) => (b = ctx.interaction({ x: 0, y: 0, w: 10, h: 10 }));
    frame(paint);
    frame(paint, click(5, 5));
    expect(b.clicked && !b.doubleClicked).toBe(true);
    frame(paint, click(5, 5));
    expect(b.doubleClicked).toBe(true);
    expect(b.presses).toBe(2);
    frame(paint, click(5, 5));
    expect(b.presses).toBe(3);
    expect(b.doubleClicked).toBe(false);
    frame(paint);
    expect(b.presses).toBe(0);
  });
});

describe('keys and state', () => {
  it('keys state by position, and drops what is not asked for', () => {
    const { frame } = harness();
    let show = true;
    const seen: number[] = [];
    const paint = (ctx: Context) => {
      const a = ctx.state(() => ({ n: 0 }));
      a.n++;
      if (show) ctx.allocate({ x: 0, y: 0, w: 1, h: 1 }, (c) => c.state(() => ({ n: 100 })).n++);
      seen.push(a.n);
    };
    frame(paint);
    frame(paint);
    expect(seen).toEqual([1, 2]);
    show = false;
    frame(paint);
    show = true;
    let inner = 0;
    frame((ctx) => {
      ctx.state(() => ({ n: 0 }));
      ctx.allocate({ x: 0, y: 0, w: 1, h: 1 }, (c) => (inner = c.state(() => ({ n: 100 })).n));
    });
    expect(inner).toBe(100);
  });

  it('shares state under an explicit key wherever it is drawn', () => {
    const { frame } = harness();
    const values: number[] = [];
    frame((ctx) => {
      ctx.state(() => ({ n: 1 }), { key: 'shared' }).n = 7;
    });
    frame((ctx) => {
      ctx.allocate({ x: 0, y: 0, w: 10, h: 10 }, (c) => c.allocate({ x: 0, y: 0, w: 1, h: 1 }, (d) => values.push(d.state(() => ({ n: 1 }), { key: 'shared' }).n)));
    });
    expect(values).toEqual([7]);
  });

  it('glides animated values by time, and asks for frames until they land', () => {
    const { frame } = harness();
    let v = 0;
    let target = 0;
    const paint = (ctx: Context) => (v = ctx.animatedValue(target));
    frame(paint);
    target = 1;
    const out = frame(paint);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
    expect(out.animating).toBe(true);
    for (let i = 0; i < 200; i++) frame(paint);
    expect(v).toBe(1);
    expect(frame(paint).animating).toBe(false);
  });

  it('leaves typing keys to a focused text widget, but not other shortcuts', () => {
    const { frame } = harness();
    let g = false;
    let save = false;
    let field!: Interaction;
    const paint = (ctx: Context) => {
      g = ctx.shortcut('g');
      save = ctx.shortcut('Mod+S');
      field = ctx.interaction({ x: 0, y: 0, w: 10, h: 10 }, { focusable: true, text: true });
    };
    frame(paint);
    frame(paint, [key('g')]);
    expect(g).toBe(true);
    frame(paint, click(5, 5));
    expect(field.focused).toBe(true);
    frame(paint, [key('g'), key('s', { ...m, ctrl: true })]);
    expect(g).toBe(false);
    expect(save).toBe(true);
    // Pressing elsewhere takes the focus away.
    frame(paint, click(50, 50));
    expect(field.focused).toBe(false);
  });

  it('gives focus to a focusable container when something in it is pressed', () => {
    const { frame } = harness();
    let list!: Interaction;
    let row!: Interaction;
    const paint = (ctx: Context) => {
      list = ctx.interaction({ x: 0, y: 0, w: 50, h: 50 }, { click: false, focusable: true });
      row = ctx.interaction({ x: 0, y: 0, w: 50, h: 10 });
    };
    frame(paint);
    frame(paint, click(5, 5));
    expect(row.clicked).toBe(true);
    expect(list.focused).toBe(true);
  });

  it('keeps keys from lower layers while something captures the keyboard', () => {
    const { frame } = harness();
    let open = true;
    let below = false;
    let above = false;
    const paint = (ctx: Context) => {
      below = ctx.shortcut('Escape');
      if (open)
        ctx.overlay((o) => {
          o.captureKeyboard();
          above = o.shortcut('Escape');
        });
    };
    frame(paint);
    frame(paint, [key('Escape')]);
    expect([below, above]).toEqual([false, true]);
    open = false;
    frame(paint);
    frame(paint, [key('Escape')]);
    expect(below).toBe(true);
  });

  it('moves focus with Tab through focusable widgets in order', () => {
    const { frame } = harness();
    const f: Interaction[] = [];
    const paint = (ctx: Context) => {
      f[0] = ctx.interaction({ x: 0, y: 0, w: 10, h: 10 }, { focusable: true });
      ctx.interaction({ x: 20, y: 0, w: 10, h: 10 });
      f[1] = ctx.interaction({ x: 40, y: 0, w: 10, h: 10 }, { focusable: true });
    };
    frame(paint);
    frame(paint, [key('Tab')]);
    expect(f.map((x) => x.focused)).toEqual([true, false]);
    frame(paint, [key('Tab')]);
    expect(f.map((x) => x.focused)).toEqual([false, true]);
    frame(paint, [key('Tab', { ...m, shift: true })]);
    expect(f.map((x) => x.focused)).toEqual([true, false]);
  });

  it('writes combos one canonical way', () => {
    expect(canonicalCombo('shift+mod+Z', false)).toBe('Mod+Shift+z');
    expect(canonicalCombo('Cmd+S', true)).toBe('Mod+s');
    expect(canonicalCombo('Ctrl+S', false)).toBe('Mod+s');
    expect(canonicalCombo('space', false)).toBe('Space');
    expect(canonicalCombo('Mod++', false)).toBe('Mod++');
    expect(comboOf('Z', { ...m, meta: true, shift: true }, true)).toBe('Mod+Shift+z');
    // Symbols need Shift on some layouts and not others: it doesn't count.
    expect(comboOf('+', { ...m, shift: true }, false)).toBe('+');
    expect(canonicalCombo('Shift++', false)).toBe('+');
  });
});

describe('layout', () => {
  it('cuts strips off the bounds', () => {
    const { frame } = harness();
    frame((ctx) => {
      expect(ctx.cutTop(10, 2)).toEqual({ x: 0, y: 0, w: 100, h: 10 });
      expect(ctx.cutRight(20)).toEqual({ x: 80, y: 12, w: 20, h: 88 });
      ctx.inset(4);
      expect(ctx.bounds).toEqual({ x: 4, y: 16, w: 72, h: 80 });
      expect(ctx.cursor).toEqual({ x: 4, y: 16 });
    });
  });

  it('places things along a row, and advances the parent past it', () => {
    const { frame } = harness();
    frame((ctx) => {
      const rects = ctx.row({ gap: 3 }, (row) => [row.place({ w: 10, h: 5 }), row.place({ w: 20, h: 8 })]);
      expect(rects).toEqual([
        { x: 0, y: 0, w: 10, h: 5 },
        { x: 13, y: 0, w: 20, h: 8 },
      ]);
      expect(ctx.cursor).toEqual({ x: 0, y: 8 });
      expect(ctx.row({ h: 12, align: 'center' }, (row) => row.place({ w: 4, h: 6 }))).toEqual({ x: 0, y: 3, w: 4, h: 6 });
      expect(ctx.cursor.y).toBe(20);
    });
  });

  it('measures what a region laid out, explicit rects included', () => {
    const { frame } = harness();
    frame((ctx) => {
      const r = ctx.region({ x: 0, y: 0, w: 50, h: 50 });
      r.place({ w: 10, h: 5 });
      r.region({ x: 20, y: 30, w: 5, h: 5 });
      expect(r.extent).toEqual({ w: 25, h: 35 });
    });
  });

  it('clips in place, without moving the origin', () => {
    const { frame } = harness();
    let it!: Interaction;
    const paint = (ctx: Context) => ctx.clip({ x: 10, y: 10, w: 10, h: 10 }, (c) => (it = c.interaction({ x: 0, y: 0, w: 30, h: 30 })));
    const out = frame(paint);
    expect(out.scene.clips[1]).toEqual({ x: 10, y: 10, w: 10, h: 10 });
    frame(paint, click(5, 5));
    expect(it.clicked).toBe(false);
    frame(paint, click(15, 15));
    expect(it.clicked).toBe(true);
  });

  it('draws in absolute coordinates through the region origin and clip', () => {
    const { frame } = harness();
    const out = frame((ctx) => {
      ctx.allocate({ x: 10, y: 20, w: 30, h: 30 }, (c) => c.fillRect({ x: 1, y: 2, w: 3, h: 4 }, 1), { clip: true });
      ctx.overlay((o) => o.pixel(0, 0, 1));
      ctx.pixel(5, 5, 0);
    });
    const [fill, pixel, top] = out.scene.commands;
    expect(fill).toMatchObject({ op: 'fill', x: 11, y: 22, w: 3, h: 4, clip: 1 });
    expect(out.scene.clips[1]).toEqual({ x: 10, y: 20, w: 30, h: 30 });
    // The overlay's pixel comes last, above the base layer.
    expect(pixel).toMatchObject({ op: 'pixel', x: 5, y: 5 });
    expect(top).toMatchObject({ op: 'pixel', x: 0, y: 0, clip: 0 });
  });
});
