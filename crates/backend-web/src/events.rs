//! DOM events → the core's input events, queued on the host until the next
//! frame.
//!
//! Typing goes through a text agent: one off-screen textarea, focused only
//! while a text widget has focus, used purely as a source of events — typed
//! characters, input-method composition, paste, copy and cut, and the soft
//! keyboard on touch screens. Nothing reads its value as state; it's emptied
//! as soon as text arrives. Caret, selection, undo and drawing all belong to
//! the widget.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use synth_backend::input::{combo_of, is_typing_combo};
use synth_backend::{InputEvent, Modifiers, Screen, TextInputState};
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;
use web_sys::{
    AddEventListenerOptions, ClipboardEvent, CompositionEvent, Event, EventTarget, HtmlCanvasElement, HtmlElement, HtmlTextAreaElement, KeyboardEvent, MouseEvent, PointerEvent, WheelEvent,
};

/// The web side of a view: the canvas, the text agent, and what the last
/// frame said, for decisions that can't wait for the next one.
pub struct Web {
    pub canvas: HtmlCanvasElement,
    pub agent: HtmlTextAreaElement,
    pub mac: bool,
    /// Set while a text widget has focus.
    pub text: RefCell<Option<TextInputState>>,
    pub shortcuts: RefCell<Vec<String>>,
    down: Cell<bool>,
    composing: Cell<bool>,
}

impl Web {
    pub fn new(canvas: HtmlCanvasElement, mac: bool) -> Result<Self, JsValue> {
        let agent = make_agent()?;
        Ok(Self { canvas, agent, mac, text: RefCell::new(None), shortcuts: RefCell::new(Vec::new()), down: Cell::new(false), composing: Cell::new(false) })
    }

    /// Device pixels on the canvas's backing store per CSS pixel, as it's laid out now.
    fn backing_scale(&self) -> (f64, f64, web_sys::DomRect) {
        let r = self.canvas.get_bounding_client_rect();
        let sx = if r.width() > 0.0 { self.canvas.width() as f64 / r.width() } else { 1.0 };
        let sy = if r.height() > 0.0 { self.canvas.height() as f64 / r.height() } else { 1.0 };
        (sx, sy, r)
    }

    /// Client (CSS) coordinates → virtual pixels.
    pub fn to_virtual(&self, screen: &Screen, client_x: f64, client_y: f64) -> (f64, f64) {
        let (sx, sy, r) = self.backing_scale();
        screen.to_virtual((client_x - r.left()) * sx, (client_y - r.top()) * sy)
    }

    /// Take in what the frame decided: keep the selection and shortcuts, and
    /// focus the agent by the caret while a text widget has focus.
    pub fn update_text_input(&self, screen: &Screen, text: Option<&TextInputState>, shortcuts: &[String]) {
        *self.text.borrow_mut() = text.cloned();
        *self.shortcuts.borrow_mut() = shortcuts.to_vec();
        // Focusing and blurring can fire events right away, into listeners that borrow the above.
        let doc = document();
        let focused = doc.active_element().is_some_and(|e| e == **self.agent);
        match text {
            Some(t) => {
                let (sx, sy, r) = self.backing_scale();
                let (x, y, _, h) = screen.to_device(t.caret.x, t.caret.y, t.caret.w, t.caret.h);
                let s = self.agent.style();
                let _ = s.set_property("left", &format!("{}px", r.left() + x / sx));
                let _ = s.set_property("top", &format!("{}px", r.top() + y / sy));
                let _ = s.set_property("height", &format!("{}px", (h / sy).max(1.0)));
                if !focused {
                    let opts = web_sys::FocusOptions::new();
                    opts.set_prevent_scroll(true);
                    let _ = self.agent.focus_with_options(&opts);
                }
            }
            None if focused => {
                let _ = self.agent.blur();
            }
            None => {}
        }
    }

    /// Events meant for some other editable element on the page.
    fn foreign(&self, target: Option<EventTarget>) -> bool {
        let Some(el) = target.and_then(|t| t.dyn_into::<HtmlElement>().ok()) else { return false };
        if el == *self.agent {
            return false;
        }
        el.is_content_editable() || el.is_instance_of::<web_sys::HtmlInputElement>() || el.is_instance_of::<HtmlTextAreaElement>() || el.is_instance_of::<web_sys::HtmlSelectElement>()
    }

    /// Stop the browser's own action for keys the UI uses: shortcuts it claimed,
    /// Tab (focus moves inside the UI), and while a text widget has focus, the
    /// editing keys it handles itself. Typing and Mod+C/X/V keep their default,
    /// or the agent would never see the text or the clipboard — even when they're
    /// also shortcuts (Space, a letter), which don't fire while a text widget has focus.
    fn should_prevent(&self, e: &KeyboardEvent) -> bool {
        let key = e.key();
        let combo = combo_of(&key, mods(e), self.mac);
        if key == "Tab" {
            return true;
        }
        if self.text.borrow().is_none() || !is_typing_combo(&combo) {
            return self.shortcuts.borrow().contains(&combo);
        }
        let m = if self.mac { e.meta_key() } else { e.ctrl_key() };
        if m && "cvx".contains(&key.to_lowercase()) {
            return false;
        }
        !(key.encode_utf16().count() == 1 && !m)
    }
}

