//! A frame's drawing as it arrives from the painter, and the fonts it's
//! measured and drawn with: the drawing and font API a `ViewHost` exposes.
//!
//! The host starts each frame (`begin`). The painter then defines clips and
//! draws, each operation in a layer (0 at the root, one more per overlay)
//! and through a clip (0 is the whole frame). Overlays draw into a higher
//! layer in the middle of everything else, so operations are kept per layer
//! and replayed, layer by layer, in `finish`. What each operation does is
//! spelled out by core's `DrawCommand`.
//!
//! Input comes from outside (JavaScript, on the web), so nothing here trusts
//! it: an unknown font, clip or colour map, or a negative size, draws nothing.

use crate::raster::{Bitmap, ColorMap, FontRegistry, Rect, StrengthField, Surface, bayer, strength_at};

/// How a filter applies its colour maps (see core's `FilterOptions.blend`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Blend {
    Dither,
    Steps,
}

#[derive(Clone, Debug)]
enum Op {
    Fill { r: Rect, color: u8, pattern: u16 },
    Stroke { r: Rect, color: u8 },
    Line { x0: i32, y0: i32, x1: i32, y1: i32, color: u8 },
    Circle { cx: i32, cy: i32, r: i32, color: u8, fill: bool },
    Pixel { x: i32, y: i32, color: u8 },
    Bitmap { image: Bitmap, x: i32, y: i32, color: u8, scale: i32 },
    Text { font: u32, text: String, x: i32, y: i32, color: u8, scale: i32 },
    Remap { r: Rect, map: u32, pattern: u16 },
    Mosaic { r: Rect, size: i32 },
    Filter { r: Rect, field: StrengthField, maps: Vec<u32>, blend: Blend },
}

#[derive(Clone, Debug)]
struct Cmd {
    clip: u32,
    op: Op,
}

pub struct DrawList {
    fonts: FontRegistry,
    palette: [u8; 1024],
    palette_version: u64,
    width: usize,
    height: usize,
    background: u8,
    clips: Vec<Option<Rect>>,
    layers: Vec<Vec<Cmd>>,
    maps: Vec<ColorMap>,
}

impl DrawList {
    pub fn new(fonts: FontRegistry) -> Self {
        Self { fonts, palette: [0; 1024], palette_version: 0, width: 0, height: 0, background: 0, clips: Vec::new(), layers: Vec::new(), maps: Vec::new() }
    }

    // ------------------------------------------------------------ fonts

    pub fn fonts(&self) -> &FontRegistry {
        &self.fonts
    }

    // ------------------------------------------------------------ frame

    /// Start a frame: everything drawn so far is dropped.
    pub fn begin(&mut self, width: usize, height: usize, background: u8) {
        self.width = width;
        self.height = height;
        self.background = background;
        self.clips.clear();
        self.clips.push(Some(Rect::new(0, 0, width as i32, height as i32)));
        self.layers.iter_mut().for_each(Vec::clear);
        self.maps.clear();
    }

    pub fn width(&self) -> usize {
        self.width
    }

    pub fn height(&self) -> usize {
        self.height
    }

    /// The palette as 256 RGBA entries; shorter input leaves the rest black.
    pub fn set_palette(&mut self, rgba: &[u8]) {
        let n = rgba.len().min(1024);
        let mut palette = [0; 1024];
        palette[..n].copy_from_slice(&rgba[..n]);
        if palette != self.palette {
            self.palette = palette;
            self.palette_version += 1;
        }
    }

    pub fn palette(&self) -> &[u8; 1024] {
        &self.palette
    }

    /// Bumped whenever the palette changes, so presenters upload it only then.
    pub fn palette_version(&self) -> u64 {
        self.palette_version
    }

    pub fn background(&self) -> u8 {
        self.background
    }

    /// Replay the frame into `target`, resizing it to the frame first.
    pub fn finish(&self, target: &mut Surface) {
        if target.width() != self.width || target.height() != self.height {
            target.resize(self.width, self.height);
        }
        target.clear(self.background);
        for cmd in self.layers.iter().flatten() {
            let Some(Some(clip)) = self.clips.get(cmd.clip as usize) else { continue };
            target.set_clip(Some(*clip));
            self.replay(target, &cmd.op);
        }
        target.set_clip(None);
    }

    fn replay(&self, s: &mut Surface, op: &Op) {
        match op {
            Op::Fill { r, color, pattern } => s.fill_rect(r.x, r.y, r.w, r.h, *color, *pattern),
            Op::Stroke { r, color } => s.rect(r.x, r.y, r.w, r.h, *color),
            Op::Line { x0, y0, x1, y1, color } => s.line(*x0, *y0, *x1, *y1, *color),
            Op::Circle { cx, cy, r, color, fill: true } => s.fill_circle(*cx, *cy, *r, *color),
            Op::Circle { cx, cy, r, color, fill: false } => s.circle(*cx, *cy, *r, *color),
            Op::Pixel { x, y, color } => s.pset(*x, *y, *color),
            Op::Bitmap { image, x, y, color, scale } => s.bits(image, *x, *y, *color, *scale),
            Op::Text { font, text, x, y, color, scale } => {
                if let Some(f) = self.fonts.font(*font) {
                    f.draw(s, text, *x, *y, *color, *scale);
                }
            }
            Op::Remap { r, map, pattern } => {
                if let Some(map) = self.maps.get(*map as usize) {
                    s.remap(r.x, r.y, r.w, r.h, map, *pattern);
                }
            }
            Op::Mosaic { r, size } => s.mosaic(r.x, r.y, r.w, r.h, *size),
            Op::Filter { r, field, maps, blend } => {
                let maps: Vec<&ColorMap> = maps.iter().filter_map(|&id| self.maps.get(id as usize)).collect();
                filter(s, *r, field, &maps, *blend);
            }
        }
    }

