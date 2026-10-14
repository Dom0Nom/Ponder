//! Menu-bar tray: live timer title and a small session menu.
use super::machine::{FocusState, PauseReason, Phase};
use super::service::{apply, set_tray_title, tray_title, FocusService};
use crate::db::now_ms;
use crate::i18n::t;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

const TRAY_ID: &str = "focus-tray";

pub struct TrayMenu {
    start: MenuItem<Wry>,
    pause: MenuItem<Wry>,
    end: MenuItem<Wry>,
    capture: MenuItem<Wry>,
    show: MenuItem<Wry>,
    quit: MenuItem<Wry>,
    key: Mutex<String>,
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let start = MenuItem::with_id(
        app,
        "focus-start",
        t("native.tray.start"),
        true,
        None::<&str>,
    )?;
    let pause = MenuItem::with_id(
        app,
        "focus-pause",
        t("native.tray.pause"),
        false,
        None::<&str>,
    )?;
    let end = MenuItem::with_id(app, "focus-end", t("native.tray.end"), false, None::<&str>)?;
    let capture = MenuItem::with_id(
        app,
        "capture-open",
        t("native.tray.capture"),
        true,
        None::<&str>,
    )?;
    let show = MenuItem::with_id(app, "focus-show", t("native.tray.show"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "focus-quit", t("native.tray.quit"), true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[&start, &pause, &end, &sep1, &capture, &show, &sep2, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("Ponder")
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_string();
            let app = app.clone();
            // window calls from the menu callback would run re-entrantly on the main thread
            std::thread::spawn(move || on_menu(&app, &id));
        });
    // monochrome template icon so macOS tints it for light/dark menu bars
    match tauri::image::Image::from_bytes(include_bytes!("../../icons/tray-template.png")) {
        Ok(icon) => builder = builder.icon(icon).icon_as_template(true),
        Err(_) => {
            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
        }
    }
    builder.build(app)?;
    app.manage(TrayMenu {
        start,
        pause,
        end,
        capture,
        show,
        quit,
        key: Mutex::new(String::new()),
    });
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
        "capture-open" => {
            crate::capture::open(app);
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

/// Sets every menu label again after the language changed.
pub fn relabel(app: &AppHandle) {
    let Some(menu) = app.try_state::<TrayMenu>() else {
        return;
    };
    let _ = menu.start.set_text(t("native.tray.start"));
    let _ = menu.end.set_text(t("native.tray.end"));
    let _ = menu.capture.set_text(t("native.tray.capture"));
    let _ = menu.show.set_text(t("native.tray.show"));
    let _ = menu.quit.set_text(t("native.tray.quit"));
    menu.key.lock().unwrap_or_else(|e| e.into_inner()).clear();
    let state = app
        .try_state::<FocusService>()
        .and_then(|svc| svc.snapshot(now_ms()));
    update(app, state.as_ref());
}

pub fn update(app: &AppHandle, state: Option<&FocusState>) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let title = tray_title(state);
    if set_tray_title(app, title.clone()) {
        let _ = tray.set_title(if title.is_empty() { None } else { Some(title) });
    }
    let Some(menu) = app.try_state::<TrayMenu>() else {
        return;
    };
    let (pause_text, pause_enabled) = match state {
        None => (t("native.tray.pause"), false),
        Some(s) if s.pause_reason == Some(PauseReason::NeedApp) => {
            (t("native.tray.resumeBreak"), true)
        }
        Some(s) if s.paused => (t("native.tray.resume"), true),
        Some(s) if s.phase == Phase::Work => (t("native.tray.pause"), true),
        Some(_) => (t("native.tray.pause"), false),
    };
    let key = format!("{}|{pause_text}|{pause_enabled}", state.is_some());
    let mut cur = menu.key.lock().unwrap_or_else(|e| e.into_inner());
    if *cur == key {
        return;
    }
    *cur = key;
    let _ = menu.start.set_enabled(state.is_none());
    let _ = menu.pause.set_text(&pause_text);
    let _ = menu.pause.set_enabled(pause_enabled);
    let _ = menu.end.set_enabled(state.is_some());
}
