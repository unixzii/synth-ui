// The UI: what lives between frames. A renderer calls `frame()` once per
// frame with the input that arrived since the last one; the paint function
// draws the whole UI into a Context and asks it what happened; out comes a
// Scene to draw, plus what the renderer should do about the cursor, text
// input and the clipboard.
//
// Input is routed with the previous frame's layout. Every `interaction()`
// registers its rectangle; at the start of the next frame, presses, hover
// and scrolling go to the topmost one under the pointer: the highest layer,
// and within it the one registered last (drawn last, so on top). Widgets see
// the result as soon as they ask, one frame after the layout they were hit in.

import { type Point, type Rect, inside } from './geometry.js';
import { Context } from './context.js';
import type { FontSource } from './font.js';
import { type CursorStyle, type InputEvent, type Modifiers, NO_MODIFIERS, canonicalCombo, comboOf } from './input.js';
import type { Palette } from './palette.js';
import type { DrawCommand, Scene } from './scene.js';

export interface UIOptions {
  palette: Palette;
  fonts: FontSource;
  /** Index each frame is cleared to. */
  background?: number;
  /** Mod is Cmd, as on a Mac, rather than Ctrl. */
  mac?: boolean;
}

export interface FrameInput {
  /** The frame's size in virtual pixels. */
  width: number;
  height: number;
  /** Milliseconds on a steady clock. */
  time: number;
  /** Everything that happened since the last frame, in order. */
  events: readonly InputEvent[];
}

export interface TextInputState {
  /** The caret, absolute: input methods open their popups beside it. */
  caret: Rect;
  /** What copying would put on the clipboard right now. */
  selection: string;
}

export interface FrameOutput {
  scene: Scene;
  cursor: CursorStyle;
  /** The hint of whatever the pointer is over. */
  hint: string;
  /** Set while a text widget has focus. */
  textInput: TextInputState | null;
  /** Every combo claimed with `shortcut()` this frame, canonical, so a host can stop their default action. */
  shortcuts: ReadonlySet<string>;
  /** Something is still moving: draw another frame even if nothing happens. */
  animating: boolean;
}

export interface KeyEvent {
  type: 'keydown' | 'keyup';
  key: string;
  code: string;
  repeat: boolean;
  mods: Modifiers;
  /** Canonical combo, e.g. 'Mod+Shift+z'. */
  combo: string;
  /** Taken by a widget or shortcut this frame. */
  consumed: boolean;
  /** Its place among this frame's key and text events, to put the two back in order. */
  seq: number;
}

export type TextEvent = Extract<InputEvent, { type: 'text' | 'composition' | 'paste' | 'cut' }> & {
  /** Its place among this frame's key and text events, to put the two back in order. */
  seq: number;
};

/** @internal An interactive rectangle registered this frame. */
export interface Hit {
  key: string;
  /** Absolute, clipped. */
  rect: Rect;
  layer: number;
  click: boolean;
  wheel: boolean;
  /** Seen by hover ('any'): false lets what's under it keep the hover. */
  hover: boolean;
  focusable: boolean;
  text: boolean;
}

/** @internal What happened to one widget this frame. */
export interface HitEvents {
  pressed: boolean;
  /** How many presses in quick succession this one makes: 1, 2 for a double, 3 for a triple… */
  presses: number;
  releasedAt: Point | null;
  wheelX: number;
  wheelY: number;
}

interface Slot {
  value: unknown;
  frame: number;
}

const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_DIST = 4;

export class UI {
  palette: Palette;
  fonts: FontSource;
  background: number;
  readonly mac: boolean;

  // ------------------------------------------------ state between frames
  /** @internal */ frameNo = 0;
  /** @internal */ time = -1;
  /** @internal Seconds since the last frame (at most 0.1). */ dt = 0;
  /** @internal */ width = 0;
  /** @internal */ height = 0;
  /** @internal Pointer, absolute (NaN when it's not over the surface). */ pointer: Point = { x: NaN, y: NaN };
  /** @internal */ down = false;
  /** @internal */ mods: Modifiers = NO_MODIFIERS;
  /** @internal The widget that owns the pointer, from its press to its release. */ active: string | null = null;
  /** @internal */ pressOrigin: Point = { x: 0, y: 0 };
  /** @internal */ focus: string | null = null;
  private lastPress = { time: -Infinity, x: 0, y: 0, count: 0 };
  private prevHits: Hit[] = [];
  private store = new Map<string, Slot>();
  private warned = new Set<string>();

