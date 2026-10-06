# synth-ui

A TypeScript library for building pixel-art user interfaces. Everything is
drawn at a low resolution, in whole pixels and from a small palette, the way
8-bit hardware drew, and then shown on screen with an optional CRT glow and
scanlines. The UI is written in immediate mode: each frame, plain code draws
the whole interface and asks each control what happened to it, so there are
no widget objects to create, update or keep in sync with the app's data.

It comes with a set of controls suited to tools and instruments (buttons,
knobs, sliders, text fields, lists, menus, sheets) in a warm, retro look:
warm greys, one orange accent, and bloom on what's lit. [Synthez](https://synthez.cy4n.dev),
for example, draws its whole interface with it.

## What's in the repository

```
packages/
  core/          the immediate-mode UI: regions, layout, input, state, animation, palettes
  backend/       hosts a UI on a web page, drawn by the Rust backend (WebAssembly)
  widgets/       the theme, icons and controls
crates/
  backend/       the backend, platform-neutral: rasterizer, fonts, the CRT, the view host
  backend-web/   the web host: a canvas, the browser's events and frame clock
apps/
  demo/          a playground with a page per group of controls
```

Each package is published as `@synth-ui/<name>`, each crate as `synth-<name>`; see
[Packages and platforms](#packages-and-platforms) for how they fit together.

## Features

- **Immediate mode.** The draw code is the UI. Controls return what happened
  (clicked, the new value, the text typed) instead of taking callbacks.
- **Real pixels.** Rendering is to an 8-bit indexed surface: colours are
  palette indices, and fades, tints and shadows are colour maps with ordered
  dither. Filters (ramps, vignettes), mosaic and remapping work on what's
  already drawn.
- **A CRT look.** The GPU simulates the tube, through wgpu (WebGPU on the
  web, or WebGL2 where there's none): scanlines, a phosphor mask, bloom and
  halation where it's bright, phosphor persistence, even burn-in.
- **Layout without a layout engine.** Rows, columns, cuts and insets carve
  up the screen; any region can clip, and scroll views measure their content.
- **Complete input.** Layers and overlays for menus and modals, focus and
  Tab, keyboard shortcuts with a portable `Mod`, the mouse wheel, drags, and
  text editing with selection, undo, the clipboard and IME.
- **State and animation built in.** Per-control state that lives while it's
  drawn, and values that glide over time rather than per frame.
- **Portable.** The core and the controls don't touch the DOM, and the
  backend is Rust: rasterizer, fonts and CRT are platform-neutral, and only
  a small host per platform isn't.

## Controls

- **Buttons:** `button`, `iconButton`, `textButton`
- **Choices:** `checkbox`, `chipGroup`, `segmented`, `dropdown`, `tabs`
- **Values:** `knob`, `slider`, `stepper`, `scrubValue`
- **Text:** `label`, `textField`
- **Containers:** `card`, `scrollView`, `list`, `sheet`
- **Popups and hints:** `menu`, `tooltip`, `statusLine`

Each control's doc comment and props describe how to use it.

## Using it

### Installing

```bash
npm install @synth-ui/core @synth-ui/widgets @synth-ui/backend
```

The packages are ES modules only. `@synth-ui/backend` loads its WebAssembly
with `new URL(…, import.meta.url)`, which bundlers such as Vite and webpack 5
pick up and emit on their own.

### A frame

```ts
import { Palette } from '@synth-ui/core';
import { createViewHost } from '@synth-ui/backend';
import { THEME_COLORS, THEME_FONTS, button, useTheme } from '@synth-ui/widgets';

const palette = new Palette([...THEME_COLORS /*, the app's own colours */]);
const fonts = { ...THEME_FONTS /*, the app's own faces */ };
const canvas = document.querySelector('canvas')!;
let count = 0;

const host = await createViewHost(canvas, (ctx) => {
  const { colors: c } = useTheme(ctx);
  ctx.fillRect(ctx.bounds, c.bg);
  ctx.inset(10);
  ctx.row({ gap: 3, h: 11 }, (row) => {
    if (button(row, { label: '-' }).clicked) count--;
    row.text(String(count), row.cursor.x, 2, { color: c.paper });
    row.cursor.x += 20;
    if (button(row, { label: '+' }).clicked) count++;
  });
}, { palette, fonts, resolution: { width: 480, height: 300 } });
```

Every frame draws the whole UI and asks each widget, as it's drawn, what
happened to it. There are no widget objects: the draw code is the UI.

The host decides when a frame is due (every display refresh, or with
`redraw: 'auto'` only when something changed) and calls the paint function
then. `host.fx` is the CRT, changeable at any time; `host.palette` can be
swapped; `stop()`, `start()` and `destroy()` control the host itself.

### Regions and layout

A `Context` is a region: its own origin, `bounds` (local, starting at 0, 0)
and a `cursor`. Coordinates are whole virtual pixels; rects are `{x, y, w, h}`.

- `ctx.allocate(rect, fn, opts?)` runs `fn` in a child region at `rect`,
  and returns what `fn` returns. Given only a size `{w, h}`, it's placed by
  the parent's flow, like a widget. `ctx.region(rect, opts?)` hands the
  child region back instead.
- `ctx.row(opts?, fn)` / `ctx.column(opts?, fn)`: a child region from the
  cursor to the far edges whose `place()` flows across or down, with `gap`
  and `align` (`start`, `center`, `end`, `stretch`). The parent then
  advances past what it used.
- `ctx.cutTop(h, gap?)`, `cutBottom`, `cutLeft`, `cutRight` take a strip
  off the bounds and return it; `ctx.inset(l, t, r, b)` pads them.
- `ctx.place({w, h})` takes the next rect from the flow and advances.
- `ctx.extent` is how far what's been placed, cut or allocated reaches: a
  scroll view measures its content with it.
- Options: `clip: true` clips drawing and hit testing to the region; `key`
  gives it a global key (see below). `ctx.clip(rect, fn)` clips without
  moving the origin.

Widgets take an optional rect: `button(ctx, props, rect?)`. With one, it
goes exactly there; without, it takes its natural size from `place()`.

### Input

`ctx.interaction(rect, opts?)` registers a rect and returns what the
pointer and keyboard did to it this frame: `hovered`, `pressed`, `held`,
`released`, `clicked`, `doubleClicked`, drag `dx`/`dy`, `focused`, and
`wheelX`/`wheelY`.

- **What's on top wins.** Presses, hover and scrolling go to the topmost
  rect under the pointer: the highest layer, and within it the one
  registered last (drawn last, so on top). Routing uses the previous
  frame's rects, so a widget sees the answer as soon as it asks.
- **Clipping applies**: the part of a rect outside its region's clip isn't
  there for the pointer.
- **Senses**: `click` (default on; also blocks presses from what's under it
  in the same layer), `wheel` (off: scrolling passes through to something
  that takes it), `hover` (on; off for a catcher laid over widgets that keep
  their hover), `focusable`, `text`. A press gives the focus to the
  topmost focusable thing under it, so pressing a row in a list focuses the
  list; pressing anything else takes the focus away.
- `ctx.overlay(fn)` draws a region in the layer above, in the same
  coordinates, unclipped. Wherever it registers interactions it covers
  everything below for every sense: modals, popups, menus.
- `ctx.containsPointer(rect)`: the pointer is in `rect` and no higher layer
  covers it, even if a widget in the same layer does (to light a row while
  the pointer is on a button in it).
- `ctx.wheelSteps(it, unit, axis?)`: whole notches, the rest carried over.
- `opts.cursor` and `opts.hint` set the pointer shape and `ctx.hint` (for a
  status line) while hovered.

Keys follow the W3C `key`/`code` names. `ctx.shortcut('Mod+Z')` fires once
when pressed (`Mod` is Cmd on a Mac, Ctrl elsewhere); while a text widget has
focus, keys it wants (typing, editing keys, Mod+A/C/V/X/Y/Z) are left to it.
Shift is ignored with symbols, since which symbols need it depends on the
layout. `ctx.takeKey(combo)` takes a key whatever has focus;
`ctx.keyEvents()` lists the raw downs and ups. Tab moves focus between
`focusable` widgets. While a menu or sheet calls `ctx.captureKeyboard()`
each frame, keys don't reach anything in the layers below it. `ctx.typing`
says a text widget has the focus, for anything else listening to raw keys
(a computer-keyboard piano, say).

Text arrives through `ctx.textInput(it, { caret, selection })`: a focused
text widget says where its caret is and what's selected, and takes the text
typed, composed (IME), pasted or cut since the last frame. Key and text
events carry a `seq`, to apply them in the order they came. On the web, a
hidden textarea is the source of those events only; caret, selection,
editing and undo all live in the widget.

### State and keys

- `ctx.state(() => init)` returns the same object every frame; mutate it.
- `ctx.animatedValue(target, { easing, snap, from })` glides towards
  `target`, driven by time, not frames.
- **Automatic keys** come from the call's position: the nth interaction (or
  state, or animated value) in a region gets the nth key under the region's
  key. A widget drawn only sometimes shifts the keys after it, but only
  within its own region.
- **An explicit `key`** (on `allocate`, `interaction`, `state`,
  `animatedValue`) is global. Whatever is drawn under it keeps its state
  wherever it's drawn: rows of a list that can be reordered, a component
  that moves between parents. Two interactions with the same key in one
  frame get a warning.
- **Widgets take one key** with `ctx.makeKey(props.key)` (the given key,
  else the next by position) and name every part from it (`${id}:thumb`).
  Parts drawn only sometimes, like a menu while it's open, then don't
  shift the keys of what comes after the widget.
- **State lives while it's drawn.** Anything not asked for during a frame
  is dropped at the end of it, as when a React component unmounts. What
  must outlive that (a closed panel's contents, a page's scroll position)
  belongs in the app, or under a region that keeps being drawn.
- `ctx.provide(token, value)` / `ctx.use(token)` pass values (a theme) down
  to child regions.

### Drawing

Colours are palette indices. Fades and tints are colour maps
(`palette.mixMap`) plus ordered dither (`dither(level)`, `shade(amount)`), as
on 8-bit hardware.

`fillRect(r, color, { pattern })`, `strokeRect`, `hline`, `vline`, `line`,
`circle`, `fillCircle`, `pixel`, `bitmap(image, x, y, color, { scale })`,
`text(text, x, y, { color, font, scale })` (returns where the next text
would follow on), `remap(r, map, { pattern })`, `mosaic(r, size)`.

`filter(r, { to, strength, blend })` reworks what's already drawn in `r`,
pixel by pixel. `strength` says how much each pixel is affected: a number,
`ramp('right')` (rising towards an edge of `r`, or between two points), or
`radial({ inner, outer })`. `to` says what an affected pixel becomes: a
palette index, a colour map, or a map per strength. With `blend: 'dither'`
(the default) each pixel is replaced whole or left alone by ordered dither,
so fades dissolve; with `'steps'` every pixel goes through the map for its
strength, so a colour means fading through the palette's shades towards it.

```ts
// Fade the trailing edge of a scroll view into the background.
view.filter({ x: view.bounds.w - 16, y: 0, w: 16, h: view.bounds.h }, { to: c.bg, strength: ramp('right') });
// A vignette, stepped through the palette.
ctx.filter(ctx.screen, { to: c.void, strength: radial({ inner: 120 }, 0, 0.6), blend: 'steps' });
```

Filters, like `remap` and `mosaic`, work on what's drawn before them in the
same layer (and everything in the layers below), and stay inside the
region's clip.

### Text

Fonts are named, like colours. The app gives the host a set of faces
(`fonts`, e.g. the widgets' `THEME_FONTS`: `text`, the 5×7, and `small`),
with `defaultFont` naming the one used when none is (default: the first).
Faces are data (`BitmapFace`: glyph rows, spacing, aliases); the backend
turns them into fonts it measures and draws, and nothing outside it holds
one. Text is styled by font name, and measured through the context:
`measureText(text, { font, scale })`, `fontMetrics(font)` (line height and
spacing), `hasFont(name)`.

For anything past one plain line, lay the text out and draw the layout:

```ts
const layout = ctx.layoutText(
  { text: 'SAVE AS…', attrs: [{ start: 0, end: 4, color: c.accent, underline: c.accent }] },
  { font: 'small', color: c.text, width: 80, height: 11, wrap: 'word', maxLines: 2, align: 'center', valign: 'middle' },
);
ctx.drawText(layout, x, y);
```

`layoutText` takes a string, or one with attributes (`color`,
`background`, `underline`) over ranges of it, and a box to set it in. The
layout has its `lines`, the `runs` to draw (cut wherever the attributes
change), its `bounds`, whether any text was left out (`truncated`), and
where every caret position is: `position(index)`, `indexAt(point)`,
`lineOf(index)`.

### Packages and platforms

| Package | Platform Dependency | Contents |
| --- | --- | --- |
| `@synth-ui/core` | none | `UI` and `Context`: regions, keys, state, animation, layout, input routing, focus, shortcuts; `Palette`, bitmaps and dither; font faces and text layout types; `DrawCommand` and `Scene`, what each drawing operation means |
| `@synth-ui/core/backend` | none | `Backend`, the one thing the core depends on: the host's fonts (measuring, layout) and the drawing operations a `Context` calls as it paints. Also `basicTextLayout`, and `SceneRecorder`, a backend that records frames (for tests) |
| `@synth-ui/backend` | DOM | `createViewHost`: a view on a canvas, run by the Rust backend compiled to WebAssembly; inside, core's `Backend` implemented on the backend's exports |
| `@synth-ui/widgets` | none | The theme (`THEME_COLORS`, `THEME_FONTS`), the faces, icons, and widgets |
| `synth-backend` (crate) | none | The backend: `DrawList` (a frame's drawing and the fonts, as the host exposes them), the rasterizer (drawing → 8-bit palette indices), bitmap fonts, the CRT in wgpu, and `ViewHost`, which decides when frames are due, runs the `Painter` and presents what it drew |
| `synth-backend-web` (crate) | DOM | The web host: the canvas surface, DOM events → input events, the text agent, the frame clock, and the exports `@synth-ui/backend` builds on |

A `ViewHost` is made from a wgpu surface, a `Painter` (what draws each
frame: on the web, the JavaScript paint callback) and a `Platform` (where
the cursor and the text-input caret go). Porting to another platform means
a new crate next to `crates/backend-web` that supplies those three, ticks
the host on each display refresh (`on_vsync`), and feeds it input and size
changes; the rasterizer, the fonts and the CRT come along unchanged.

## Development

Besides Node and pnpm, the backend needs Rust with the WebAssembly target,
and `wasm-bindgen-cli` at exactly the version of the `wasm-bindgen` crate in
`Cargo.toml`:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129
```

```bash
pnpm install
pnpm dev          # the playground (apps/demo): http://localhost:5173
pnpm test         # the core, the widgets and the backend (vitest, then cargo test)
pnpm typecheck
pnpm build        # each package's dist/: ES modules, .d.ts, source maps; the wasm in packages/backend/pkg
pnpm build:demo
pnpm build:wasm   # just the wasm (--dev for an unoptimized build)
```

`pnpm dev`, `typecheck` and the builds build the wasm first, into
`packages/backend/pkg/` (not checked in).

`pnpm release` runs the tests and publishes every package whose version
isn't on npm yet; each package cleans and builds itself before it's packed.
The demo deploys to Vercel as configured in `vercel.json`: its build
(`scripts/vercel-build.sh`) installs Rust and `wasm-bindgen-cli` first, since
Vercel's build image has neither.

The repository is a pnpm workspace. Inside it, the packages and the playground resolve `@synth-ui/*` to each
other's sources through the `@synth-ui/source` export condition, so nothing
needs building first; outside it, the packages' `exports` point at `dist/`.

## License

MIT. See [LICENSE](LICENSE).
