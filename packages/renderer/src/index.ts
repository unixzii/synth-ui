// The platform-neutral half of the renderer: Scene → indexed pixels, and
// the fonts it makes from an app's bitmap faces. A port to another platform reuses all of this and
// writes its own presenter and event glue, as ./web does for browsers.

export { BitmapFont, FontRegistry } from './raster/font.js';
export { rasterize } from './raster/rasterize.js';
export { Surface } from './raster/surface.js';