  // ------------------------------------------------ this frame's input
  /** @internal */ events = new Map<string, HitEvents>();
  /** @internal */ hovered: string | null = null;
  /** @internal Highest layer with anything under the pointer. */ topLayer = -1;
  /** @internal */ keys: KeyEvent[] = [];
  /** @internal */ text: TextEvent[] = [];
  /** @internal */ blurred = false;
  /** @internal The focused widget registered as a text widget last frame. */ textFocused = false;

  // ------------------------------------------------ this frame's output
  /** @internal */ hits: Hit[] = [];
  /** @internal */ seen = new Set<string>();
  /** @internal */ layers: DrawCommand[][] = [];
  /** @internal */ clips: Rect[] = [];
  /** @internal */ cursor: CursorStyle = 'default';
  /** @internal */ hint = '';
  /** @internal */ textInput: TextInputState | null = null;
  /** @internal */ shortcuts = new Set<string>();
  /** @internal The highest layer capturing the keyboard this frame (-1: none). */ keyLayer = -1;
  /** @internal The same, from last frame: key input below this layer goes nowhere. */ capturedBy = -1;
  /** @internal */ animating = false;

  constructor(opts: UIOptions) {
    this.palette = opts.palette;
    this.fonts = opts.fonts;
    this.background = opts.background ?? 0;
    this.mac = opts.mac ?? false;
  }

  /** Run one frame: take the input, draw with `paint`, and return what to show. */
  frame(input: FrameInput, paint: (ctx: Context) => void): FrameOutput {
    this.frameNo++;
    this.dt = this.time < 0 ? 0 : Math.min(0.1, Math.max(0, (input.time - this.time) / 1000));
    this.time = input.time;
    this.width = Math.max(0, Math.floor(input.width));
    this.height = Math.max(0, Math.floor(input.height));

    this.hits = [];
    this.seen = new Set();
    this.layers = [[]];
    this.clips = [{ x: 0, y: 0, w: this.width, h: this.height }];
    this.cursor = 'default';
    this.hint = '';
    this.textInput = null;
    this.shortcuts = new Set();
    this.animating = false;
    this.capturedBy = this.keyLayer;
    this.keyLayer = -1;

    this.take(input.events);
    paint(Context.root(this));
    return this.finish();
  }

  // ------------------------------------------------ input routing

  /** Route this frame's events against last frame's layout. */
  private take(events: readonly InputEvent[]) {
    this.events = new Map();
    this.keys = [];
    this.text = [];
    this.blurred = false;
    this.textFocused = !!this.focus && this.prevHits.some((h) => h.key === this.focus && h.text);

    let seq = 0;
    for (const e of events) {
      seq++;
      switch (e.type) {
        case 'pointermove':
          this.pointer = { x: e.x, y: e.y };
          this.mods = e.mods;
          break;
        case 'pointerleave':
          if (!this.down) this.pointer = { x: NaN, y: NaN };
          break;
        case 'pointerdown': {
          this.pointer = { x: e.x, y: e.y };
          this.mods = e.mods;
          if (e.button !== 0) break;
          this.down = true;
          const lp = this.lastPress;
          const again = this.time - lp.time < DOUBLE_CLICK_MS && Math.hypot(e.x - lp.x, e.y - lp.y) <= DOUBLE_CLICK_DIST;
          this.lastPress = { time: this.time, x: e.x, y: e.y, count: again ? lp.count + 1 : 1 };
          const hit = this.hitTest(e.x, e.y, 'click');
          this.active = hit?.key ?? null;
          this.pressOrigin = { x: e.x, y: e.y };
          // A press anywhere moves the focus: to the topmost thing there that takes it (what was
          // pressed, or a list around it), else nowhere.
          this.focus = this.hitTest(e.x, e.y, 'focus')?.key ?? null;
          if (hit) {
            const ev = this.eventsFor(hit.key);
            ev.pressed = true;
            ev.presses = this.lastPress.count;
          }
          break;
        }
        case 'pointerup':
          this.pointer = { x: e.x, y: e.y };
          this.mods = e.mods;
          if (e.button !== 0 || !this.down) break;
          this.down = false;
          if (this.active) this.eventsFor(this.active).releasedAt = { x: e.x, y: e.y };
          this.active = null;
          break;
        case 'wheel': {
          this.pointer = { x: e.x, y: e.y };
          this.mods = e.mods;
          const hit = this.hitTest(e.x, e.y, 'wheel');
          if (hit) {
            const ev = this.eventsFor(hit.key);
            ev.wheelX += e.dx;
            ev.wheelY += e.dy;
          }
          break;
        }
        case 'keydown':
        case 'keyup': {
          this.mods = e.mods;
          const key: KeyEvent = { type: e.type, key: e.key, code: e.code, repeat: e.type === 'keydown' && e.repeat, mods: e.mods, combo: comboOf(e.key, e.mods, this.mac), consumed: false, seq };
          this.keys.push(key);
          if (key.type === 'keydown' && (key.combo === 'Tab' || key.combo === 'Shift+Tab')) key.consumed = this.tab(key.mods.shift);
          break;
        }
        case 'text':
        case 'composition':
        case 'paste':
        case 'cut':
          this.text.push({ ...e, seq });
          break;
        case 'blur':
          this.blurred = true;
          this.mods = NO_MODIFIERS;
          break;
      }
    }

    const pointerHit = this.hitTest(this.pointer.x, this.pointer.y, 'any');
    this.hovered = pointerHit?.key ?? null;
    this.topLayer = this.layerAt(this.pointer.x, this.pointer.y);
  }

