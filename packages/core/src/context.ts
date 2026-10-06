// A Context is one region of the frame being drawn: its own origin, bounds
// and layout cursor, and the door to everything else — drawing, input,
// state. `allocate()` makes a child region; when its callback returns, the
// parent carries on where it was.
//
// State is keyed by position: the nth interaction (or state, or animated
// value) in a region gets the nth key under that region's key, so the same
// code drawn the same way finds the same state every frame. A widget drawn
// only sometimes shifts the keys after it in its own region; give it (or a
// region around it) an explicit `key` when that matters, e.g. rows of a list
// that can be reordered. An explicit key is global: whatever is drawn under
// it keeps its state wherever in the tree it's drawn. State nobody asks for
// in a frame is dropped at the end of that frame.

import { type Pattern, SOLID, type Bitmap } from './bitmap.js';
import type { FontMetrics, TextStyle } from './font.js';
import { type Point, type Rect, type Size, inside, intersect, inset as insetRect } from './geometry.js';
import { isTypingCombo, type CursorStyle, type KeyCombo, type Modifiers } from './input.js';
import type { ColorMap, Palette } from './palette.js';
import type { AttributedText, TextLayout, TextLayoutOptions } from './text.js';
import { ease, EASE } from './animation.js';
import { resolveFilter, type FilterOptions } from './filter.js';
import type { KeyEvent, TextEvent, UI } from './ui.js';

export type Flow = 'row' | 'column';
export type Align = 'start' | 'center' | 'end' | 'stretch';

export interface RegionOptions {
  /** A global key: the region's state, and its children's, follows it wherever it's drawn. */
  key?: string;
  /** Clip drawing and hit testing to the region. */
  clip?: boolean;
  /** How `place()` lays things out: down the region (the default) or across it. */
  flow?: Flow;
  /** Space between placed things. */
  gap?: number;
  /** Where placed things sit across the flow, or `stretch` to fill it. */
  align?: Align;
}

export interface FlowOptions extends Omit<RegionOptions, 'flow'> {
  /** Size along the parent's axes; by default it takes the room left, then advances by what it used. */
  w?: number;
  h?: number;
}

export interface InteractionOptions {
  /** A global key, instead of one from the call's position. */
  key?: string;
  /** Takes presses (and so blocks them from what's under it). Default true. */
  click?: boolean;
  /** Takes scrolling. Default false: the wheel passes through to something that does. */
  wheel?: boolean;
  /** Takes the hover. Default true; false for a catcher (of the wheel, say) laid over widgets that keep theirs. */
  hover?: boolean;
  /** Takes keyboard focus when pressed (or tabbed to). */
  focusable?: boolean;
  /** A text widget: while focused, typing goes to it, not to shortcuts. */
  text?: boolean;
  /** Pointer shape while hovered or held. */
  cursor?: CursorStyle;
  /** What it is or does, for a status line. */
  hint?: string;
}

export interface Interaction {
  readonly key: string;
  /** The pointer is over it and nothing above is in the way; stays true while it's held. */
  hovered: boolean;
  /** The primary button went down on it this frame. */
  pressed: boolean;
  /** It owns the pointer: pressed, and not let go yet. */
  held: boolean;
  /** Let go this frame, after being pressed (wherever the pointer is now). */
  released: boolean;
  /** Let go over it, after being pressed. */
  clicked: boolean;
  /** Pressed twice in quick succession: this frame's press is the second. */
  doubleClicked: boolean;
  /** This frame's press, counted in quick succession (1, 2 a double, 3 a triple…); 0 without one. */
  presses: number;
  /** Pointer travel since the press, while held (or at release). */
  dx: number;
  dy: number;
  /** Has the keyboard focus. */
  focused: boolean;
  /** Scrolling over it this frame, in pixels (only with `wheel: true`). */
  wheelX: number;
  wheelY: number;
}

export interface AnimationOptions {
  key?: string;
  /** Fraction of the way left covered each 1/60 s (0–1). Default 0.15. */
  easing?: number;
  /** Land on the target once within this distance. Default 0.001. */
  snap?: number;
  /** Start here the first time, instead of at the target. */
  from?: number;
}

