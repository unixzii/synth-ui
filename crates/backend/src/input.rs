//! What a host tells the core happened, and what the core tells the host
//! back each frame: the same shapes as core's `InputEvent`, `FrameInput` and
//! `FrameOutput`, field for field, so they cross to JavaScript as they are.
//! Positions are in virtual pixels; key names follow the W3C `key` and
//! `code` values.

use serde::{Deserialize, Serialize};

use crate::fx::PostFx;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Modifiers {
    pub shift: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub meta: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum InputEvent {
    PointerMove {
        x: f64,
        y: f64,
        mods: Modifiers,
    },
    /// `button`: 0 primary, 1 middle, 2 secondary.
    PointerDown {
        x: f64,
        y: f64,
        button: i16,
        mods: Modifiers,
    },
    PointerUp {
        x: f64,
        y: f64,
        button: i16,
        mods: Modifiers,
    },
    /// The pointer left the surface (while no button is held).
    PointerLeave,
    /// Scrolling, in pixels; positive is down and right.
    Wheel {
        x: f64,
        y: f64,
        dx: f64,
        dy: f64,
        mods: Modifiers,
    },
    KeyDown {
        key: String,
        code: String,
        repeat: bool,
        mods: Modifiers,
    },
    KeyUp {
        key: String,
        code: String,
        mods: Modifiers,
    },
    /// Text typed (or committed by an input method) into the focused text widget.
    Text {
        text: String,
    },
    /// An input method's text in progress; empty when composition ends.
    Composition {
        text: String,
    },
    Paste {
        text: String,
    },
    /// The selection was cut to the clipboard; the focused text widget should delete it.
    Cut,
    /// The window lost focus: keys held down won't report going up.
    Blur,
}

/// Pointer shapes, named as in CSS. Names it doesn't know read as `Default`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(into = "&str", from = "String")]
pub enum CursorStyle {
    #[default]
    Default,
    Pointer,
    Text,
    Move,
    Grab,
    Grabbing,
    Crosshair,
    NsResize,
    EwResize,
    NotAllowed,
    None,
}

impl From<String> for CursorStyle {
    fn from(name: String) -> Self {
        const ALL: [CursorStyle; 11] = [
            CursorStyle::Default,
            CursorStyle::Pointer,
            CursorStyle::Text,
            CursorStyle::Move,
            CursorStyle::Grab,
            CursorStyle::Grabbing,
            CursorStyle::Crosshair,
            CursorStyle::NsResize,
            CursorStyle::EwResize,
            CursorStyle::NotAllowed,
            CursorStyle::None,
        ];
        ALL.into_iter().find(|c| c.css_name() == name).unwrap_or_default()
    }
}

impl From<CursorStyle> for &'static str {
    fn from(c: CursorStyle) -> Self {
        c.css_name()
    }
}

impl CursorStyle {
    pub fn css_name(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Pointer => "pointer",
            Self::Text => "text",
            Self::Move => "move",
            Self::Grab => "grab",
            Self::Grabbing => "grabbing",
            Self::Crosshair => "crosshair",
            Self::NsResize => "ns-resize",
            Self::EwResize => "ew-resize",
            Self::NotAllowed => "not-allowed",
            Self::None => "none",
        }
    }
}

/// A rectangle in virtual pixels, not necessarily whole.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TextInputState {
    /// The caret, absolute: input methods open their popups beside it.
    pub caret: Area,
    /// What copying would put on the clipboard right now.
    pub selection: String,
}

/// What the painter is given each frame.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FrameInput {
    /// The frame's size in virtual pixels.
    pub width: u32,
    pub height: u32,
    /// Milliseconds on a steady clock.
    pub time: f64,
    /// Everything that happened since the last frame, in order.
    pub events: Vec<InputEvent>,
}

/// What the painter hands back after drawing a frame.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameOutput {
    #[serde(default)]
    pub cursor: CursorStyle,
    #[serde(default)]
    pub hint: String,
    /// Set while a text widget has focus.
    #[serde(default)]
    pub text_input: Option<TextInputState>,
    /// Every combo the frame claimed as a shortcut, canonical, so the platform can stop their default action.
    #[serde(default)]
    pub shortcuts: Vec<String>,
    /// Something is still moving: draw another frame even if nothing happens.
    #[serde(default)]
    pub animating: bool,
    /// The CRT, as it should look from this frame on.
    #[serde(default)]
    pub fx: PostFx,
}

