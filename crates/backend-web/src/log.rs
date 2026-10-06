//! `log` records, to the browser console.

use log::{Level, LevelFilter, Log, Metadata, Record};

struct Console;

impl Log for Console {
    fn enabled(&self, meta: &Metadata) -> bool {
        meta.level() <= Level::Warn
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let message = format!("{}", record.args()).into();
        match record.level() {
            Level::Error => web_sys::console::error_1(&message),
            _ => web_sys::console::warn_1(&message),
        }
    }

    fn flush(&self) {}
}

pub fn init() {
    if log::set_logger(&Console).is_ok() {
        log::set_max_level(LevelFilter::Warn);
    }
}
