//! synth-ui's web host: a `ViewHost` on a `<canvas>`, ticked by
//! `requestAnimationFrame`, fed by DOM events, and painting through a
//! JavaScript callback that draws with the exported `WebDraw`.
//!
//! Everything exported takes `&self` and keeps its state in cells it
//! borrows only briefly: the paint callback runs JavaScript that calls back
//! into these exports while a frame is being drawn.
//!
//! It's only for the web: built for anything but wasm32, it's empty, so
//! `cargo test --workspace` and friends still work natively.
#![cfg(target_arch = "wasm32")]

// Drawing operations take what they draw positionally, as core's `Backend` does.
#![allow(clippy::too_many_arguments)]

mod draw;
mod events;
mod host;
mod log;

pub use draw::WebDraw;
pub use host::WebViewHost;

use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
fn start() {
    console_error_panic_hook::set_once();
    log::init();
}
