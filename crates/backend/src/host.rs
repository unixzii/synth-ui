//! The view host: one view's frames, from the display's tick to light on
//! the screen. The platform gives it a surface to draw on, ticks it every
//! display refresh (`on_vsync`), and feeds it input and size changes. The
//! host decides whether a tick draws, hands the painter the frame's input,
//! takes what it drew (through the `DrawList`), rasterizes it, and presents
//! it through the CRT; then it tells the platform what to do about the
//! cursor and text input.
//!
//! The painter may call back into the host while it paints (on the web it's
//! JavaScript, drawing through the host's exports), so the host keeps its
//! parts in separate cells and holds none of them across `Painter::paint`.

use std::cell::{Ref, RefCell};
use std::rc::Rc;

use serde::Deserialize;

use crate::draw::DrawList;
use crate::gpu::{Crt, Frame};
use crate::input::{CursorStyle, FrameInput, FrameOutput, InputEvent, TextInputState};
use crate::raster::{FontRegistry, Surface};
use crate::schedule::{Redraw, Schedule};
use crate::screen::{Screen, ScreenMode};

/// What draws the UI: given the frame's input, it draws through the host's
/// `DrawList` and says what happened. None if it failed; nothing is shown
/// then, and the next tick tries again.
pub trait Painter {
    fn paint(&mut self, input: &FrameInput) -> Option<FrameOutput>;
}

/// What the host asks of the platform after each frame.
pub trait Platform {
    /// The pointer's shape over the view.
    fn set_cursor(&self, cursor: CursorStyle);
    /// A text widget has focus (put the input method by its caret, keep the
    /// selection for copying), or none has. `shortcuts` are the combos the
    /// frame claimed, whose platform default should be stopped. `screen`
    /// places the caret: it's in virtual pixels.
    fn update_text_input(&self, screen: &Screen, text: Option<&TextInputState>, shortcuts: &[String]);
}

#[derive(Clone, Debug, Deserialize)]
pub struct ViewHostOptions {
    #[serde(flatten)]
    pub screen: ScreenMode,
    /// Index the frame is cleared to; also the letterbox colour.
    #[serde(default)]
    pub background: u8,
    #[serde(default)]
    pub redraw: Redraw,
}

pub struct ViewHost {
    draw: Rc<RefCell<DrawList>>,
    surface: RefCell<Surface>,
    crt: RefCell<Crt>,
    screen: RefCell<Screen>,
    schedule: RefCell<Schedule>,
    events: RefCell<Vec<InputEvent>>,
    painter: RefCell<Box<dyn Painter>>,
    platform: Box<dyn Platform>,
    background: u8,
    cursor: RefCell<Option<CursorStyle>>,
}

impl ViewHost {
    /// A host drawing on `target`, a surface of `instance`.
    pub async fn new(
        instance: &wgpu::Instance,
        target: wgpu::SurfaceTarget<'static>,
        fonts: FontRegistry,
        painter: Box<dyn Painter>,
        platform: Box<dyn Platform>,
        opts: ViewHostOptions,
    ) -> Result<Self, String> {
        let surface = instance.create_surface(target).map_err(|e| format!("synth-ui: can't draw on this surface: {e}"))?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::LowPower, compatible_surface: Some(&surface), ..Default::default() })
            .await
            .map_err(|e| format!("synth-ui: no GPU adapter: {e}"))?;
        let crt = Crt::new(&adapter, surface).await?;
        Ok(Self {
            draw: Rc::new(RefCell::new(DrawList::new(fonts))),
            surface: RefCell::new(Surface::default()),
            crt: RefCell::new(crt),
            screen: RefCell::new(Screen::new(opts.screen)),
            schedule: RefCell::new(Schedule::new(opts.redraw)),
            events: RefCell::new(Vec::new()),
            painter: RefCell::new(painter),
            platform,
            background: opts.background,
            cursor: RefCell::new(None),
        })
    }

    /// The drawing and font API painters draw and measure through.
    pub fn draw_list(&self) -> Rc<RefCell<DrawList>> {
        self.draw.clone()
    }

    pub fn screen(&self) -> Ref<'_, Screen> {
        self.screen.borrow()
    }

    /// Whether burn-in can show on this GPU.
    pub fn wears(&self) -> bool {
        self.crt.borrow().wears()
    }

    /// Input for the next frame, positions in virtual pixels (see `Screen::to_virtual`).
    pub fn push_event(&self, e: InputEvent) {
        self.events.borrow_mut().push(e);
    }

    /// The drawable is now `w`×`h` device pixels, at `dpr` device pixels per point.
    pub fn resize(&self, w: u32, h: u32, dpr: f64) {
        self.screen.borrow_mut().resize(w, h, dpr);
    }

    /// Something the UI shows changed: draw a frame even in 'auto' mode.
    pub fn invalidate(&self) {
        self.schedule.borrow_mut().invalidate();
    }

    /// The screen is off (say, the view is hidden) until the next frame: nothing wears or fades meanwhile.
    pub fn suspend(&self) {
        self.crt.borrow_mut().suspend();
    }

    /// The display refreshed at `time` (ms, steady): draw a frame if one is due.
    pub fn on_vsync(&self, time: f64) {
        // Take the input and start the frame, then let go of everything for the painter.
        let (input, due) = {
            let mut screen = self.screen.borrow_mut();
            if !screen.visible() {
                return;
            }
            let waiting = !self.events.borrow().is_empty();
            let resized = screen.take_resized();
            let Some(due) = self.schedule.borrow().due(time, waiting, resized) else { return };
            if resized {
                // Not drawn yet: keep it counted as a change.
                self.schedule.borrow_mut().invalidate();
            }
            let events = std::mem::take(&mut *self.events.borrow_mut());
            self.draw.borrow_mut().begin(screen.width as usize, screen.height as usize, self.background);
            (FrameInput { width: screen.width, height: screen.height, time, events }, due)
        };

        let Some(out) = self.painter.borrow_mut().paint(&input) else { return };

        self.schedule.borrow_mut().drawn(due, time, out.animating, out.fx.afterglow());
        {
            let draw = self.draw.borrow();
            let mut surface = self.surface.borrow_mut();
            draw.finish(&mut surface);
            let screen = self.screen.borrow();
            self.crt.borrow_mut().present(Frame {
                surface: &surface,
                palette: draw.palette(),
                palette_version: draw.palette_version(),
                background: draw.background(),
                device: screen.device,
                out: screen.out,
                origin: screen.origin,
                fx: &out.fx,
                time,
            });
        }
        if self.cursor.replace(Some(out.cursor)) != Some(out.cursor) {
            self.platform.set_cursor(out.cursor);
        }
        let screen = self.screen.borrow().clone();
        self.platform.update_text_input(&screen, out.text_input.as_ref(), &out.shortcuts);
    }
}
