//! 1-bit images: glyphs, icons, masks.

/// Row-major, one byte per pixel, non-zero = set.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Bitmap {
    pub w: usize,
    pub h: usize,
    pub bits: Vec<u8>,
}

impl Bitmap {
    pub fn new(w: usize, h: usize, bits: Vec<u8>) -> Self {
        debug_assert_eq!(bits.len(), w * h);
        Self { w, h, bits }
    }

    /// Parse rows of `#` (set) and `.` (clear), separated by whitespace, as core's `bitmap()` does.
    pub fn parse(rows: &str) -> Self {
        let lines: Vec<&str> = rows.split_whitespace().collect();
        let lines = if lines.is_empty() { vec![""] } else { lines };
        let w = lines.iter().map(|l| l.chars().count()).max().unwrap_or(0);
        let mut bits = vec![0; w * lines.len()];
        for (y, line) in lines.iter().enumerate() {
            for (x, ch) in line.chars().enumerate() {
                if ch == '#' {
                    bits[y * w + x] = 1;
                }
            }
        }
        Self { w, h: lines.len(), bits }
    }

    #[inline]
    pub fn get(&self, x: usize, y: usize) -> bool {
        self.bits[y * self.w + x] != 0
    }
}
