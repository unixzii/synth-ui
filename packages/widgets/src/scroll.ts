// Scroll views: a clipped window onto content that can be bigger than it.
// Scrolling glides (by time, like every animation here), optionally in whole
// steps (rows, channels); the wheel, a trackpad swipe or the scrollbar move
// it, and edges with more beyond them can fade out. The content is drawn
// into a region offset by the scroll, every frame; its size is given, or
// measured from what it laid out the frame before.

import { ease, ramp, type Context, type Point, type Rect, type Size } from '@synth-ui/core';
import { useTheme } from './theme.js';

export interface ScrollProps {
  /** A global key, so the scroll position follows the view wherever it's drawn. */
  key?: string;
  /** Default 'y'. With 'x', the vertical wheel scrolls sideways too. */
  axis?: 'x' | 'y' | 'both';
  /** The content's size, when it's known (a list's rows); otherwise it's measured. */
  content?: Partial<Size>;
  /** Scroll in whole multiples of this: rows, columns. */
  snap?: number;
  /** Wheel travel per snap step. Default 40. */
  wheelUnit?: number;
  /** Show a scrollbar while the content overflows. Default true. */
  scrollbar?: boolean;
  /** Fade this many pixels at an edge with more beyond it. Default 0. */
  fade?: number;
  /** What edges fade into. Default the theme's background. */
  fadeTo?: number;
}

export interface Scroll {
  /** Where the content is scrolled to this frame. */
  readonly x: number;
  readonly y: number;
  /** Where it's heading. */
  readonly target: Point;
  readonly viewport: Size;
  /** The content's size, as given or as last measured. */
  readonly content: Size;
  /** The furthest it scrolls. */
  readonly max: Point;
  /** Glide (or jump) to an offset; either coordinate may be left out. */
  scrollTo(to: Partial<Point>, opts?: { instant?: boolean }): void;
  /** Scroll just enough to show `r` (content coordinates). */
  reveal(r: Rect): void;
}

const BAR = 3;
/** The shortest a thumb gets, however long the content: short enough to show position, long enough to grab. */
const MIN_THUMB = 16;
/** Extra room either side of the thumb, across the bar, that still grabs it. */
const GRAB = 2;