  private eventsFor(key: string): HitEvents {
    let ev = this.events.get(key);
    if (!ev) this.events.set(key, (ev = { pressed: false, presses: 0, releasedAt: null, wheelX: 0, wheelY: 0 }));
    return ev;
  }

  /** The highest layer with a registered rect under (x, y), or -1. */
  private layerAt(x: number, y: number): number {
    let top = -1;
    for (const h of this.prevHits) if (h.layer > top && inside(h.rect, x, y)) top = h.layer;
    return top;
  }

  /** The topmost rect under (x, y) that senses `sense`, in the highest layer there: lower layers are covered. */
  private hitTest(x: number, y: number, sense: 'click' | 'wheel' | 'focus' | 'any'): Hit | null {
    if (Number.isNaN(x)) return null;
    const top = this.layerAt(x, y);
    for (let i = this.prevHits.length - 1; i >= 0; i--) {
      const h = this.prevHits[i];
      if (h.layer !== top || !inside(h.rect, x, y)) continue;
      if (sense === 'any' ? h.hover : sense === 'click' ? h.click : sense === 'wheel' ? h.wheel : h.focusable) return h;
    }
    return null;
  }

  /** Move the focus to the next (or previous) focusable widget. True if there was one. */
  private tab(back: boolean): boolean {
    const keys = this.prevHits.filter((h) => h.focusable).map((h) => h.key);
    if (!keys.length) return false;
    const at = this.focus ? keys.indexOf(this.focus) : -1;
    const next = at < 0 ? (back ? keys.length - 1 : 0) : (at + (back ? -1 : 1) + keys.length) % keys.length;
    this.focus = keys[next];
    this.textFocused = this.prevHits.some((h) => h.key === this.focus && h.text);
    return true;
  }

  // ------------------------------------------------ per-frame registry

  /** @internal */
  register(hit: Hit): void {
    if (this.seen.has(hit.key)) this.warn(hit.key, `synth-ui: two interactions share the key "${hit.key}" in one frame`);
    this.seen.add(hit.key);
    this.hits.push(hit);
  }

  /**
   * @internal State that lives while it's used: returned as is if it was
   * used last frame (or earlier this frame), else made fresh with `init`.
   * `again` is true when it was already used this frame.
   */
  slot<T>(key: string, init: () => T): { value: T; again: boolean } {
    let s = this.store.get(key);
    if (!s) this.store.set(key, (s = { value: init(), frame: this.frameNo - 1 }));
    const again = s.frame === this.frameNo;
    s.frame = this.frameNo;
    return { value: s.value as T, again };
  }

  /** @internal Replace a slot's value (for immutable ones, like numbers). */
  setSlot(key: string, value: unknown): void {
    const s = this.store.get(key);
    if (s) s.value = value;
  }

  /** @internal */
  warn(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    (globalThis as { console?: { warn(...args: unknown[]): void } }).console?.warn(message);
  }

  /** @internal */
  canonical(combo: string): string {
    return canonicalCombo(combo, this.mac);
  }

  // ------------------------------------------------ frame end

  private finish(): FrameOutput {
    // Whatever owned the pointer or the focus and wasn't drawn is gone.
    if (this.active && !this.seen.has(this.active)) this.active = null;
    if (this.focus && !this.seen.has(this.focus)) this.focus = null;
    this.prevHits = this.hits;
    for (const [key, s] of this.store) if (s.frame < this.frameNo) this.store.delete(key);

    const scene: Scene = {
      width: this.width,
      height: this.height,
      palette: this.palette,
      background: this.background,
      clips: this.clips,
      commands: this.layers.length === 1 ? this.layers[0] : this.layers.flatMap((l) => l ?? []),
    };
    return {
      scene,
      cursor: this.cursor,
      hint: this.hint,
      textInput: this.textInput,
      shortcuts: this.shortcuts,
      animating: this.animating,
    };
  }
}
