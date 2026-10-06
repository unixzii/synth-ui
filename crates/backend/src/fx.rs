//! The CRT, modelled physically: every colour is light, per channel, in
//! linear units, and nothing is told how much to glow. What glows is what's
//! bright, the way the tube does it.

use serde::{Deserialize, Serialize};

/// The phosphor pattern behind the glass.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MaskType {
    /// Unbroken vertical stripes.
    #[default]
    Aperture,
    /// Stripes broken into staggered slots.
    Slot,
    /// Dots.
    Shadow,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Beam {
    /// How thin a dim beam is, leaving dark gaps between rows: 0 flat, 1 thin lines.
    pub scanlines: f64,
    /// How much a bright beam widens into those gaps: 0 not at all, 1 fully.
    pub bloom: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Mask {
    #[serde(rename = "type")]
    pub kind: MaskType,
    /// How much light falls between its stripes or dots (0–1).
    pub strength: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Halation {
    /// The share of light scattered in the glass around where it's emitted.
    pub amount: f64,
    /// How far it reaches (1–6, each doubling).
    pub spread: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PostFx {
    /// Off: the pixels as they are.
    pub enabled: bool,
    pub beam: Beam,
    pub mask: Mask,
    pub halation: Halation,
    /// How long each phosphor (red, green, blue) takes to fade to a third, in ms.
    pub persistence: [f64; 3],
    /// How fast the phosphor wears where it's lit, dimming there for good: the
    /// share of its light lost per hour at full drive. 0 turns it off.
    pub burn_in: f64,
    /// Room light the faceplate reflects, in linear units; worn phosphor reflects less.
    pub ambient: f64,
    /// Light falling off towards the corners: 0 none, 1 half gone there.
    pub vignette: f64,
}

impl Default for PostFx {
    fn default() -> Self {
        Self { enabled: true, beam: Beam::default(), mask: Mask::default(), halation: Halation::default(), persistence: [3.0, 0.3, 0.15], burn_in: 0.0, ambient: 0.0, vignette: 0.32 }
    }
}

impl Default for Beam {
    fn default() -> Self {
        Self { scanlines: 0.94, bloom: 0.4 }
    }
}

impl Default for Mask {
    fn default() -> Self {
        Self { kind: MaskType::Aperture, strength: 0.45 }
    }
}

impl Default for Halation {
    fn default() -> Self {
        Self { amount: 0.16, spread: 3.0 }
    }
}

impl PostFx {
    /// How long, in ms, the screen keeps changing after a frame with nothing new: the phosphors fading.
    pub fn afterglow(&self) -> f64 {
        // Seven time constants: faded below a thousandth.
        if self.enabled { 7.0 * self.persistence.iter().copied().fold(0.0, f64::max) } else { 0.0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_shape_core_apps_write() {
        let fx: PostFx = serde_json::from_str(
            r#"{"enabled":true,"beam":{"scanlines":0.5,"bloom":0.1},"mask":{"type":"slot","strength":1},"halation":{"amount":0,"spread":2},"persistence":[1,2,3],"burnIn":4,"ambient":0.01,"vignette":0}"#,
        )
        .unwrap();
        assert_eq!(fx.mask.kind, MaskType::Slot);
        assert_eq!(fx.burn_in, 4.0);
        assert_eq!(fx.afterglow(), 21.0);
        let partial: PostFx = serde_json::from_str(r#"{"enabled":false}"#).unwrap();
        assert_eq!(partial, PostFx { enabled: false, ..PostFx::default() });
    }
}
