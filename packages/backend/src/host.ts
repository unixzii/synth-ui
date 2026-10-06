// A synth-ui view on a canvas. The Rust backend (crates/backend-web) runs
// the view: it listens to the page, decides when a frame is due, and calls
// back here to paint it, then rasterizes what was drawn and shows it through
// a simulated CRT on WebGPU (or WebGL2 where there's none). Painting runs the
// core's UI with the app's paint function, drawing through `WasmBackend`.

import { UI, type Context, type FontSet, type FrameInput, type Palette } from '@synth-ui/core';
import init, { WebViewHost } from '../pkg/synth_backend_web.js';
import { WasmBackend } from './backend.js';
import { DEFAULT_FX, type PostFx } from './fx.js';

export type ScreenMode =
  /** Always this many virtual pixels, scaled to fit and letterboxed. */
  | { resolution: { width: number; height: number } }
  /** Each virtual pixel this many CSS pixels; the resolution follows the canvas's size. */
  | { pixelScale: number };

export type ViewHostOptions = ScreenMode & {
  palette: Palette;
  /** The faces text can be set in, by name, e.g. the widgets' THEME_FONTS. */
  fonts: FontSet;
  /** The font used when none is named. Default the first in `fonts`. */
  defaultFont?: string;
  /** Index the frame is cleared to; also the letterbox colour. Default 0. */
  background?: number;
  /** The CRT to start with. Default `DEFAULT_FX`. */
  fx?: PostFx;
  /**
   * 'always' draws every animation frame, for UIs showing something live;
   * 'auto' only when there's input, something animating, a resize, or `invalidate()`.
   */
  redraw?: 'always' | 'auto';
  /** An accessible name for the canvas. */
  label?: string;
};

export class ViewHost {
  /** The CRT, changeable at any time: it's read after every frame. */
  fx: PostFx;

  /** @internal */
  constructor(
    private readonly native: WebViewHost,
    readonly ui: UI,
    fx: PostFx,
  ) {
    this.fx = fx;
  }

  get palette(): Palette {
    return this.ui.palette;
  }

  set palette(p: Palette) {
    this.ui.palette = p;
    this.invalidate();
  }

  /** Whether burn-in can show here: it needs a GPU that renders to half-float targets. */
  get wears(): boolean {
    return this.native.wears;
  }

  /** Something the UI shows changed: draw a frame even in 'auto' mode. */
  invalidate(): void {
    this.native.invalidate();
  }

  /** Start drawing again after `stop()`. */
  start(): void {
    this.native.start();
  }

  /** Stop drawing frames until `start()`. */
  stop(): void {
    this.native.stop();
  }

  /** Stop for good, and let go of the page: its listeners, and the GPU. */
  destroy(): void {
    this.native.destroy();
  }
}

/**
 * A view on `canvas`, painted by `paint` whenever the backend decides a frame
 * is due. It starts running once ready. The canvas fills its box unless the
 * page sizes it; its pixels follow the box's size in device pixels.
 */
export async function createViewHost(canvas: HTMLCanvasElement, paint: (ctx: Context) => void, opts: ViewHostOptions): Promise<ViewHost> {
  await init();
  let frame = (_: FrameInput): unknown => null;
  const screen = 'pixelScale' in opts ? { pixelScale: opts.pixelScale } : { resolution: opts.resolution };
  const native = await WebViewHost.create(canvas, (input: FrameInput) => frame(input), faces(opts.fonts), {
    ...screen,
    background: opts.background ?? 0,
    redraw: opts.redraw ?? 'always',
    defaultFont: opts.defaultFont,
    label: opts.label,
  });
  const backend = new WasmBackend(native.draw());
  const ui = new UI({ palette: opts.palette, backend, background: opts.background, mac: native.mac });
  const host = new ViewHost(native, ui, structuredClone(opts.fx ?? DEFAULT_FX));
  frame = (input) => {
    backend.beginFrame(ui.palette);
    const out = ui.frame(input, paint);
    return { cursor: out.cursor, hint: out.hint, textInput: out.textInput, shortcuts: [...out.shortcuts], animating: out.animating, fx: host.fx };
  };
  native.start();
  return host;
}

/** A font set as the backend reads it: `[name, face]` pairs, glyphs and aliases as pairs too, in order. */
function faces(fonts: FontSet): unknown {
  return Object.entries(fonts).map(([name, face]) => {
    if (face.kind !== 'bitmap') throw new Error(`synth-ui: the font "${name}" is a ${(face as { kind: string }).kind} face, which this backend can't draw`);
    return [name, { glyphs: Object.entries(face.glyphs), spacing: face.spacing, fallback: face.fallback, aliases: Object.entries(face.aliases ?? {}), caps: face.caps ?? false }];
  });
}
