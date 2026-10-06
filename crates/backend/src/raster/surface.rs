//! An 8-bit indexed framebuffer and the drawing primitives on top of it.
//! Coordinates are absolute integer pixels from the top left; every call
//! goes through the current clip.

use super::{Bitmap, Rect};

/// A colour map: what each palette index becomes.
pub type ColorMap = [u8; 256];

/// A fill pattern covering every pixel (see core's `dither`).
pub const SOLID: u16 = 0xffff;

#[derive(Clone, Debug, Default)]
pub struct Surface {
    width: usize,
    height: usize,
    data: Vec<u8>,
    /// The clip, absolute and end-exclusive: x0, y0, x1, y1.
    clip: [i32; 4],
}

impl Surface {
    pub fn new(width: usize, height: usize) -> Self {
        let mut s = Self::default();
        s.resize(width, height);
        s
    }

    pub fn resize(&mut self, width: usize, height: usize) {
        self.width = width;
        self.height = height;
        self.data = vec![0; width * height];
        self.clip = [0, 0, width as i32, height as i32];
    }

    pub fn width(&self) -> usize {
        self.width
    }

    pub fn height(&self) -> usize {
        self.height
    }

    pub fn data(&self) -> &[u8] {
        &self.data
    }

    pub fn data_mut(&mut self) -> &mut [u8] {
        &mut self.data
    }

    /// Clip to an absolute rectangle, or to the whole surface.
    pub fn set_clip(&mut self, r: Option<Rect>) {
        let (w, h) = (self.width as i32, self.height as i32);
        self.clip = match r {
            Some(r) => [r.x.max(0), r.y.max(0), (r.x + r.w).min(w), (r.y + r.h).min(h)],
            None => [0, 0, w, h],
        };
    }

    pub fn clear(&mut self, c: u8) {
        self.data.fill(c);
    }

    pub fn pset(&mut self, x: i32, y: i32, c: u8) {
        let [x0, y0, x1, y1] = self.clip;
        if x < x0 || y < y0 || x >= x1 || y >= y1 {
            return;
        }
        self.data[y as usize * self.width + x as usize] = c;
    }

    /// Fill a rectangle, through a 4×4 dither mask (`SOLID` for every pixel).
    pub fn fill_rect(&mut self, x: i32, y: i32, w: i32, h: i32, c: u8, mask: u16) {
        let Some([x0, y0, x1, y1]) = self.boxed(x, y, w, h) else { return };
        let width = self.width;
        for yy in y0..y1 {
            let row = &mut self.data[yy as usize * width..][x0 as usize..x1 as usize];
            if mask == SOLID {
                row.fill(c);
                continue;
            }
            let bits = (yy & 3) * 4;
            for (xx, px) in (x0..x1).zip(row.iter_mut()) {
                if mask & (1 << (bits + (xx & 3))) != 0 {
                    *px = c;
                }
            }
        }
    }

    pub fn hline(&mut self, x: i32, y: i32, w: i32, c: u8) {
        self.fill_rect(x, y, w, 1, c, SOLID);
    }

    pub fn vline(&mut self, x: i32, y: i32, h: i32, c: u8) {
        self.fill_rect(x, y, 1, h, c, SOLID);
    }

    /// A one-pixel outline just inside the rectangle.
    pub fn rect(&mut self, x: i32, y: i32, w: i32, h: i32, c: u8) {
        if w <= 0 || h <= 0 {
            return;
        }
        self.hline(x, y, w, c);
        self.hline(x, y + h - 1, w, c);
        self.vline(x, y + 1, h - 2, c);
        self.vline(x + w - 1, y + 1, h - 2, c);
    }

    /// A Bresenham line, both ends included.
    pub fn line(&mut self, mut x0: i32, mut y0: i32, x1: i32, y1: i32, c: u8) {
        let dx = (x1 - x0).abs();
        let dy = -(y1 - y0).abs();
        let sx = if x0 < x1 { 1 } else { -1 };
        let sy = if y0 < y1 { 1 } else { -1 };
        let mut err = dx + dy;
        loop {
            self.pset(x0, y0, c);
            if x0 == x1 && y0 == y1 {
                return;
            }
            let e2 = 2 * err;
            if e2 >= dy {
                err += dy;
                x0 += sx;
            }
            if e2 <= dx {
                err += dx;
                y0 += sy;
            }
        }
    }