// ------------------------------------------------------------ key combos
// Ports of core's input.ts, for platforms deciding what to do with a key
// before the next frame (such as whether to stop the browser's own action).

/// JavaScript's `key.length === 1`: one UTF-16 unit.
fn single(key: &str) -> bool {
    key.encode_utf16().count() == 1
}

/// A key's name in a combo: letters lowercase, the space bar as 'Space'.
pub fn key_name(key: &str) -> String {
    if key == " " {
        "Space".into()
    } else if single(key) {
        key.to_lowercase()
    } else {
        key.into()
    }
}

/// Does Shift count in a combo with this key? Not for symbols.
fn shift_counts(key: &str) -> bool {
    !single(key) || key.to_lowercase() != key.to_uppercase()
}

/// The canonical form of a key press, e.g. 'Mod+Shift+z'.
pub fn combo_of(key: &str, mods: Modifiers, mac: bool) -> String {
    let mut parts: Vec<String> = Vec::new();
    if if mac { mods.meta } else { mods.ctrl } {
        parts.push("Mod".into());
    }
    if if mac { mods.ctrl } else { mods.meta } {
        parts.push(if mac { "Ctrl" } else { "Meta" }.into());
    }
    if mods.alt {
        parts.push("Alt".into());
    }
    if mods.shift && shift_counts(key) {
        parts.push("Shift".into());
    }
    parts.push(key_name(key));
    parts.join("+")
}

const EDITING_KEYS: [&str; 13] = ["Backspace", "Delete", "Enter", "Escape", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];

/// Is this canonical combo one a focused text widget would want: typing,
/// editing keys, or Mod with A, C, V, X, Y, Z or an editing key?
pub fn is_typing_combo(combo: &str) -> bool {
    let parts: Vec<&str> = combo.split('+').collect();
    let key = if combo.ends_with("++") || combo == "+" { "+" } else { parts[parts.len() - 1] };
    let mods: Vec<&str> = parts[..parts.len() - 1].iter().copied().filter(|m| !m.is_empty() && *m != "Shift").collect();
    let editing = EDITING_KEYS.contains(&key);
    if mods.is_empty() {
        return single(key) || key == "Space" || editing;
    }
    mods == ["Mod"] && if single(key) { "acvxyz".contains(key) } else { editing }
}

#[cfg(test)]
mod tests {
    use super::*;

    const M: Modifiers = Modifiers { shift: false, ctrl: false, alt: false, meta: false };

    #[test]
    fn spells_combos_as_core_does() {
        let mods = Modifiers { meta: true, shift: true, ..M };
        assert_eq!(combo_of("Z", mods, true), "Mod+Shift+z");
        assert_eq!(combo_of("Z", mods, false), "Meta+Shift+z");
        assert_eq!(combo_of("+", Modifiers { shift: true, ..M }, false), "+");
        assert_eq!(combo_of(" ", M, false), "Space");
    }

    #[test]
    fn knows_what_a_text_widget_wants() {
        for c in ["a", "Shift+a", "Space", "Backspace", "Mod+z", "Mod+ArrowLeft", "Shift+ArrowLeft"] {
            assert!(is_typing_combo(c), "{c}");
        }
        for c in ["F1", "Mod+s", "Alt+a", "Mod++", "Mod+Alt+z"] {
            assert!(!is_typing_combo(c), "{c}");
        }
        assert!(is_typing_combo("+"));
    }

    #[test]
    fn events_and_output_have_cores_shapes() {
        let e: InputEvent = serde_json::from_str(r#"{"type":"keyup","key":"a","code":"KeyA","mods":{"shift":false,"ctrl":false,"alt":false,"meta":false}}"#).unwrap();
        assert!(matches!(e, InputEvent::KeyUp { .. }));
        let json = serde_json::to_string(&InputEvent::PointerLeave).unwrap();
        assert_eq!(json, r#"{"type":"pointerleave"}"#);
        let out: FrameOutput = serde_json::from_str(r#"{"cursor":"ns-resize","hint":"","textInput":null,"shortcuts":["Mod+z"],"animating":true}"#).unwrap();
        assert_eq!(out.cursor, CursorStyle::NsResize);
        assert_eq!(out.shortcuts, ["Mod+z"]);
        let out: FrameOutput = serde_json::from_str(r#"{"cursor":"zoom-in"}"#).unwrap();
        assert_eq!(out.cursor, CursorStyle::Default);
    }
}
