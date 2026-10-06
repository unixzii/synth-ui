//! A `ViewHost` on a canvas: the browser's frame clock and sizes, the paint
//! callback, and what's exported to JavaScript.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use serde::Deserialize;
use synth_backend::wgpu;
use synth_backend::{CursorStyle, FontFace, FontRegistry, FrameInput, FrameOutput, InputEvent, Painter, Platform, Screen, TextInputState, ViewHost, ViewHostOptions};
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

use crate::draw::WebDraw;
use crate::events::{Listener, Sink, Web, document, install};

#[derive(Deserialize)]
struct WebOptions {
    #[serde(flatten)]
    host: ViewHostOptions,
    /// The font used when none is named. Default the first.
    #[serde(default, rename = "defaultFont")]
    default_font: Option<String>,
    /// An accessible name for the canvas.
    #[serde(default)]
    label: Option<String>,
}

/// The paint callback: given the frame's input, it draws through `WebDraw`
/// and returns the frame's output (core's `FrameOutput`, plus the CRT).
struct JsPainter(js_sys::Function);

impl Painter for JsPainter {
    fn paint(&mut self, input: &FrameInput) -> Option<FrameOutput> {
        let input = serde_wasm_bindgen::to_value(input).ok()?;
        match self.0.call1(&JsValue::NULL, &input) {
            Ok(out) => match serde_wasm_bindgen::from_value(out) {
                Ok(out) => Some(out),
                Err(e) => {
                    log::error!("synth-ui: the paint callback returned something that isn't a frame's output: {e}");
                    None
                }
            },
            Err(e) => {
                web_sys::console::error_2(&"synth-ui: painting failed:".into(), &e);
                None
            }
        }
    }
}

struct WebPlatform(Rc<Web>);

impl Platform for WebPlatform {
    fn set_cursor(&self, cursor: CursorStyle) {
        let _ = self.0.canvas.style().set_property("cursor", cursor.css_name());
    }

    fn update_text_input(&self, screen: &Screen, text: Option<&TextInputState>, shortcuts: &[String]) {
        self.0.update_text_input(screen, text, shortcuts);
    }
}

/// Events from the DOM into the host.
struct HostSink {
    host: Rc<ViewHost>,
    web: Rc<Web>,
}

impl Sink for HostSink {
    fn push(&self, e: InputEvent) {
        self.host.push_event(e);
    }

    fn to_virtual(&self, client_x: f64, client_y: f64) -> (f64, f64) {
        let screen = self.host.screen().clone();
        self.web.to_virtual(&screen, client_x, client_y)
    }
}

type FrameCallback = Closure<dyn FnMut(f64)>;

/// The resize observer on the canvas, and what it calls.
type Observer = (web_sys::ResizeObserver, Closure<dyn FnMut(js_sys::Array)>);

/// The frame clock: one `requestAnimationFrame` after another while running.
struct Clock {
    host: Rc<ViewHost>,
    web: Rc<Web>,
    running: Cell<bool>,
    request: Cell<Option<i32>>,
    callback: RefCell<Option<FrameCallback>>,
}

impl Clock {
    fn schedule(&self) {
        let window = web_sys::window().unwrap();
        if let Some(cb) = self.callback.borrow().as_ref() {
            self.request.set(window.request_animation_frame(cb.as_ref().unchecked_ref()).ok());
        }
    }

    fn cancel(&self) {
        if let Some(id) = self.request.take() {
            let _ = web_sys::window().unwrap().cancel_animation_frame(id);
        }
    }

    fn tick(&self, time: f64) {
        if !self.running.get() {
            return;
        }
        // The next frame first: whatever happens painting this one, the loop goes on.
        self.schedule();
        // Display changes the resize observer can't see, like moving to a screen with another DPR.
        let dpr = device_pixel_ratio();
        if dpr != self.host.screen().dpr() {
            sync_size(&self.host, &self.web, None);
        }
        self.host.on_vsync(time);
    }
}

impl Drop for Clock {
    fn drop(&mut self) {
        self.cancel();
    }
}

fn device_pixel_ratio() -> f64 {
    web_sys::window().map_or(1.0, |w| w.device_pixel_ratio()).max(f64::MIN_POSITIVE)
}

