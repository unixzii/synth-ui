//! Drawing into 8-bit indexed pixels: the surface and its primitives, the
//! bitmap fonts, and the replay of a frame's drawing. Pure data, so it runs
//! (and is tested) anywhere.

mod bitmap;
mod dither;
mod font;
mod surface;

pub use bitmap::Bitmap;
pub use dither::{StrengthField, bayer, strength_at};
pub use font::{BitmapFont, FontFace, FontRegistry};
pub use surface::{ColorMap, SOLID, Surface};

/// JavaScript's `Math.round`: halves go up, towards +∞ (−0.5 → 0, not −1).
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// A rectangle in whole pixels: its top left and size.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    pub const fn new(x: i32, y: i32, w: i32, h: i32) -> Self {
        Self { x, y, w, h }
    }
}