pub fn document() -> web_sys::Document {
    web_sys::window().and_then(|w| w.document()).expect("synth-ui: no document")
}

fn mods(e: &impl ModifierState) -> Modifiers {
    e.modifiers()
}

trait ModifierState {
    fn modifiers(&self) -> Modifiers;
}

impl ModifierState for MouseEvent {
    fn modifiers(&self) -> Modifiers {
        Modifiers { shift: self.shift_key(), ctrl: self.ctrl_key(), alt: self.alt_key(), meta: self.meta_key() }
    }
}

impl ModifierState for KeyboardEvent {
    fn modifiers(&self) -> Modifiers {
        Modifiers { shift: self.shift_key(), ctrl: self.ctrl_key(), alt: self.alt_key(), meta: self.meta_key() }
    }
}

fn make_agent() -> Result<HtmlTextAreaElement, JsValue> {
    let a: HtmlTextAreaElement = document().create_element("textarea")?.dyn_into()?;
    for (k, v) in [("autocapitalize", "off"), ("autocomplete", "off"), ("autocorrect", "off"), ("spellcheck", "false"), ("tabindex", "-1"), ("aria-hidden", "true")] {
        a.set_attribute(k, v)?;
    }
    let s = a.style();
    for (k, v) in [
        ("position", "fixed"),
        ("left", "0"),
        ("top", "0"),
        ("width", "1px"),
        ("height", "1px"),
        ("padding", "0"),
        ("margin", "0"),
        ("border", "0"),
        ("outline", "none"),
        ("resize", "none"),
        ("overflow", "hidden"),
        ("opacity", "0"),
        ("pointer-events", "none"),
        ("background", "transparent"),
        ("color", "transparent"),
        ("caret-color", "transparent"),
        // 16px keeps iOS from zooming in when it takes focus.
        ("font-size", "16px"),
        ("line-height", "1"),
        ("white-space", "pre"),
    ] {
        s.set_property(k, v)?;
    }
    Ok(a)
}

/// A DOM listener, kept so it can be removed again.
pub struct Listener {
    target: EventTarget,
    kind: &'static str,
    closure: Closure<dyn FnMut(Event)>,
}

impl Listener {
    /// One already listening.
    pub fn from_parts(target: EventTarget, kind: &'static str, closure: Closure<dyn FnMut(Event)>) -> Self {
        Self { target, kind, closure }
    }

    pub fn remove(&self) {
        let _ = self.target.remove_event_listener_with_callback(self.kind, self.closure.as_ref().unchecked_ref());
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        self.remove();
    }
}

fn listen(out: &mut Vec<Listener>, target: &EventTarget, kind: &'static str, passive: bool, f: impl FnMut(Event) + 'static) {
    let closure = Closure::<dyn FnMut(Event)>::new(f);
    let opts = AddEventListenerOptions::new();
    opts.set_passive(passive);
    let _ = target.add_event_listener_with_callback_and_add_event_listener_options(kind, closure.as_ref().unchecked_ref(), &opts);
    out.push(Listener { target: target.clone(), kind, closure });
}

/// Where events go: the host's queue, with the screen to place them by.
pub trait Sink: 'static {
    fn push(&self, e: InputEvent);
    fn to_virtual(&self, client_x: f64, client_y: f64) -> (f64, f64);
}