/// Size the canvas's backing store to its laid-out size in device pixels (the exact size when the
/// browser reports one and it agrees with CSS size × DPR; emulated DPRs don't always), and tell the host.
fn sync_size(host: &ViewHost, web: &Web, exact: Option<(u32, u32)>) {
    let dpr = device_pixel_ratio();
    let r = web.canvas.get_bounding_client_rect();
    let estimate = ((r.width() * dpr).round() as u32, (r.height() * dpr).round() as u32);
    let (w, h) = match exact {
        Some((w, h)) if w.abs_diff(estimate.0) <= 2 && h.abs_diff(estimate.1) <= 2 => (w, h),
        _ => estimate,
    };
    if w == 0 || h == 0 {
        return;
    }
    if web.canvas.width() != w {
        web.canvas.set_width(w);
    }
    if web.canvas.height() != h {
        web.canvas.set_height(h);
    }
    host.resize(w, h, dpr);
}

/// A view on a canvas. Make one with `create`, then `start` it.
#[wasm_bindgen]
pub struct WebViewHost {
    host: Rc<ViewHost>,
    web: Rc<Web>,
    clock: Rc<Clock>,
    listeners: RefCell<Vec<Listener>>,
    observer: RefCell<Option<Observer>>,
}

#[wasm_bindgen]
impl WebViewHost {
    /// A view on `canvas`, painted by `paint(input) → output`. `fonts` are
    /// `[name, face][]`, each face's glyphs and aliases as `[from, to][]`;
    /// `options` are the screen mode (`resolution` or `pixelScale`),
    /// `background`, `redraw`, `defaultFont` and `label`.
    pub async fn create(canvas: HtmlCanvasElement, paint: js_sys::Function, fonts: JsValue, options: JsValue) -> Result<WebViewHost, JsError> {
        let faces: Vec<(String, FontFace)> = serde_wasm_bindgen::from_value(fonts).map_err(|e| JsError::new(&format!("synth-ui: bad fonts: {e}")))?;
        let opts: WebOptions = serde_wasm_bindgen::from_value(options).map_err(|e| JsError::new(&format!("synth-ui: bad options: {e}")))?;
        let fonts = FontRegistry::new(&faces, opts.default_font.as_deref()).map_err(|e| JsError::new(&e))?;

        let navigator = web_sys::window().unwrap().navigator();
        let platform = navigator.platform().ok().filter(|p| !p.is_empty()).or_else(|| navigator.user_agent().ok()).unwrap_or_default();
        let mac = ["Mac", "iPhone", "iPad"].iter().any(|m| platform.contains(m));

        prepare(&canvas, opts.label.as_deref()).map_err(|_| JsError::new("synth-ui: can't style the canvas"))?;
        let web = Rc::new(Web::new(canvas.clone(), mac).map_err(|_| JsError::new("synth-ui: can't make the text agent"))?);

        let instance = wgpu::util::new_instance_with_webgpu_detection(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::BROWSER_WEBGPU | wgpu::Backends::GL,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        })
        .await;
        let host =
            ViewHost::new(&instance, wgpu::SurfaceTarget::Canvas(canvas), fonts, Box::new(JsPainter(paint)), Box::new(WebPlatform(web.clone())), opts.host).await.map_err(|e| JsError::new(&e))?;
        let host = Rc::new(host);
        document().body().ok_or_else(|| JsError::new("synth-ui: no body"))?.append_child(&web.agent).map_err(|_| JsError::new("synth-ui: can't add the text agent"))?;
        sync_size(&host, &web, None);

        let clock = Rc::new(Clock { host: host.clone(), web: web.clone(), running: Cell::new(false), request: Cell::new(None), callback: RefCell::new(None) });
        let weak = Rc::downgrade(&clock);
        *clock.callback.borrow_mut() = Some(Closure::new(move |time| {
            if let Some(clock) = weak.upgrade() {
                clock.tick(time);
            }
        }));

