//! Menu-bar tray: live timer title and a small session menu.
use super::machine::{FocusState, PauseReason, Phase};
use super::service::{apply, set_tray_title, tray_title, FocusService};
use crate::db::now_ms;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

const TRAY_ID: &str = "focus-tray";

pub struct TrayMenu {
    start: MenuItem<Wry>,
    pause: MenuItem<Wry>,
    end: MenuItem<Wry>,
    key: Mutex<String>,
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let start = MenuItem::with_id(app, "focus-start", "Start focus session", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "focus-pause", "Pause", false, None::<&str>)?;
    let end = MenuItem::with_id(app, "focus-end", "End session", false, None::<&str>)?;
    let show = MenuItem::with_id(app, "focus-show", "Show app", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "focus-quit", "Quit", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&start, &pause, &end, &sep1, &show, &sep2, &quit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("AI Learning App")
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_string();
            let app = app.clone();
            // window calls from the menu callback would run re-entrantly on the main thread
            std::thread::spawn(move || on_menu(&app, &id));
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    app.manage(TrayMenu { start, pause, end, key: Mutex::new(String::new()) });
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn on_menu(app: &AppHandle, id: &str) {
    let svc = app.state::<FocusService>();
    let now = now_ms();
    let res = match id {
        "focus-start" => {
            show_main(app);
            let _ = app.emit("focus://request-start", ());
            return;
        }
        "focus-show" => {
            show_main(app);
            return;
        }
        "focus-quit" => {
            app.exit(0);
            return;
        }
        "focus-pause" => match svc.snapshot(now) {
            Some(s) if s.paused => svc.resume(now),
            Some(s) if s.phase == Phase::Work => svc.pause(now),
            _ => return,
        },
        "focus-end" => svc.stop(now).map(|(_, out)| out),
        _ => return,
    };
    match res {
        Ok(out) => apply(app, &out),
        Err(e) => log::warn!("tray action {id} failed: {e}"),
    }
}

pub fn update(app: &AppHandle, state: Option<&FocusState>) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let title = tray_title(state);
    if set_tray_title(app, title.clone()) {
        let _ = tray.set_title(if title.is_empty() { None } else { Some(title) });
    }
    let Some(menu) = app.try_state::<TrayMenu>() else { return };
    let (pause_text, pause_enabled) = match state {
        None => ("Pause", false),
        Some(s) if s.pause_reason == Some(PauseReason::NeedApp) => ("Resume break", true),
        Some(s) if s.paused => ("Resume", true),
        Some(s) if s.phase == Phase::Work => ("Pause", true),
        Some(_) => ("Pause", false),
    };
    let key = format!("{}|{pause_text}|{pause_enabled}", state.is_some());
    let mut cur = menu.key.lock().unwrap_or_else(|e| e.into_inner());
    if *cur == key {
        return;
    }
    *cur = key;
    let _ = menu.start.set_enabled(state.is_none());
    let _ = menu.pause.set_text(pause_text);
    let _ = menu.pause.set_enabled(pause_enabled);
    let _ = menu.end.set_enabled(state.is_some());
}