/** A value regions pass down to their children, like a theme. */
export interface Token<T> {
  readonly name: string;
  readonly fallback?: (ctx: Context) => T;
}

export function createToken<T>(name: string, fallback?: (ctx: Context) => T): Token<T> {
  return { name, fallback };
}

export interface FillOptions {
  pattern?: Pattern;
}

const WHEEL_IDLE_MS = 250;

export class Context {
  /** The room to lay things out in, in local pixels. Cuts and insets shrink it. */
  bounds: Rect;
  /** Where `place()` puts the next thing, in local pixels. */
  cursor: Point;
  readonly flow: Flow;
  readonly gap: number;
  readonly align: Align;
  /** @internal Absolute position of the local origin. */ readonly ox: number;
  /** @internal */ readonly oy: number;
  private readonly clipRect: Rect;
  private readonly clipIndex: number;
  /** The layer drawn into: 0 at the root, one more in each overlay. */
  readonly layer: number;
  private env: Map<Token<unknown>, unknown>;
  private ownEnv = false;
  private n = { i: 0, s: 0, a: 0, r: 0, k: 0 };
  /** How far placed things reach, for regions that size themselves. */
  private reach = { x: 0, y: 0 };

  private constructor(
    private readonly ui: UI,
    readonly key: string,
    abs: Rect,
    clipRect: Rect,
    clipIndex: number,
    layer: number,
    env: Map<Token<unknown>, unknown>,
    opts: RegionOptions,
  ) {
    this.ox = abs.x;
    this.oy = abs.y;
    this.bounds = { x: 0, y: 0, w: abs.w, h: abs.h };
    this.cursor = { x: 0, y: 0 };
    this.clipRect = clipRect;
    this.clipIndex = clipIndex;
    this.layer = layer;
    this.env = env;
    this.flow = opts.flow ?? 'column';
    this.gap = opts.gap ?? 0;
    this.align = opts.align ?? 'start';
  }

  /** @internal The whole frame. */
  static root(ui: UI): Context {
    const all = { x: 0, y: 0, w: ui.width, h: ui.height };
    return new Context(ui, '', all, all, 0, 0, new Map(), {});
  }

  // ================================================================ frame

  /** Milliseconds, from the host's clock. */
  get time(): number {
    return this.ui.time;
  }

  /** Seconds since the last frame (at most 0.1). */
  get dt(): number {
    return this.ui.dt;
  }

  get palette(): Palette {
    return this.ui.palette;
  }

  /** The whole frame, in this region's coordinates: for overlays that cover everything. */
  get screen(): Rect {
    return { x: -this.ox, y: -this.oy, w: this.ui.width, h: this.ui.height };
  }

  // ================================================================ regions

  /**
   * Run `fn` in a child region. Given a rect, it goes exactly there; given
   * only a size, it's placed by this region's flow, like a widget. The
   * callback's return value comes back out.
   */
  allocate<T>(area: Rect | Size, fn: (ctx: Context) => T, opts: RegionOptions = {}): T {
    return fn(this.region(area, opts));
  }

  /** A child region, like `allocate()`'s, handed back rather than to a callback. */
  region(area: Rect | Size, opts: RegionOptions = {}): Context {
    if (!('x' in area)) return this.child(this.place(area), opts);
    this.grow(area);
    return this.child(area, opts);
  }

  /** How far what's been placed, cut or allocated in this region reaches, from its origin. */
  get extent(): Size {
    return { w: this.reach.x, h: this.reach.y };
  }

  /** A child region whose `place()` lays things out left to right. */
  row<T>(fn: (ctx: Context) => T): T;
  row<T>(opts: FlowOptions, fn: (ctx: Context) => T): T;
  row<T>(a: FlowOptions | ((ctx: Context) => T), b?: (ctx: Context) => T): T {
    return typeof a === 'function' ? this.flowRegion('row', {}, a) : this.flowRegion('row', a, b!);
  }

