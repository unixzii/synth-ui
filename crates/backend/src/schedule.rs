//! When a frame is due. The platform's clock ticks every display refresh;
//! the schedule decides whether that tick draws.

use serde::Deserialize;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Redraw {
    /// Every tick, for UIs showing something live.
    #[default]
    Always,
    /// Only when there's input, something animating, a resize, an
    /// invalidation, or the phosphors are still fading from the last change.
    Auto,
}

#[derive(Clone, Debug, Default)]
pub struct Schedule {
    pub redraw: Redraw,
    dirty: bool,
    animating: bool,
    settle_until: f64,
}

/// A frame the schedule decided to draw.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Due {
    /// Something new is drawn: the screen keeps changing for a while after.
    pub changed: bool,
}

impl Schedule {
    pub fn new(redraw: Redraw) -> Self {
        Self { redraw, dirty: true, animating: false, settle_until: 0.0 }
    }

    /// Something the UI shows changed: draw a frame even in 'auto' mode.
    pub fn invalidate(&mut self) {
        self.dirty = true;
    }

    /// Whether the tick at `time` draws, given whether input is waiting or the screen was resized.
    pub fn due(&self, time: f64, input: bool, resized: bool) -> Option<Due> {
        let changed = self.dirty || self.animating || input || resized;
        (self.redraw == Redraw::Always || changed || time < self.settle_until).then_some(Due { changed })
    }

    /// A frame was drawn at `time`; `afterglow` is how long its change keeps showing.
    pub fn drawn(&mut self, due: Due, time: f64, animating: bool, afterglow: f64) {
        self.dirty = false;
        self.animating = animating;
        if due.changed {
            self.settle_until = time + afterglow;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_draws_on_change_and_while_the_afterglow_settles() {
        let mut s = Schedule::new(Redraw::Auto);
        let due = s.due(0.0, false, false).expect("the first frame");
        s.drawn(due, 0.0, false, 20.0);
        assert_eq!(s.due(10.0, false, false), Some(Due { changed: false }));
        assert_eq!(s.due(20.0, false, false), None);
        assert_eq!(s.due(20.0, true, false), Some(Due { changed: true }));
        s.invalidate();
        let due = s.due(30.0, false, false).unwrap();
        s.drawn(due, 30.0, true, 0.0);
        assert!(s.due(40.0, false, false).is_some(), "still animating");
    }

    #[test]
    fn always_draws_every_tick() {
        let mut s = Schedule::new(Redraw::Always);
        let due = s.due(0.0, false, false).unwrap();
        s.drawn(due, 0.0, false, 0.0);
        assert_eq!(s.due(100.0, false, false), Some(Due { changed: false }));
    }
}
