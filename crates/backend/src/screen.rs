//! Where the pixels go on the display. Either a fixed virtual resolution
//! scaled to fit and letterboxed (the layout always has the same pixels to
//! work with; only how big they are changes), or a fixed pixel size with as
//! many pixels as fit. Scales needn't be whole numbers: the CRT keeps pixel
//! edges sharp at any size.
//!
//! Everything here is in device pixels: the platform reports the drawable's
//! size and its device pixels per point (the web's `devicePixelRatio`).

use serde::Deserialize;

#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(untagged)]
pub enum ScreenMode {
    /// Always this many virtual pixels, scaled to fit and letterboxed.
    Resolution { resolution: Size },
    /// Each virtual pixel this many points; the resolution follows the drawable's size.
    PixelScale {
        #[serde(rename = "pixelScale")]
        pixel_scale: f64,
    },
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Deserialize)]
pub struct Size {
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug)]
pub struct Screen {
    mode: ScreenMode,
    /// The virtual resolution.
    pub width: u32,
    pub height: u32,
    /// Device pixels per virtual pixel (not necessarily whole).
    pub scale: f64,
    /// The drawable, in device pixels.
    pub device: (u32, u32),
    /// The picture inside it, letterboxed: its size and top left, in device pixels.
    pub out: (u32, u32),
    pub origin: (u32, u32),
    dpr: f64,
    resized: bool,
}

impl Screen {
    pub fn new(mode: ScreenMode) -> Self {
        let (width, height) = match mode {
            ScreenMode::Resolution { resolution } => (resolution.width.max(1), resolution.height.max(1)),
            ScreenMode::PixelScale { .. } => (0, 0),
        };
        Self { mode, width, height, scale: 1.0, device: (0, 0), out: (0, 0), origin: (0, 0), dpr: 0.0, resized: true }
    }

    pub fn dpr(&self) -> f64 {
        self.dpr
    }

    /// The drawable is now `w`×`h` device pixels, at `dpr` device pixels per point.
    pub fn resize(&mut self, w: u32, h: u32, dpr: f64) {
        let dpr = if dpr > 0.0 && dpr.is_finite() { dpr } else { 1.0 };
        if (w, h) == self.device && dpr == self.dpr {
            return;
        }
        self.device = (w, h);
        self.dpr = dpr;
        if w == 0 || h == 0 {
            return;
        }
        let (fw, fh) = (w as f64, h as f64);
        match self.mode {
            ScreenMode::PixelScale { pixel_scale } => {
                self.scale = pixel_scale.max(f64::MIN_POSITIVE) * dpr;
                self.width = ((fw / self.scale).floor() as u32).max(1);
                self.height = ((fh / self.scale).floor() as u32).max(1);
            }
            ScreenMode::Resolution { .. } => self.scale = (fw / self.width as f64).min(fh / self.height as f64),
        }
        let ow = w.min((self.width as f64 * self.scale).round() as u32);
        let oh = h.min((self.height as f64 * self.scale).round() as u32);
        self.out = (ow, oh);
        self.origin = ((w - ow) / 2, (h - oh) / 2);
        self.resized = true;
    }

    /// Whether the size changed since this was last asked.
    pub fn take_resized(&mut self) -> bool {
        std::mem::take(&mut self.resized)
    }

    /// Whether there's anything to draw into.
    pub fn visible(&self) -> bool {
        self.width > 0 && self.height > 0 && self.out.0 > 0 && self.out.1 > 0
    }

    /// A point on the drawable, in device pixels → virtual pixels.
    pub fn to_virtual(&self, x: f64, y: f64) -> (f64, f64) {
        let (ow, oh) = (self.out.0.max(1) as f64, self.out.1.max(1) as f64);
        ((x - self.origin.0 as f64) / ow * self.width as f64, (y - self.origin.1 as f64) / oh * self.height as f64)
    }

    /// A virtual rectangle → device pixels on the drawable: x, y, w, h.
    pub fn to_device(&self, x: f64, y: f64, w: f64, h: f64) -> (f64, f64, f64, f64) {
        let k = self.scale;
        (self.origin.0 as f64 + x * k, self.origin.1 as f64 + y * k, w * k, h * k)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn letterboxes_a_fixed_resolution_centred() {
        let mut s = Screen::new(ScreenMode::Resolution { resolution: Size { width: 100, height: 50 } });
        s.resize(300, 200, 2.0);
        assert_eq!((s.width, s.height), (100, 50));
        assert_eq!(s.scale, 3.0);
        assert_eq!(s.out, (300, 150));
        assert_eq!(s.origin, (0, 25));
        assert!(s.take_resized());
        assert!(!s.take_resized());
        assert_eq!(s.to_virtual(150.0, 100.0), (50.0, 25.0));
        assert_eq!(s.to_device(10.0, 10.0, 2.0, 1.0), (30.0, 55.0, 6.0, 3.0));
    }

    #[test]
    fn fits_as_many_pixels_as_a_fixed_scale_allows() {
        let mut s = Screen::new(ScreenMode::PixelScale { pixel_scale: 2.0 });
        s.resize(205, 100, 2.0);
        assert_eq!((s.width, s.height), (51, 25));
        assert_eq!(s.out, (204, 100));
        assert_eq!(s.origin, (0, 0));
    }

    #[test]
    fn reads_both_modes_as_the_host_options_spell_them() {
        let m: ScreenMode = serde_json::from_str(r#"{"resolution":{"width":640,"height":400},"palette":0}"#).unwrap();
        assert_eq!(m, ScreenMode::Resolution { resolution: Size { width: 640, height: 400 } });
        let m: ScreenMode = serde_json::from_str(r#"{"pixelScale":3}"#).unwrap();
        assert_eq!(m, ScreenMode::PixelScale { pixel_scale: 3.0 });
    }
}
