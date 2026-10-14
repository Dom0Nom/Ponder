//! Focus timer: pure state machine (machine.rs) + service (tick thread, persistence, tray, window).
pub mod commands;
pub mod distraction;
pub mod machine;
pub mod service;
pub mod tray;

use crate::db::{now_ms, Db};
use service::{FocusService, UiSync};
use tauri::{AppHandle, Manager, RunEvent, Window, WindowEvent};

pub fn start(app: &AppHandle, db: Db) {
    let svc = FocusService::new(db);
    let restored = svc.restore(now_ms());
    app.manage(svc);
    app.manage(UiSync::default());
    app.manage(distraction::DistractionService::default());
    if let Err(e) = tray::setup(app) {
        log::error!("tray setup failed: {e}");
    }
    match restored {
        Ok(out) => service::apply(app, &out),
        Err(e) => log::error!("restoring focus session failed: {e}"),
    }
    service::spawn_ticker(app.clone());
}

fn break_locked(app: &AppHandle) -> bool {
    app.try_state::<FocusService>()
        .is_some_and(|s| s.is_break_locked())
}

/// Blocks closing and keeps the window fullscreen while a break is locked.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    let app = window.app_handle();
    match event {
        WindowEvent::CloseRequested { api, .. } if break_locked(app) => api.prevent_close(),
        WindowEvent::Resized(_) | WindowEvent::Focused(true) if break_locked(app) => {
            let app = app.clone();
            std::thread::spawn(move || service::enforce_fullscreen(&app));
        }
        _ => {}
    }
}

pub fn on_run_event(app: &AppHandle, event: RunEvent) {
    if let RunEvent::ExitRequested { api, .. } = event {
        if break_locked(app) {
            api.prevent_exit();
        }
    }
}