    /// Midpoint circle outline of radius r around (cx, cy).
    pub fn circle(&mut self, cx: i32, cy: i32, r: i32, c: u8) {
        midpoint(r, |x, y| {
            for (px, py) in [(x, y), (y, x), (-y, x), (-x, y), (-x, -y), (-y, -x), (y, -x), (x, -y)] {
                self.pset(cx + px, cy + py, c);
            }
        });
    }

    pub fn fill_circle(&mut self, cx: i32, cy: i32, r: i32, c: u8) {
        midpoint(r, |x, y| {
            self.hline(cx - x, cy + y, 2 * x + 1, c);
            self.hline(cx - x, cy - y, 2 * x + 1, c);
            self.hline(cx - y, cy + x, 2 * y + 1, c);
            self.hline(cx - y, cy - x, 2 * y + 1, c);
        });
    }

    /// Replace every index in a rectangle through a colour map, through a dither mask.
    pub fn remap(&mut self, x: i32, y: i32, w: i32, h: i32, map: &ColorMap, mask: u16) {
        let Some([x0, y0, x1, y1]) = self.boxed(x, y, w, h) else { return };
        let width = self.width;
        for yy in y0..y1 {
            let bits = (yy & 3) * 4;
            let row = &mut self.data[yy as usize * width..][x0 as usize..x1 as usize];
            for (xx, px) in (x0..x1).zip(row.iter_mut()) {
                if mask != SOLID && mask & (1 << (bits + (xx & 3))) == 0 {
                    continue;
                }
                *px = map[*px as usize];
            }
        }
    }

    /// Replace every index in a rectangle with `f(index, x, y)`.
    pub fn apply(&mut self, x: i32, y: i32, w: i32, h: i32, mut f: impl FnMut(u8, i32, i32) -> u8) {
        let Some([x0, y0, x1, y1]) = self.boxed(x, y, w, h) else { return };
        let width = self.width;
        for yy in y0..y1 {
            let row = &mut self.data[yy as usize * width..][x0 as usize..x1 as usize];
            for (xx, px) in (x0..x1).zip(row.iter_mut()) {
                *px = f(*px, xx, yy);
            }
        }
    }

    /// Pixelate a rectangle: each `size`×`size` block, counted from the
    /// rectangle's corner, takes the colour at its centre. 1 leaves it as is.
    pub fn mosaic(&mut self, x: i32, y: i32, w: i32, h: i32, size: i32) {
        if size <= 1 {
            return;
        }
        let Some([x0, y0, x1, y1]) = self.boxed(x, y, w, h) else { return };
        let width = self.width;
        let half = size >> 1;
        let mut by = y0;
        while by < y1 {
            let ey = y1.min(by + size);
            let sy = (ey - 1).min(by + half);
            let mut bx = x0;
            while bx < x1 {
                let ex = x1.min(bx + size);
                let c = self.data[sy as usize * width + (ex - 1).min(bx + half) as usize];
                for yy in by..ey {
                    self.data[yy as usize * width..][bx as usize..ex as usize].fill(c);
                }
                bx += size;
            }
            by += size;
        }
    }

    /// Stamp a 1-bit image in one colour, each bit as a `scale`×`scale` block.
    pub fn bits(&mut self, img: &Bitmap, x: i32, y: i32, c: u8, scale: i32) {
        for yy in 0..img.h {
            for xx in 0..img.w {
                if !img.get(xx, yy) {
                    continue;
                }
                let (bx, by) = (xx as i32, yy as i32);
                if scale == 1 {
                    self.pset(x + bx, y + by, c);
                } else {
                    self.fill_rect(x + bx * scale, y + by * scale, scale, scale, c, SOLID);
                }
            }
        }
    }

    /// A rectangle clipped, as absolute [x0, y0, x1, y1]; None if empty.
    fn boxed(&self, x: i32, y: i32, w: i32, h: i32) -> Option<[i32; 4]> {
        let [cx0, cy0, cx1, cy1] = self.clip;
        let x0 = cx0.max(x);
        let y0 = cy0.max(y);
        let x1 = cx1.min(x.saturating_add(w));
        let y1 = cy1.min(y.saturating_add(h));
        (x1 > x0 && y1 > y0).then_some([x0, y0, x1, y1])
    }
}

fn midpoint(r: i32, mut plot: impl FnMut(i32, i32)) {
    if r < 0 {
        return;
    }
    let (mut x, mut y, mut err) = (r, 0, 1 - r);
    while x >= y {
        plot(x, y);
        y += 1;
        if err < 0 {
            err += 2 * y + 1;
        } else {
            x -= 1;
            err += 2 * (y - x) + 1;
        }
    }
}