/** A scroll view, filling `rect` or the rest of the region; `fn` draws the content into a region offset by the scroll. */
export function scrollView<T>(ctx: Context, props: ScrollProps, fn: (content: Context, scroll: Scroll) => T, rect?: Rect): T {
  const { colors: c } = useTheme(ctx);
  const b = ctx.bounds;
  const r = rect ?? ctx.place({ w: b.x + b.w - ctx.cursor.x, h: b.y + b.h - ctx.cursor.y });
  const axis = props.axis ?? 'y';
  const onX = axis !== 'y';
  const onY = axis !== 'x';
  const id = ctx.makeKey(props.key);
  const k = (part: string) => `${id}:${part}`;
  const s = ctx.state(() => ({ at: { x: 0, y: 0 }, to: { x: 0, y: 0 }, content: { w: 0, h: 0 }, dragFrom: null as number | null }), { key: k('state') });

  // The wheel goes to the view unless something inside takes it: register it first, under the content.
  const area = ctx.interaction(r, { key: k('wheel'), click: false, wheel: true });

  // Scrollbars take room from the viewport while the content overflows it (as it did last frame).
  const content = { w: props.content?.w ?? s.content.w, h: props.content?.h ?? s.content.h };
  const bars = props.scrollbar ?? true;
  const barY = bars && onY && content.h > r.h;
  const barX = bars && onX && content.w > r.w - (barY ? BAR + 1 : 0);
  const vp = { w: r.w - (barY ? BAR + 1 : 0), h: r.h - (barX ? BAR + 1 : 0) };
  const snap = props.snap ?? 0;
  const limit = (size: number, view: number) => {
    const m = Math.max(0, size - view);
    return snap ? Math.ceil(m / snap) * snap : m;
  };
  const max = { x: onX ? limit(content.w, vp.w) : 0, y: onY ? limit(content.h, vp.h) : 0 };
  const clampTo = () => {
    s.to.x = Math.min(max.x, Math.max(0, s.to.x));
    s.to.y = Math.min(max.y, Math.max(0, s.to.y));
  };

  // The wheel: whole steps when snapping, else pixel for pixel.
  if (snap) {
    const unit = props.wheelUnit ?? 40;
    if (axis === 'x') s.to.x += (ctx.wheelSteps(area, unit, 'x') + ctx.wheelSteps(area, unit, 'y')) * snap;
    else {
      s.to.y += ctx.wheelSteps(area, unit, 'y') * snap;
      if (onX) s.to.x += ctx.wheelSteps(area, unit, 'x') * snap;
    }
  } else if (axis === 'x') s.to.x += area.wheelX + area.wheelY;
  else {
    s.to.y += area.wheelY;
    if (onX) s.to.x += area.wheelX;
  }
  clampTo();

  const scroll: Scroll = {
    get x() {
      return Math.round(s.at.x);
    },
    get y() {
      return Math.round(s.at.y);
    },
    get target() {
      return { ...s.to };
    },
    viewport: vp,
    content,
    max,
    scrollTo(to, opts = {}) {
      if (to.x !== undefined) s.to.x = to.x;
      if (to.y !== undefined) s.to.y = to.y;
      clampTo();
      if (opts.instant) s.at = { ...s.to };
    },
    reveal(t) {
      const fit = (lo: number, hi: number, at: number, view: number) => {
        if (lo < at) return snap ? Math.floor(lo / snap) * snap : lo;
        if (hi > at + view) return snap ? Math.ceil((hi - view) / snap) * snap : hi - view;
        return at;
      };
      scroll.scrollTo({ x: onX ? fit(t.x, t.x + t.w, s.to.x, vp.w) : undefined, y: onY ? fit(t.y, t.y + t.h, s.to.y, vp.h) : undefined });
    },
  };

  // Glide, however it's moved: wheel, keys, reveal, or dragging the scrollbar.
  const glide = (from: number, to: number) => ease(from, to, ctx.dt, 0.5, 0.25);
  s.at = { x: glide(s.at.x, s.to.x), y: glide(s.at.y, s.to.y) };
  if (s.at.x !== s.to.x || s.at.y !== s.to.y) ctx.requestFrame();

  const view = ctx.region({ x: r.x, y: r.y, w: vp.w, h: vp.h }, { clip: true, key: k('view') });
  const offset = {
    x: -scroll.x,
    y: -scroll.y,
    w: props.content?.w ?? (onX ? Math.max(vp.w, content.w) : vp.w),
    h: props.content?.h ?? (onY ? Math.max(vp.h, content.h) : vp.h),
  };
  const inner = view.region(offset, { key: k('content') });
  const out = fn(inner, scroll);
  s.content = { w: props.content?.w ?? inner.extent.w, h: props.content?.h ?? inner.extent.h };

  // Fade the edges that have more beyond them, more strongly the more there is.
  const fade = props.fade ?? 0;
  if (fade > 0) {
    const to = props.fadeTo ?? c.bg;
    const edge = (side: 'top' | 'bottom' | 'left' | 'right', beyond: number) => {
      if (beyond < 0.5) return;
      const f = Math.min(fade, side === 'top' || side === 'bottom' ? vp.h : vp.w);
      const band = { top: { x: 0, y: 0, w: vp.w, h: f }, bottom: { x: 0, y: vp.h - f, w: vp.w, h: f }, left: { x: 0, y: 0, w: f, h: vp.h }, right: { x: vp.w - f, y: 0, w: f, h: vp.h } }[side];
      view.filter(band, { to, strength: ramp(side, 0, Math.min(1, beyond / fade)) });
    };
    if (onY) {
      edge('top', s.at.y);
      edge('bottom', max.y - s.at.y);
    }
    if (onX) {
      edge('left', s.at.x);
      edge('right', max.x - s.at.x);
    }
  }

  // Scrollbars: a thin track and a thumb you can drag; clicking the track pages.
  const bar = (along: 'x' | 'y') => {
    const vertical = along === 'y';
    const track = vertical ? { x: r.x + r.w - BAR, y: r.y, w: BAR, h: vp.h } : { x: r.x, y: r.y + r.h - BAR, w: vp.w, h: BAR };
    const len = vertical ? track.h : track.w;
    const size = vertical ? content.h : content.w;
    const span = vertical ? vp.h : vp.w;
    const thumbLen = Math.min(len, Math.max(MIN_THUMB, Math.round((len * span) / Math.max(size, 1))));
    // Dragged, the thumb stays under the pointer (where it's heading), and the content glides after it.
    const pos = s.dragFrom !== null ? s.to[along] : s.at[along];
    const at = max[along] ? Math.round(((len - thumbLen) * pos) / max[along]) : 0;
    const thumb = vertical ? { ...track, y: track.y + at, h: thumbLen } : { ...track, x: track.x + at, w: thumbLen };
    const ti = ctx.interaction(track, { key: k(`track-${along}`) });
    const grab = vertical ? { ...thumb, x: thumb.x - GRAB, w: thumb.w + GRAB * 2 } : { ...thumb, y: thumb.y - GRAB, h: thumb.h + GRAB * 2 };
    const hi = ctx.interaction(grab, { key: k(`thumb-${along}`) });
    if (ti.clicked) {
      const p = vertical ? ctx.pointer.y - track.y : ctx.pointer.x - track.x;
      scroll.scrollTo({ [along]: s.to[along] + (p < at ? -1 : 1) * span });
    }
    if (hi.pressed) s.dragFrom = s.to[along];
    // Released counts too: the last of a quick drag can arrive with the release.
    if ((hi.held || hi.released) && s.dragFrom !== null) {
      const moved = ((vertical ? hi.dy : hi.dx) * max[along]) / Math.max(1, len - thumbLen);
      scroll.scrollTo({ [along]: s.dragFrom + moved });
    }
    if (hi.released) {
      s.dragFrom = null;
      if (snap) scroll.scrollTo({ [along]: Math.round(s.to[along] / snap) * snap });
    }
    if (vertical) ctx.vline(track.x + 1, track.y, track.h, c.line);
    else ctx.hline(track.x, track.y + 1, track.w, c.line);
    ctx.fillRect(thumb, hi.held ? c.muted : hi.hovered ? c.slate : c.dim);
  };
  if (barY) bar('y');
  if (barX) bar('x');
  return out;
}
