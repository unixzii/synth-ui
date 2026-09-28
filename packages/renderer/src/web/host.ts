// The web renderer: a canvas on the page, the frame loop, and the glue
// between the browser and the core. Each frame it hands the UI the events
// since the last one, rasterizes the Scene that comes back into an indexed
// surface, and presents it through WebGL (a simulated CRT) or Canvas 2D.

import { UI, type Context, type FontSet, type Palette } from '@synth-ui/core';
import { FontRegistry } from '../raster/font.js';
import { rasterize } from '../raster/rasterize.js';
import { Surface } from '../raster/surface.js';
import { createBackend, DEFAULT_FX, type PixelBackend, type PostFx } from './backend.js';
import { DomEvents } from './events.js';
import { WebScreen, type ScreenMode } from './screen.js';

export type WebHostOptions = ScreenMode & {
  palette: Palette;
  /** The faces text can be set in, by name, e.g. the widgets' THEME_FONTS. */
  fonts: FontSet;
  /** The font used when none is named. Default the first in `fonts`. */
  defaultFont?: string;
  /** Index the frame is cleared to; also the letterbox colour. Default 0. */
  background?: number;
  fx?: PostFx;
  /**
   * 'always' draws every animation frame, for UIs showing something live;
   * 'auto' only when there's input, something animating, a resize, or `invalidate()`.
   */
  redraw?: 'always' | 'auto';
  /** An accessible name for the canvas. */
  label?: string;
};

export class WebHost {
  readonly ui: UI;
  readonly fonts: FontRegistry;
  readonly screen: WebScreen;
  readonly backend: PixelBackend;
  /** The CRT, changeable at any time. */
  fx: PostFx;
  private readonly surface = new Surface();
  private readonly events: DomEvents;
  private readonly redraw: 'always' | 'auto';
  private raf = 0;
  private dirty = true;
  private animating = false;
  /** Until when to keep drawing in 'auto' mode, while the phosphors fade. */
  private settleUntil = 0;
  private cursor = '';

  constructor(parent: HTMLElement, opts: WebHostOptions) {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    this.fonts = new FontRegistry(opts.fonts, opts.defaultFont);
    this.ui = new UI({ palette: opts.palette, fonts: this.fonts, background: opts.background, mac });
    this.screen = new WebScreen(parent, opts);
    this.screen.el.style.background = opts.palette.hex(opts.background ?? 0);
    this.screen.canvas.setAttribute('role', 'application');
    if (opts.label) this.screen.canvas.setAttribute('aria-label', opts.label);
    this.backend = createBackend(this.screen.canvas);
    this.events = new DomEvents(this.screen, mac);
    this.fx = structuredClone(opts.fx ?? DEFAULT_FX);
    this.redraw = opts.redraw ?? 'always';
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.backend.suspend();
    });
  }

  /** Whether the backend can run post-processing at all. */
  get effects(): boolean {
    return this.backend.effects;
  }

  get palette(): Palette {
    return this.ui.palette;
  }

  set palette(p: Palette) {
    this.ui.palette = p;
    this.invalidate();
  }

  /** Draw with `paint` every frame until `stop()`. */
  run(paint: (ctx: Context) => void): void {
    this.stop();
    const tick = (time: number) => {
      this.raf = requestAnimationFrame(tick);
      const needed = this.dirty || this.animating || this.events.pending || this.screen.resized;
      if (this.redraw === 'auto' && !needed && time >= this.settleUntil) return;
      this.frame(paint, time);
      // Something new was drawn: it fades in and out over the next frames.
      if (needed) this.settleUntil = time + this.backend.afterglow(this.fx);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  /** A fresh tube: forget the burn-in. */
  clearBurnIn(): void {
    this.backend.clearBurnIn();
    this.invalidate();
  }

  /** Something the UI shows changed: draw a frame even in 'auto' mode. */
  invalidate(): void {
    this.dirty = true;
  }

  /** Draw one frame now. */
  frame(paint: (ctx: Context) => void, time = performance.now()): void {
    const { screen } = this;
    screen.sync();
    screen.resized = false;
    this.dirty = false;
    const out = this.ui.frame({ width: screen.width, height: screen.height, time, events: this.events.drain() }, paint);
    this.animating = out.animating;
    rasterize(out.scene, this.surface, this.fonts);
    if (screen.out.w && screen.out.h) this.backend.present(this.surface, out.scene.palette, screen.out, this.fx, time);
    if (out.cursor !== this.cursor) this.screen.canvas.style.cursor = this.cursor = out.cursor;
    this.events.update(out.textInput, out.shortcuts);
  }
}

export function createWebHost(parent: HTMLElement, opts: WebHostOptions): WebHost {
  return new WebHost(parent, opts);
}
