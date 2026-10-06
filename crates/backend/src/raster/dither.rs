//! Ordered dither and the strength fields filters work by, as core defines them.

const BAYER: [u8; 16] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/// The ordered-dither threshold at pixel (x, y), 0–15.
#[inline]
pub fn bayer(x: i32, y: i32) -> u8 {
    BAYER[(((y & 3) * 4) + (x & 3)) as usize]
}

/// How strongly a filter affects each pixel, in absolute coordinates.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum StrengthField {
    Constant { value: f64 },
    Linear { x0: f64, y0: f64, x1: f64, y1: f64, start: f64, end: f64 },
    Radial { cx: f64, cy: f64, inner: f64, outer: f64, start: f64, end: f64 },
}

/// The strength of a field at the centre of pixel (x, y), clamped to 0–1.
pub fn strength_at(f: &StrengthField, x: i32, y: i32) -> f64 {
    let (px, py) = (x as f64 + 0.5, y as f64 + 0.5);
    let s = match *f {
        StrengthField::Constant { value } => value,
        StrengthField::Linear { x0, y0, x1, y1, start, end } => {
            let (dx, dy) = (x1 - x0, y1 - y0);
            let len = dx * dx + dy * dy;
            let t = if len != 0.0 { ((px - x0) * dx + (py - y0) * dy) / len } else { 1.0 };
            start + (end - start) * t.clamp(0.0, 1.0)
        }
        StrengthField::Radial { cx, cy, inner, outer, start, end } => {
            let span = outer - inner;
            let d = (px - cx).hypot(py - cy);
            let t = if span > 0.0 {
                (d - inner) / span
            } else if d >= outer {
                1.0
            } else {
                0.0
            };
            start + (end - start) * t.clamp(0.0, 1.0)
        }
    };
    // `max` then `min`, as JS does it, so NaN comes out as NaN rather than a bound.
    if s.is_nan() { s } else { s.clamp(0.0, 1.0) }
}