    // ------------------------------------------------------------ drawing

    /// Define clip `id` as an absolute rectangle.
    pub fn clip(&mut self, id: u32, r: Rect) {
        let id = id as usize;
        if id == 0 || id > 1 << 20 {
            return;
        }
        if self.clips.len() <= id {
            self.clips.resize(id + 1, None);
        }
        self.clips[id] = Some(r);
    }

    /// Keep a colour map for this frame; drawing refers to it by the id returned.
    pub fn add_map(&mut self, map: &[u8]) -> u32 {
        let mut m = [0u8; 256];
        let n = map.len().min(256);
        m[..n].copy_from_slice(&map[..n]);
        self.maps.push(m);
        (self.maps.len() - 1) as u32
    }

    pub fn fill(&mut self, layer: u32, clip: u32, r: Rect, color: u8, pattern: u16) {
        self.push(layer, clip, Op::Fill { r, color, pattern });
    }

    pub fn stroke(&mut self, layer: u32, clip: u32, r: Rect, color: u8) {
        self.push(layer, clip, Op::Stroke { r, color });
    }

    pub fn line(&mut self, layer: u32, clip: u32, x0: i32, y0: i32, x1: i32, y1: i32, color: u8) {
        self.push(layer, clip, Op::Line { x0, y0, x1, y1, color });
    }

    pub fn circle(&mut self, layer: u32, clip: u32, cx: i32, cy: i32, r: i32, color: u8, fill: bool) {
        self.push(layer, clip, Op::Circle { cx, cy, r, color, fill });
    }

    pub fn pixel(&mut self, layer: u32, clip: u32, x: i32, y: i32, color: u8) {
        self.push(layer, clip, Op::Pixel { x, y, color });
    }

    pub fn bitmap(&mut self, layer: u32, clip: u32, image: Bitmap, x: i32, y: i32, color: u8, scale: i32) {
        if image.bits.len() != image.w * image.h || scale < 1 {
            return;
        }
        self.push(layer, clip, Op::Bitmap { image, x, y, color, scale });
    }

    pub fn text(&mut self, layer: u32, clip: u32, font: u32, text: String, x: i32, y: i32, color: u8, scale: i32) {
        if self.fonts.font(font).is_none() || scale < 1 {
            return;
        }
        self.push(layer, clip, Op::Text { font, text, x, y, color, scale });
    }

    pub fn remap(&mut self, layer: u32, clip: u32, r: Rect, map: u32, pattern: u16) {
        self.push(layer, clip, Op::Remap { r, map, pattern });
    }

    pub fn mosaic(&mut self, layer: u32, clip: u32, r: Rect, size: i32) {
        self.push(layer, clip, Op::Mosaic { r, size });
    }

    pub fn filter(&mut self, layer: u32, clip: u32, r: Rect, field: StrengthField, maps: Vec<u32>, blend: Blend) {
        if maps.is_empty() {
            return;
        }
        self.push(layer, clip, Op::Filter { r, field, maps, blend });
    }

    fn push(&mut self, layer: u32, clip: u32, op: Op) {
        // Far more layers than any UI nests overlays is a caller gone wrong.
        let layer = layer as usize;
        if layer > 1024 {
            return;
        }
        if self.layers.len() <= layer {
            self.layers.resize_with(layer + 1, Vec::new);
        }
        self.layers[layer].push(Cmd { clip, op });
    }
}

/// Rework each pixel in `r` by its strength in `field` (see core's `DrawCommand` 'filter').
fn filter(s: &mut Surface, r: Rect, field: &StrengthField, maps: &[&ColorMap], blend: Blend) {
    if maps.is_empty() {
        return;
    }
    let last = maps.len() - 1;
    let level = |st: f64| ((st * last as f64 + 0.5).floor() as usize).min(last);
    match blend {
        Blend::Dither => s.apply(r.x, r.y, r.w, r.h, |i, x, y| {
            let st = strength_at(field, x, y);
            if (bayer(x, y) as f64) < (st * 16.0 + 0.5).floor() { maps[if last > 0 { level(st) } else { 0 }][i as usize] } else { i }
        }),
        Blend::Steps => s.apply(r.x, r.y, r.w, r.h, |i, x, y| {
            let st = strength_at(field, x, y);
            if last > 0 {
                maps[level(st)][i as usize]
            } else if st >= 0.5 {
                maps[0][i as usize]
            } else {
                i
            }
        }),
    }
}