  /** A child region whose `place()` lays things out top to bottom. */
  column<T>(fn: (ctx: Context) => T): T;
  column<T>(opts: FlowOptions, fn: (ctx: Context) => T): T;
  column<T>(a: FlowOptions | ((ctx: Context) => T), b?: (ctx: Context) => T): T {
    return typeof a === 'function' ? this.flowRegion('column', {}, a) : this.flowRegion('column', a, b!);
  }

  /** Draw `fn` in this region's coordinates, clipped (drawing and hit testing) to `r`. */
  clip<T>(r: Rect, fn: (ctx: Context) => T): T {
    const abs = this.abs(r);
    const clipRect = intersect(this.clipRect, abs);
    const ctx = new Context(this.ui, `${this.key}/r${this.n.r++}`, { x: this.ox, y: this.oy, w: 0, h: 0 }, clipRect, this.ui.addClip(clipRect), this.layer, this.env, {});
    ctx.bounds = { ...this.bounds };
    ctx.cursor = { ...this.cursor };
    return fn(ctx);
  }

  /**
   * A region over this one, in the same coordinates, drawn above everything
   * in lower layers, which it also blocks from the pointer wherever it
   * registers interactions. Not clipped: popups and modals escape scroll views.
   */
  overlay<T>(fn: (ctx: Context) => T, opts: Omit<RegionOptions, 'clip'> = {}): T {
    const abs = { x: this.ox, y: this.oy, w: 0, h: 0 };
    const ctx = new Context(this.ui, opts.key ?? `${this.key}/r${this.n.r++}`, abs, this.ui.clips[0], 0, this.layer + 1, this.env, opts);
    ctx.bounds = { ...this.bounds };
    ctx.cursor = { ...this.cursor };
    return fn(ctx);
  }