        let view = WebViewHost { host: host.clone(), web: web.clone(), clock, listeners: RefCell::new(Vec::new()), observer: RefCell::new(None) };
        view.listen();
        Ok(view)
    }

    /// The drawing and font API to paint with.
    pub fn draw(&self) -> WebDraw {
        WebDraw::new(self.host.draw_list())
    }

    /// Mod is Cmd here, as on a Mac, rather than Ctrl.
    #[wasm_bindgen(getter)]
    pub fn mac(&self) -> bool {
        self.web.mac
    }

    /// Whether burn-in can show on this GPU (it needs half-float render targets).
    #[wasm_bindgen(getter)]
    pub fn wears(&self) -> bool {
        self.host.wears()
    }

    /// Start drawing frames, as the host decides they're due.
    pub fn start(&self) {
        if !self.clock.running.replace(true) {
            self.clock.schedule();
        }
    }

    /// Stop drawing frames until `start()`.
    pub fn stop(&self) {
        self.clock.running.set(false);
        self.clock.cancel();
    }

    /// Something the UI shows changed: draw a frame even in 'auto' mode.
    pub fn invalidate(&self) {
        self.host.invalidate();
    }

    /// Stop for good: no more frames, and nothing left listening to the page.
    pub fn destroy(&self) {
        self.stop();
        for l in self.listeners.borrow().iter() {
            l.remove();
        }
        if let Some((observer, _)) = self.observer.borrow().as_ref() {
            observer.disconnect();
        }
        self.web.agent.remove();
        // This may be running inside one of these closures (a paint callback, say): drop them once it's done.
        let listeners = std::mem::take(&mut *self.listeners.borrow_mut());
        let observer = self.observer.borrow_mut().take();
        let callback = self.clock.callback.borrow_mut().take();
        wasm_bindgen_futures::spawn_local(async move {
            drop((listeners, observer, callback));
        });
    }
}

impl WebViewHost {
    fn listen(&self) {
        let sink: Rc<dyn Sink> = Rc::new(HostSink { host: self.host.clone(), web: self.web.clone() });
        let mut listeners = install(&self.web, sink);

        let (host, web) = (self.host.clone(), self.web.clone());
        let doc = document();
        let visibility = Closure::<dyn FnMut(web_sys::Event)>::new(move |_| {
            if document().hidden() {
                host.suspend();
            }
        });
        let _ = doc.add_event_listener_with_callback("visibilitychange", visibility.as_ref().unchecked_ref());
        listeners.push(Listener::from_parts(doc.into(), "visibilitychange", visibility));
        *self.listeners.borrow_mut() = listeners;

        let host = self.host.clone();
        let resized = Closure::<dyn FnMut(js_sys::Array)>::new(move |entries: js_sys::Array| {
            let exact = entries.get(0).dyn_into::<web_sys::ResizeObserverEntry>().ok().and_then(|entry| device_pixel_box(&entry));
            sync_size(&host, &web, exact);
        });
        if let Ok(observer) = web_sys::ResizeObserver::new(resized.as_ref().unchecked_ref()) {
            observer.observe(&self.web.canvas);
            *self.observer.borrow_mut() = Some((observer, resized));
        }
    }
}

/// The entry's size in device pixels, where the browser reports it.
fn device_pixel_box(entry: &web_sys::ResizeObserverEntry) -> Option<(u32, u32)> {
    let sizes = js_sys::Reflect::get(entry, &"devicePixelContentBoxSize".into()).ok()?;
    let size: web_sys::ResizeObserverSize = js_sys::Reflect::get(&sizes, &0.into()).ok()?.dyn_into().ok()?;
    Some((size.inline_size() as u32, size.block_size() as u32))
}

/// Make the canvas fill its box (unless the page sizes it), and keep the browser's gestures off it.
fn prepare(canvas: &HtmlCanvasElement, label: Option<&str>) -> Result<(), JsValue> {
    let s = canvas.style();
    // Its backing store is sized to its layout, so its layout mustn't follow its backing store.
    if s.get_property_value("width")?.is_empty() {
        s.set_property("width", "100%")?;
    }
    if s.get_property_value("height")?.is_empty() {
        s.set_property("height", "100%")?;
    }
    if s.get_property_value("display")?.is_empty() {
        s.set_property("display", "block")?;
    }
    s.set_property("touch-action", "none")?;
    s.set_property("user-select", "none")?;
    s.set_property("-webkit-user-select", "none")?;
    canvas.set_attribute("role", "application")?;
    if let Some(label) = label {
        canvas.set_attribute("aria-label", label)?;
    }
    Ok(())
}
