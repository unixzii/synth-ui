//! The platform-neutral half of synth-ui's backend. A frame's drawing
//! arrives from the painter (`DrawList`), is rasterized into 8-bit palette
//! indices (`raster`), and shown through a simulated CRT (`gpu`). The
//! `ViewHost` decides when frames are drawn, runs the painter, and holds it
//! all together; a platform crate gives it a surface, a clock, input, and
//! somewhere to put the cursor and the text-input caret.

// Drawing operations take what they draw positionally, as core's `Backend` does.
#![allow(clippy::too_many_arguments)]

pub mod draw;
pub mod fx;
pub mod input;
pub mod raster;
pub mod schedule;
pub mod screen;

#[cfg(feature = "gpu")]
pub mod gpu;
#[cfg(feature = "gpu")]
mod host;

pub use draw::{Blend, DrawList};
pub use fx::{MaskType, PostFx};
pub use input::{CursorStyle, FrameInput, FrameOutput, InputEvent, Modifiers, TextInputState};
pub use raster::{FontFace, FontRegistry, Rect};
pub use schedule::Redraw;
pub use screen::{Screen, ScreenMode};

#[cfg(feature = "gpu")]
pub use host::{Painter, Platform, ViewHost, ViewHostOptions};

/// The wgpu this crate draws with, for platforms making instances and surfaces.
#[cfg(feature = "gpu")]
pub use wgpu;