  private child(r: Rect, opts: RegionOptions): Context {
    const abs = { x: this.ox + Math.round(r.x), y: this.oy + Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
    let clipRect = this.clipRect;
    let clipIndex = this.clipIndex;
    if (opts.clip) {
      clipRect = intersect(this.clipRect, abs);
      clipIndex = this.ui.addClip(clipRect);
    }
    return new Context(this.ui, opts.key ?? `${this.key}/r${this.n.r++}`, abs, clipRect, clipIndex, this.layer, this.env, opts);
  }

  private flowRegion<T>(flow: Flow, opts: FlowOptions, fn: (ctx: Context) => T): T {
    const b = this.bounds;
    const c = this.cursor;
    const r = { x: c.x, y: c.y, w: opts.w ?? b.x + b.w - c.x, h: opts.h ?? b.y + b.h - c.y };
    const child = this.child(r, { ...opts, flow });
    const out = fn(child);
    // Advance past what it used, or the size it was given.
    const used = { x: r.x, y: r.y, w: opts.w ?? child.reach.x, h: opts.h ?? child.reach.y };
    if (this.flow === 'row') c.x += used.w + this.gap;
    else c.y += used.h + this.gap;
    this.grow(used);
    return out;
  }

  // ================================================================ layout

  /** Take the next `size` from this region's flow, at the cursor, and advance past it. */
  place(size: Size): Rect {
    const { bounds: b, cursor: c, align } = this;
    let r: Rect;
    if (this.flow === 'row') {
      const h = align === 'stretch' ? b.h : size.h;
      const y = align === 'center' ? b.y + Math.floor((b.h - h) / 2) : align === 'end' ? b.y + b.h - h : align === 'stretch' ? b.y : c.y;
      r = { x: c.x, y, w: size.w, h };
      c.x += size.w + this.gap;
    } else {
      const w = align === 'stretch' ? b.w : size.w;
      const x = align === 'center' ? b.x + Math.floor((b.w - w) / 2) : align === 'end' ? b.x + b.w - w : align === 'stretch' ? b.x : c.x;
      r = { x, y: c.y, w, h: size.h };
      c.y += size.h + this.gap;
    }
    this.grow(r);
    return r;
  }

  /** Cut a strip `h` tall off the top of the bounds (plus `gap` after it); returns the strip. */
  cutTop(h: number, gap = 0): Rect {
    const b = this.bounds;
    const r = { x: b.x, y: b.y, w: b.w, h: Math.min(h, b.h) };
    b.y += r.h + gap;
    b.h = Math.max(0, b.h - r.h - gap);
    return this.cut(r);
  }

  cutBottom(h: number, gap = 0): Rect {
    const b = this.bounds;
    const r = { x: b.x, y: b.y + b.h - Math.min(h, b.h), w: b.w, h: Math.min(h, b.h) };
    b.h = Math.max(0, b.h - r.h - gap);
    return this.cut(r);
  }

  cutLeft(w: number, gap = 0): Rect {
    const b = this.bounds;
    const r = { x: b.x, y: b.y, w: Math.min(w, b.w), h: b.h };
    b.x += r.w + gap;
    b.w = Math.max(0, b.w - r.w - gap);
    return this.cut(r);
  }

  cutRight(w: number, gap = 0): Rect {
    const b = this.bounds;
    const r = { x: b.x + b.w - Math.min(w, b.w), y: b.y, w: Math.min(w, b.w), h: b.h };
    b.w = Math.max(0, b.w - r.w - gap);
    return this.cut(r);
  }

  /** Shrink the bounds by padding, CSS order: left, top, right, bottom. */
  inset(left: number, top = left, right = left, bottom = top): void {
    this.bounds = insetRect(this.bounds, left, top, right, bottom);
    this.keepCursorIn();
  }

  private cut(r: Rect): Rect {
    this.keepCursorIn();
    this.grow(r);
    return r;
  }

  private keepCursorIn() {
    this.cursor.x = Math.max(this.cursor.x, this.bounds.x);
    this.cursor.y = Math.max(this.cursor.y, this.bounds.y);
  }

  private grow(r: Rect) {
    this.reach.x = Math.max(this.reach.x, r.x + r.w);
    this.reach.y = Math.max(this.reach.y, r.y + r.h);
  }

  // ================================================================ input

  /**
   * Register `r` as interactive and ask what the pointer (and keyboard) did
   * to it. Things registered later are on top of things registered earlier.
   */
  interaction(r: Rect, opts: InteractionOptions = {}): Interaction {
    const ui = this.ui;
    const key = opts.key ?? `${this.key}/i${this.n.i++}`;
    const abs = intersect(this.abs(r), this.clipRect);
    ui.register({ key, rect: abs, layer: this.layer, click: opts.click ?? true, wheel: !!opts.wheel, hover: opts.hover ?? true, focusable: !!opts.focusable, text: !!opts.text });

    const ev = ui.events.get(key);
    const held = ui.active === key && ui.down;
    const hovered = held || (ui.active === null && ui.hovered === key && inside(abs, ui.pointer.x, ui.pointer.y));
    const releasedAt = ev?.releasedAt ?? null;
    const drag = held ? ui.pointer : releasedAt;
    if (hovered) {
      if (opts.cursor) ui.cursor = opts.cursor;
      if (opts.hint) ui.hint = opts.hint;
    }
    return {
      key,
      hovered,
      pressed: !!ev?.pressed,
      held,
      released: !!releasedAt,
      clicked: !!releasedAt && inside(abs, releasedAt.x, releasedAt.y),
      doubleClicked: ev?.pressed === true && ev.presses === 2,
      presses: ev?.pressed ? ev.presses : 0,
      dx: drag ? drag.x - ui.pressOrigin.x : 0,
      dy: drag ? drag.y - ui.pressOrigin.y : 0,
      focused: ui.focus === key,
      wheelX: ev?.wheelX ?? 0,
      wheelY: ev?.wheelY ?? 0,
    };
  }

  /**
   * Whole `unit`-pixel notches scrolled over an interaction (with `wheel:
   * true`) this frame, positive down (or right); the rest carries over to
   * the next frame, until scrolling pauses.
   */
  wheelSteps(it: Interaction, unit: number, axis: 'x' | 'y' = 'y'): number {
    const key = `w|${it.key}|${axis}`;
    const { value: s } = this.ui.slot(key, () => ({ rest: 0, last: -Infinity }));
    const d = axis === 'x' ? it.wheelX : it.wheelY;
    if (this.time - s.last > WHEEL_IDLE_MS) s.rest = 0;
    if (!d) return 0;
    s.last = this.time;
    s.rest += d;
    const n = Math.trunc(s.rest / unit);
    s.rest -= n * unit;
    return n;
  }

  /** The pointer, in local pixels (NaN when it's off the surface). */
  get pointer(): Point {
    return { x: this.ui.pointer.x - this.ox, y: this.ui.pointer.y - this.oy };
  }

  /** The primary button is down. */
  get pointerDown(): boolean {
    return this.ui.down;
  }

  get mods(): Modifiers {
    return this.ui.mods;
  }

  /** Is the pointer in `r`, with nothing in a higher layer over it? Unlike `hovered`, widgets in the same layer don't hide it. */
  containsPointer(r: Rect): boolean {
    const { x, y } = this.ui.pointer;
    return this.layer >= this.ui.topLayer && inside(intersect(this.abs(r), this.clipRect), x, y);
  }

  /** The pointer shape for this frame, when no hovered interaction set one. */
  setCursor(cursor: CursorStyle): void {
    this.ui.cursor = cursor;
  }

  /** The hint of whatever the pointer is over, so far this frame. */
  get hint(): string {
    return this.ui.hint;
  }

  set hint(text: string) {
    this.ui.hint = text;
  }

  // ---------------------------------------------------------------- focus

  focus(it: Interaction | string): void {
    this.ui.focus = typeof it === 'string' ? it : it.key;
  }

  blur(): void {
    this.ui.focus = null;
  }

  // ---------------------------------------------------------------- keys

  /**
   * An app-wide shortcut, e.g. 'Mod+Z', 'Space', 'F1': true (once) when it
   * was pressed this frame. Keys a focused text widget would want — typing,
   * editing, Mod+C and the like — are left to it.
   */
  shortcut(combo: KeyCombo, opts: { repeat?: boolean } = {}): boolean {
    if (this.keysCaptured) return false;
    const want = this.ui.canonical(combo);
    this.ui.shortcuts.add(want);
    if (this.ui.textFocused && isTypingCombo(want)) return false;
    return this.takeKey(want, opts);
  }

  /** Take a key press matching `combo` this frame, whatever has focus. For focused widgets. */
  takeKey(combo: KeyCombo, opts: { repeat?: boolean } = {}): boolean {
    if (this.keysCaptured) return false;
    const want = this.ui.canonical(combo);
    const k = this.ui.keys.find((e) => e.type === 'keydown' && !e.consumed && e.combo === want && (opts.repeat !== false || !e.repeat));
    if (k) k.consumed = true;
    return !!k;
  }

  /** This frame's key events nobody has taken yet, downs and ups. Set `consumed` on what you use. */
  keyEvents(): KeyEvent[] {
    return this.keysCaptured ? [] : this.ui.keys.filter((e) => !e.consumed);
  }

  /**
   * For modal things (menus, sheets): while this is called every frame, the
   * keyboard is theirs. Shortcuts and key events in lower layers get
   * nothing, from the next frame on.
   */
  captureKeyboard(): void {
    this.ui.keyLayer = Math.max(this.ui.keyLayer, this.layer);
  }

  private get keysCaptured(): boolean {
    return this.layer < this.ui.capturedBy;
  }

  /** Mod is Cmd, as on a Mac (and word-by-word caret moves use Alt), rather than Ctrl. */
  get mac(): boolean {
    return this.ui.mac;
  }

  /** A text widget has the keyboard focus: keys that would type are its, not shortcuts or a piano's. */
  get typing(): boolean {
    return this.ui.textFocused;
  }

  /** The window lost focus this frame: anything tracking held keys should let go. */
  get blurred(): boolean {
    return this.ui.blurred;
  }

  /**
   * For a focused text widget: say where its caret is (so input methods
   * pop up beside it) and what's selected (for copy), and take the text
   * typed, composed, pasted or cut since the last frame. Empty when it
   * doesn't have focus.
   */
  textInput(it: Interaction, state: { caret: Rect; selection: string }): TextEvent[] {
    if (!it.focused) return [];
    this.ui.textInput = { caret: intersect(this.abs(state.caret), this.clipRect), selection: state.selection };
    const events = this.ui.text;
    this.ui.text = [];
    return events;
  }

  // ================================================================ state

  /**
   * A key for a widget to build on: `explicit` if it's given one, else the
   * next by position. Name the widget's parts from it (`${id}:thumb`), so
   * parts it draws only sometimes don't shift the keys of what comes after.
   */
  makeKey(explicit?: string): string {
    return explicit ?? `${this.key}/k${this.n.k++}`;
  }

  /** An object that lives as long as it's asked for every frame. Mutate it freely. */
  state<T extends object>(init: () => T, opts: { key?: string } = {}): T {
    return this.ui.slot(`s|${opts.key ?? `${this.key}/s${this.n.s++}`}`, init).value;
  }

  /** A number that glides to `target` over time, the same speed at any frame rate. */
  animatedValue(target: number, opts: AnimationOptions = {}): number {
    const key = `a|${opts.key ?? `${this.key}/a${this.n.a++}`}`;
    const { value, again } = this.ui.slot(key, () => ({ v: opts.from ?? target }));
    if (!again) value.v = ease(value.v, target, this.dt, opts.snap ?? 0.001, opts.easing ?? EASE);
    if (value.v !== target) this.ui.animating = true;
    return value.v;
  }

  /** Something drawn is changing by itself: ask for another frame even if nothing happens. */
  requestFrame(): void {
    this.ui.animating = true;
  }

  // ================================================================ environment

  /** Pass `value` down: this region and regions made from it after this call see it. */
  provide<T>(token: Token<T>, value: T): void {
    if (!this.ownEnv) {
      this.env = new Map(this.env);
      this.ownEnv = true;
    }
    this.env.set(token as Token<unknown>, value);
  }

  use<T>(token: Token<T>): T {
    if (this.env.has(token as Token<unknown>)) return this.env.get(token as Token<unknown>) as T;
    if (token.fallback) return token.fallback(this);
    throw new Error(`synth-ui: nothing provides "${token.name}"`);
  }

  // ================================================================ drawing
  // Local coordinates, rounded to whole pixels. Colours are palette indices.

  fillRect(r: Rect, color: number, opts: FillOptions = {}): void {
    const a = this.abs(r);
    this.ui.backend.fill(this.layer, this.clipIndex, a.x, a.y, a.w, a.h, color, opts.pattern ?? SOLID);
  }

  /** A one-pixel outline just inside `r`. */
  strokeRect(r: Rect, color: number): void {
    const a = this.abs(r);
    this.ui.backend.stroke(this.layer, this.clipIndex, a.x, a.y, a.w, a.h, color);
  }

  hline(x: number, y: number, w: number, color: number, opts?: FillOptions): void {
    this.fillRect({ x, y, w, h: 1 }, color, opts);
  }

  vline(x: number, y: number, h: number, color: number, opts?: FillOptions): void {
    this.fillRect({ x, y, w: 1, h }, color, opts);
  }

  /** A line, both ends included. */
  line(x0: number, y0: number, x1: number, y1: number, color: number): void {
    this.ui.backend.line(this.layer, this.clipIndex, this.ox + Math.round(x0), this.oy + Math.round(y0), this.ox + Math.round(x1), this.oy + Math.round(y1), color);
  }

  circle(cx: number, cy: number, r: number, color: number): void {
    this.ui.backend.circle(this.layer, this.clipIndex, this.ox + Math.round(cx), this.oy + Math.round(cy), Math.round(r), color, false);
  }

  fillCircle(cx: number, cy: number, r: number, color: number): void {
    this.ui.backend.circle(this.layer, this.clipIndex, this.ox + Math.round(cx), this.oy + Math.round(cy), Math.round(r), color, true);
  }

  pixel(x: number, y: number, color: number): void {
    this.ui.backend.pixel(this.layer, this.clipIndex, this.ox + Math.round(x), this.oy + Math.round(y), color);
  }

  /** A 1-bit image in one colour, its top left at (x, y). */
  bitmap(image: Bitmap, x: number, y: number, color: number, opts: { scale?: number } = {}): void {
    this.ui.backend.bitmap(this.layer, this.clipIndex, image, this.ox + Math.round(x), this.oy + Math.round(y), color, opts.scale ?? 1);
  }

  /** A line of text, its top left at (x, y). Returns the x where the next text would follow on. */
  text(text: string, x: number, y: number, style: TextStyle): number {
    const { backend } = this.ui;
    const font = style.font ?? backend.defaultFont;
    const scale = style.scale ?? 1;
    if (!text) return Math.round(x);
    const width = backend.measureText(text, font, scale);
    backend.text(this.layer, this.clipIndex, font, text, this.ox + Math.round(x), this.oy + Math.round(y), style.color, scale);
    return Math.round(x) + width + backend.fontMetrics(font).spacing * scale;
  }

  /** A text layout, its box's top left at (x, y): backgrounds, then glyphs, then underlines. */
  drawText(layout: TextLayout, x: number, y: number): void {
    const [ox, oy] = [Math.round(x), Math.round(y)];
    for (const r of layout.runs) if (r.background !== undefined) this.fillRect({ ...r.box, x: ox + r.box.x, y: oy + r.box.y }, r.background);
    for (const r of layout.runs) {
      this.ui.backend.text(this.layer, this.clipIndex, layout.font, r.text, this.ox + ox + r.rect.x, this.oy + oy + r.rect.y, r.color, layout.scale);
    }
    for (const r of layout.runs) if (r.underline !== undefined && r.rect.w > 0) this.hline(ox + r.rect.x, oy + r.rect.y + r.rect.h + 1, r.rect.w, r.underline);
  }

  /** Rework what's drawn in `r` through a colour map: washes, fades, tints. */
  remap(r: Rect, map: ColorMap, opts: FillOptions = {}): void {
    const a = this.abs(r);
    this.ui.backend.remap(this.layer, this.clipIndex, a.x, a.y, a.w, a.h, map, opts.pattern ?? SOLID);
  }

  /**
   * Rework what's drawn in `r` so far, pixel by pixel: fade the edge of a
   * scroll view into the background, dissolve, vignette, tint by degrees.
   * See `FilterOptions`, `ramp()` and `radial()`.
   */
  filter(r: Rect, opts: FilterOptions): void {
    const a = this.abs(r);
    const { field, maps, blend } = resolveFilter(a, opts, this.ui.palette);
    this.ui.backend.filter(this.layer, this.clipIndex, a.x, a.y, a.w, a.h, field, maps, blend);
  }

  /** Pixelate what's drawn in `r` into `size`-pixel blocks. */
  mosaic(r: Rect, size: number): void {
    const a = this.abs(r);
    this.ui.backend.mosaic(this.layer, this.clipIndex, a.x, a.y, a.w, a.h, Math.floor(size));
  }

  // ---------------------------------------------------------------- text

  /** A font is registered as `name`. */
  hasFont(name: string): boolean {
    return this.ui.hasFont(name);
  }

  /** What the font named (or the default font) measures, at scale 1. */
  fontMetrics(font?: string): FontMetrics {
    return this.ui.fontMetrics(font);
  }

  /** Width of `text` in pixels, without trailing spacing. */
  measureText(text: string, style: Omit<TextStyle, 'color'> = {}): number {
    return this.ui.measureText(text, style);
  }

  /** Set `text` in a box, to draw with `drawText()` or to find where its characters are. */
  layoutText(text: AttributedText, opts?: TextLayoutOptions): TextLayout {
    return this.ui.layoutText(text, opts);
  }

  // ---------------------------------------------------------------- helpers

  private abs(r: Rect): Rect {
    return { x: this.ox + Math.round(r.x), y: this.oy + Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
  }
}
