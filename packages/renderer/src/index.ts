// The platform-neutral half of the renderer: Scene → indexed pixels, and
// the bitmap fonts. A port to another platform reuses all of this and
// writes its own presenter and event glue, as ./web does for browsers.

export { BitmapFont, FONT_5X7, FONT_SMALL, FontRegistry, ADVANCE, MINOR, type FontSpec } from './raster/font.js';
export { rasterize } from './raster/rasterize.js';
export { Surface } from './raster/surface.js';
