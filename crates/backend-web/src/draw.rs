//! The host's drawing and font API, as JavaScript calls it: what
//! `@synth-ui/backend` implements core's `Backend` with. Numbers arrive as
//! JavaScript numbers; whatever isn't a usable one draws nothing.

use std::cell::RefCell;
use std::rc::Rc;

use synth_backend::raster::{Bitmap, StrengthField, js_round};
use synth_backend::{Blend, DrawList, Rect};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WebDraw {
    list: Rc<RefCell<DrawList>>,
}

impl WebDraw {
    pub(crate) fn new(list: Rc<RefCell<DrawList>>) -> Self {
        Self { list }
    }
}

/// A coordinate, rounded as `Math.round` does; None if it isn't a finite number in range.
fn int(x: f64) -> Option<i32> {
    let r = js_round(x);
    (r.is_finite() && r.abs() < (1 << 30) as f64).then_some(r as i32)
}

fn rect(x: f64, y: f64, w: f64, h: f64) -> Option<Rect> {
    Some(Rect::new(int(x)?, int(y)?, int(w)?, int(h)?))
}

/// A palette index: the low byte, as storing into a `Uint8Array` takes it.
fn color(c: f64) -> u8 {
    c as i64 as u8
}

#[wasm_bindgen]
impl WebDraw {
    // ------------------------------------------------------------ fonts

    #[wasm_bindgen(js_name = defaultFont)]
    pub fn default_font(&self) -> String {
        self.list.borrow().fonts().default_font().into()
    }

    /// The id of the font registered as `name`, or undefined.
    #[wasm_bindgen(js_name = fontId)]
    pub fn font_id(&self, name: &str) -> Option<u32> {
        self.list.borrow().fonts().id(name)
    }

    /// Height of a line at scale 1.
    #[wasm_bindgen(js_name = fontHeight)]
    pub fn font_height(&self, font: u32) -> i32 {
        self.list.borrow().fonts().font(font).map_or(0, |f| f.height)
    }

    /// Space between one glyph and the next, at scale 1.
    #[wasm_bindgen(js_name = fontSpacing)]
    pub fn font_spacing(&self, font: u32) -> i32 {
        self.list.borrow().fonts().font(font).map_or(0, |f| f.spacing)
    }

    /// How far the first character of `ch` advances the pen at scale 1, not counting spacing.
    #[wasm_bindgen(js_name = glyphAdvance)]
    pub fn glyph_advance(&self, font: u32, ch: &str) -> i32 {
        let list = self.list.borrow();
        match (list.fonts().font(font), ch.chars().next()) {
            (Some(f), Some(c)) => f.advance(c),
            _ => 0,
        }
    }

    // ------------------------------------------------------------ frame

    /// The palette, as 256 RGBA entries.
    #[wasm_bindgen(js_name = setPalette)]
    pub fn set_palette(&self, rgba: &[u8]) {
        self.list.borrow_mut().set_palette(rgba);
    }

    /// Keep a colour map for this frame; `remap` and `filter` name it by the id returned.
    #[wasm_bindgen(js_name = addMap)]
    pub fn add_map(&self, map: &[u8]) -> u32 {
        self.list.borrow_mut().add_map(map)
    }

    pub fn clip(&self, id: u32, x: f64, y: f64, w: f64, h: f64) {
        if let Some(r) = rect(x, y, w, h) {
            self.list.borrow_mut().clip(id, r);
        }
    }

    // ------------------------------------------------------------ drawing

    pub fn fill(&self, layer: u32, clip: u32, x: f64, y: f64, w: f64, h: f64, c: f64, pattern: u32) {
        if let Some(r) = rect(x, y, w, h) {
            self.list.borrow_mut().fill(layer, clip, r, color(c), pattern as u16);
        }
    }

    pub fn stroke(&self, layer: u32, clip: u32, x: f64, y: f64, w: f64, h: f64, c: f64) {
        if let Some(r) = rect(x, y, w, h) {
            self.list.borrow_mut().stroke(layer, clip, r, color(c));
        }
    }

    pub fn line(&self, layer: u32, clip: u32, x0: f64, y0: f64, x1: f64, y1: f64, c: f64) {
        if let (Some(x0), Some(y0), Some(x1), Some(y1)) = (int(x0), int(y0), int(x1), int(y1)) {
            self.list.borrow_mut().line(layer, clip, x0, y0, x1, y1, color(c));
        }
    }

    pub fn circle(&self, layer: u32, clip: u32, cx: f64, cy: f64, r: f64, c: f64, fill: bool) {
        if let (Some(cx), Some(cy), Some(r)) = (int(cx), int(cy), int(r)) {
            self.list.borrow_mut().circle(layer, clip, cx, cy, r, color(c), fill);
        }
    }

    pub fn pixel(&self, layer: u32, clip: u32, x: f64, y: f64, c: f64) {
        if let (Some(x), Some(y)) = (int(x), int(y)) {
            self.list.borrow_mut().pixel(layer, clip, x, y, color(c));
        }
    }

    /// A 1-bit image, `w`×`h`, row-major in `bits`.
    pub fn bitmap(&self, layer: u32, clip: u32, bits: &[u8], w: u32, h: u32, x: f64, y: f64, c: f64, scale: f64) {
        if let (Some(x), Some(y), Some(scale)) = (int(x), int(y), int(scale)) {
            let image = Bitmap { w: w as usize, h: h as usize, bits: bits.to_vec() };
            self.list.borrow_mut().bitmap(layer, clip, image, x, y, color(c), scale);
        }
    }

    pub fn text(&self, layer: u32, clip: u32, font: u32, text: String, x: f64, y: f64, c: f64, scale: f64) {
        if let (Some(x), Some(y), Some(scale)) = (int(x), int(y), int(scale)) {
            self.list.borrow_mut().text(layer, clip, font, text, x, y, color(c), scale);
        }
    }

    pub fn remap(&self, layer: u32, clip: u32, x: f64, y: f64, w: f64, h: f64, map: u32, pattern: u32) {
        if let Some(r) = rect(x, y, w, h) {
            self.list.borrow_mut().remap(layer, clip, r, map, pattern as u16);
        }
    }

    pub fn mosaic(&self, layer: u32, clip: u32, x: f64, y: f64, w: f64, h: f64, size: f64) {
        if let (Some(r), Some(size)) = (rect(x, y, w, h), int(size.floor())) {
            self.list.borrow_mut().mosaic(layer, clip, r, size);
        }
    }

    /// `kind`: 0 constant (`field` is [value]), 1 linear ([x0, y0, x1, y1, start, end]),
    /// 2 radial ([cx, cy, inner, outer, start, end]). `maps` are ids from `addMap`.
    pub fn filter(&self, layer: u32, clip: u32, x: f64, y: f64, w: f64, h: f64, kind: u8, field: &[f64], maps: &[u32], steps: bool) {
        let f = |i: usize| field.get(i).copied().unwrap_or(0.0);
        let field = match kind {
            0 => StrengthField::Constant { value: f(0) },
            1 => StrengthField::Linear { x0: f(0), y0: f(1), x1: f(2), y1: f(3), start: f(4), end: f(5) },
            2 => StrengthField::Radial { cx: f(0), cy: f(1), inner: f(2), outer: f(3), start: f(4), end: f(5) },
            _ => return,
        };
        if let Some(r) = rect(x, y, w, h) {
            let blend = if steps { Blend::Steps } else { Blend::Dither };
            self.list.borrow_mut().filter(layer, clip, r, field, maps.to_vec(), blend);
        }
    }
}
