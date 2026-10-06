//! Bitmap fonts. Each glyph is a 1-bit image; its width is the length of
//! its rows, so one format covers monospaced and proportional faces. Text is
//! drawn straight into a Surface in a palette index, at any integer scale.
//!
//! The faces come from the app, as data (core's `BitmapFace`); a
//! `FontRegistry` makes each into a font it can measure and draw, by name.

use std::collections::HashMap;

use serde::Deserialize;

use super::{Bitmap, Surface};

/// A bitmap face as the app describes it. Glyphs and aliases are lists, in
/// the order the app gave them: the first glyph is the fallback of last resort.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct FontFace {
    /// Each glyph's character and its rows (see `Bitmap::parse`).
    pub glyphs: Vec<(String, String)>,
    /// Blank pixels between glyphs. Default 1.
    #[serde(default)]
    pub spacing: Option<i32>,
    /// Drawn for characters the face lacks. Default '?'.
    #[serde(default)]
    pub fallback: Option<String>,
    /// Characters drawn as other characters.
    #[serde(default)]
    pub aliases: Vec<(String, String)>,
    /// Show lowercase as uppercase.
    #[serde(default)]
    pub caps: bool,
}

#[derive(Clone, Debug)]
pub struct BitmapFont {
    pub height: i32,
    pub spacing: i32,
    glyphs: HashMap<String, Bitmap>,
    aliases: HashMap<String, String>,
    caps: bool,
    fallback: String,
}

impl BitmapFont {
    pub fn new(face: &FontFace) -> Result<Self, String> {
        let first = face.glyphs.first().ok_or("synth-ui: a bitmap face needs at least one glyph")?.0.clone();
        let glyphs: HashMap<String, Bitmap> = face.glyphs.iter().map(|(ch, rows)| (ch.clone(), Bitmap::parse(rows))).collect();
        let height = glyphs.values().map(|g| g.h as i32).max().unwrap_or(0);
        let wanted = face.fallback.clone().unwrap_or_else(|| "?".into());
        let fallback = if glyphs.contains_key(&wanted) { wanted } else { first };
        Ok(Self { height, spacing: face.spacing.unwrap_or(1), glyphs, aliases: face.aliases.iter().cloned().collect(), caps: face.caps, fallback })
    }

    pub fn glyph(&self, ch: char) -> &Bitmap {
        let mut buf = [0u8; 4];
        let ch: &str = ch.encode_utf8(&mut buf);
        let upper;
        let key = if let Some(alias) = self.aliases.get(ch) {
            alias.as_str()
        } else if self.glyphs.contains_key(ch) || !self.caps {
            ch
        } else {
            upper = ch.to_uppercase();
            upper.as_str()
        };
        self.glyphs.get(key).unwrap_or_else(|| &self.glyphs[&self.fallback])
    }

    /// How far a glyph advances the pen at scale 1, not counting spacing.
    pub fn advance(&self, ch: char) -> i32 {
        self.glyph(ch).w as i32
    }

    /// Width of a string in pixels, without trailing spacing.
    pub fn width(&self, text: &str, scale: i32) -> i32 {
        let w: i32 = text.chars().map(|ch| (self.advance(ch) + self.spacing) * scale).sum();
        (w - self.spacing * scale).max(0)
    }

    /// Draw text with its top-left at (x, y). Returns the pen position after it, spacing included.
    pub fn draw(&self, s: &mut Surface, text: &str, x: i32, y: i32, color: u8, scale: i32) -> i32 {
        let mut cx = x;
        for ch in text.chars() {
            let g = self.glyph(ch);
            if ch != ' ' {
                s.bits(g, cx, y, color, scale);
            }
            cx += (g.w as i32 + self.spacing) * scale;
        }
        cx
    }
}

/// Fonts by name, made from an app's faces, each also known by an id (its
/// place in the set). The default is the one named, else the set's first.
#[derive(Clone, Debug)]
pub struct FontRegistry {
    fonts: Vec<(String, BitmapFont)>,
    default: usize,
}

impl FontRegistry {
    pub fn new(faces: &[(String, FontFace)], default: Option<&str>) -> Result<Self, String> {
        let mut fonts = Vec::with_capacity(faces.len());
        for (name, face) in faces {
            let font = BitmapFont::new(face).map_err(|e| format!("{e} (font \"{name}\")"))?;
            fonts.retain(|(n, _): &(String, BitmapFont)| n != name);
            fonts.push((name.clone(), font));
        }
        let default = match default {
            Some(name) => fonts.iter().position(|(n, _)| n == name).ok_or_else(|| format!("synth-ui: no font \"{name}\" to be the default"))?,
            None if fonts.is_empty() => return Err("synth-ui: no fonts given".into()),
            None => 0,
        };
        Ok(Self { fonts, default })
    }

    pub fn default_font(&self) -> &str {
        &self.fonts[self.default].0
    }

    pub fn id(&self, name: &str) -> Option<u32> {
        self.fonts.iter().position(|(n, _)| n == name).map(|i| i as u32)
    }

    pub fn font(&self, id: u32) -> Option<&BitmapFont> {
        self.fonts.get(id as usize).map(|(_, f)| f)
    }

    pub fn by_name(&self, name: &str) -> Option<&BitmapFont> {
        self.id(name).and_then(|id| self.font(id))
    }
}
