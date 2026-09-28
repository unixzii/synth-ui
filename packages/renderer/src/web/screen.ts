// Where the pixels go on the page. Either a fixed virtual resolution scaled
// to fit the element and letterboxed (the layout always has the same pixels
// to work with; only how big they are changes), or a fixed pixel size with
// as many pixels as fit. Scales needn't be whole numbers: the WebGL backend
// keeps pixel edges sharp at any size.

import type { Rect } from '@synth-ui/core';

export type ScreenMode =
  /** Always this many virtual pixels, scaled to fit and letterboxed. */
  | { resolution: { width: number; height: number } }
  /** Each virtual pixel this many CSS pixels; the resolution follows the element's size. */
  | { pixelScale: number };

export class WebScreen {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  /** The virtual resolution this frame. */
  width = 0;
  height = 0;
  /** Device pixels per virtual pixel (not necessarily whole). */
  scale = 1;
  /** Size of the output in device pixels. */
  out = { w: 0, h: 0 };
  /** Set when the size changed since it was last cleared. */
  resized = true;
  private devSize = { w: 0, h: 0 };
  private dpr = 0;

  constructor(
    parent: HTMLElement,
    private readonly mode: ScreenMode,
  ) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, { position: 'relative', width: '100%', height: '100%', overflow: 'hidden' });
    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, { position: 'absolute', display: 'block', touchAction: 'none', userSelect: 'none', webkitUserSelect: 'none' });
    this.el.append(this.canvas);
    parent.append(this.el);
    if ('resolution' in mode) {
      this.width = mode.resolution.width;
      this.height = mode.resolution.height;
    }

    new ResizeObserver(([entry]) => {
      const dpr = window.devicePixelRatio || 1;
      const css = { w: Math.round(entry.contentRect.width * dpr), h: Math.round(entry.contentRect.height * dpr) };
      // The exact device-pixel size when the browser reports it (and it agrees
      // with CSS size × DPR; emulated DPRs don't always), else the estimate.
      const box = entry.devicePixelContentBoxSize?.[0];
      const exact = box && Math.abs(box.inlineSize - css.w) <= 2 && Math.abs(box.blockSize - css.h) <= 2;
      this.devSize = exact ? { w: box.inlineSize, h: box.blockSize } : css;
      this.layout();
    }).observe(this.el);
  }

  /** Call once per frame before drawing; picks up display changes the observer can't see. */
  sync(): void {
    if ((window.devicePixelRatio || 1) === this.dpr) return;
    const rect = this.el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.devSize = { w: Math.round(rect.width * dpr), h: Math.round(rect.height * dpr) };
    this.layout();
  }

  /** Fit the canvas into the element, centred on whole device pixels. */
  private layout(): void {
    const { w, h } = this.devSize;
    this.dpr = window.devicePixelRatio || 1;
    if (!w || !h) return;
    if ('pixelScale' in this.mode) {
      this.scale = this.mode.pixelScale * this.dpr;
      this.width = Math.max(1, Math.floor(w / this.scale));
      this.height = Math.max(1, Math.floor(h / this.scale));
    } else {
      this.scale = Math.min(w / this.width, h / this.height);
    }
    this.out = { w: Math.min(w, Math.round(this.width * this.scale)), h: Math.min(h, Math.round(this.height * this.scale)) };
    const s = this.canvas.style;
    s.width = `${this.out.w / this.dpr}px`;
    s.height = `${this.out.h / this.dpr}px`;
    s.left = `${Math.floor((w - this.out.w) / 2) / this.dpr}px`;
    s.top = `${Math.floor((h - this.out.h) / 2) / this.dpr}px`;
    this.resized = true;
  }

  /** Client (CSS) coordinates → virtual pixels. */
  toVirtual(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * this.width, y: ((clientY - r.top) / r.height) * this.height };
  }

  /** A virtual rectangle → CSS pixels relative to the screen element (for DOM overlays). */
  toCss(r: Rect): { left: number; top: number; width: number; height: number } {
    const k = this.scale / this.dpr;
    const left = parseFloat(this.canvas.style.left) || 0;
    const top = parseFloat(this.canvas.style.top) || 0;
    return { left: left + r.x * k, top: top + r.y * k, width: r.w * k, height: r.h * k };
  }
}