/// Listen to the canvas, the window and the agent, for the view's input.
pub fn install(web: &Rc<Web>, sink: Rc<dyn Sink>) -> Vec<Listener> {
    let mut out = Vec::new();
    let canvas: &EventTarget = web.canvas.as_ref();
    let window: EventTarget = web_sys::window().expect("synth-ui: no window").into();
    let agent: &EventTarget = web.agent.as_ref();

    {
        let sink = sink.clone();
        listen(&mut out, canvas, "pointermove", true, move |e| {
            let e: PointerEvent = e.unchecked_into();
            let (x, y) = sink.to_virtual(e.client_x() as f64, e.client_y() as f64);
            sink.push(InputEvent::PointerMove { x, y, mods: mods(&*e) });
        });
    }
    {
        let (sink, web) = (sink.clone(), web.clone());
        listen(&mut out, canvas, "pointerleave", true, move |_| {
            if !web.down.get() {
                sink.push(InputEvent::PointerLeave);
            }
        });
    }
    {
        let (sink, web) = (sink.clone(), web.clone());
        listen(&mut out, canvas, "pointerdown", true, move |e| {
            let e: PointerEvent = e.unchecked_into();
            // Keep receiving moves while dragging off the canvas. Synthetic events have no pointer to capture.
            let _ = web.canvas.set_pointer_capture(e.pointer_id());
            if e.button() == 0 {
                web.down.set(true);
            }
            let (x, y) = sink.to_virtual(e.client_x() as f64, e.client_y() as f64);
            sink.push(InputEvent::PointerDown { x, y, button: e.button(), mods: mods(&*e) });
        });
    }
    // The UI decides what has focus: presses on the canvas mustn't take it from the agent.
    listen(&mut out, canvas, "mousedown", false, |e| e.prevent_default());
    for kind in ["pointerup", "pointercancel"] {
        let (sink, web) = (sink.clone(), web.clone());
        listen(&mut out, canvas, kind, true, move |e| {
            let e: PointerEvent = e.unchecked_into();
            if e.button() == 0 {
                web.down.set(false);
            }
            let (x, y) = sink.to_virtual(e.client_x() as f64, e.client_y() as f64);
            sink.push(InputEvent::PointerUp { x, y, button: e.button(), mods: mods(&*e) });
        });
    }
    {
        let sink = sink.clone();
        listen(&mut out, canvas, "wheel", false, move |e| {
            e.prevent_default();
            let e: WheelEvent = e.unchecked_into();
            let px = |d: f64| match e.delta_mode() {
                1 => d * 16.0,
                2 => d * 400.0,
                _ => d,
            };
            // With shift held, macOS turns vertical scrolling into horizontal: that stays vertical,
            // as a modifier. Otherwise a sideways swipe scrolls sideways, whichever way it mostly goes.
            let sideways = !e.shift_key() && e.delta_x().abs() > e.delta_y().abs();
            let dx = if sideways { px(e.delta_x()) } else { 0.0 };
            let dy = if sideways {
                0.0
            } else {
                px(if e.delta_y() != 0.0 {
                    e.delta_y()
                } else if e.shift_key() {
                    e.delta_x()
                } else {
                    0.0
                })
            };
            let (x, y) = sink.to_virtual(e.client_x() as f64, e.client_y() as f64);
            sink.push(InputEvent::Wheel { x, y, dx, dy, mods: mods(&*e) });
        });
    }
    listen(&mut out, canvas, "contextmenu", false, |e| e.prevent_default());

    {
        let (sink, web) = (sink.clone(), web.clone());
        listen(&mut out, &window, "keydown", false, move |e| {
            if web.foreign(e.target()) {
                return;
            }
            let e: KeyboardEvent = e.unchecked_into();
            // The input method's; composition events cover it.
            if e.is_composing() || e.key_code() == 229 {
                return;
            }
            if web.should_prevent(&e) {
                e.prevent_default();
            }
            sink.push(InputEvent::KeyDown { key: e.key(), code: e.code(), repeat: e.repeat(), mods: mods(&e) });
        });
    }
    {
        let (sink, web) = (sink.clone(), web.clone());
        listen(&mut out, &window, "keyup", true, move |e| {
            let e: KeyboardEvent = e.unchecked_into();
            if web.foreign(e.target()) || e.is_composing() {
                return;
            }
            sink.push(InputEvent::KeyUp { key: e.key(), code: e.code(), mods: mods(&e) });
        });
    }
    {
        let sink = sink.clone();
        listen(&mut out, &window, "blur", true, move |_| sink.push(InputEvent::Blur));
    }

    {
        let (sink, web) = (sink.clone(), web.clone());
        listen(&mut out, agent, "input", true, move |_| {
            if web.composing.get() {
                return;
            }
            let text = web.agent.value();
            if !text.is_empty() {
                sink.push(InputEvent::Text { text });
            }
            web.agent.set_value("");
        });
    }
    {
        let web = web.clone();
        listen(&mut out, agent, "compositionstart", true, move |_| web.composing.set(true));
    }
    {
        let sink = sink.clone();
        listen(&mut out, agent, "compositionupdate", true, move |e| {
            let e: CompositionEvent = e.unchecked_into();
            sink.push(InputEvent::Composition { text: e.data().unwrap_or_default() });
        });
    }
    {
        let (sink, web) = (sink.clone(), web.clone());
        listen(&mut out, agent, "compositionend", true, move |e| {
            let e: CompositionEvent = e.unchecked_into();
            web.composing.set(false);
            sink.push(InputEvent::Composition { text: String::new() });
            if let Some(text) = e.data().filter(|t| !t.is_empty()) {
                sink.push(InputEvent::Text { text });
            }
            web.agent.set_value("");
        });
    }
    {
        let sink = sink.clone();
        listen(&mut out, agent, "paste", false, move |e| {
            e.prevent_default();
            let e: ClipboardEvent = e.unchecked_into();
            let text = e.clipboard_data().and_then(|d| d.get_data("text/plain").ok()).unwrap_or_default();
            if !text.is_empty() {
                sink.push(InputEvent::Paste { text });
            }
        });
    }
    for (kind, cut) in [("copy", false), ("cut", true)] {
        let (sink, web) = (sink.clone(), web.clone());
        listen(&mut out, agent, kind, false, move |e| {
            let selection = match web.text.borrow().as_ref() {
                Some(t) if !t.selection.is_empty() => t.selection.clone(),
                _ => return,
            };
            e.prevent_default();
            let e: ClipboardEvent = e.unchecked_into();
            if let Some(data) = e.clipboard_data() {
                let _ = data.set_data("text/plain", &selection);
            }
            if cut {
                sink.push(InputEvent::Cut);
            }
        });
    }
    out
}
