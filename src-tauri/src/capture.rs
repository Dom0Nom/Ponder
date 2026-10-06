//! Global quick-capture hotkey: shows the app and asks the UI to open the capture dialog.
use crate::db::{models, Db};
use crate::error::{invalid, AppResult};
use crate::AppState;
use serde::Serialize;
use std::str::FromStr;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub const DEFAULT_SHORTCUT: &str = "Alt+CommandOrControl+N";
const KEY_ENABLED: &str = "quickCaptureEnabled";
const KEY_SHORTCUT: &str = "quickCaptureShortcut";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    pub enabled: bool,
    pub shortcut: String,
    pub registered: bool,
    pub error: Option<String>,
}

pub struct CaptureState(Mutex<CaptureStatus>);

/// Validates an accelerator like `Alt+CommandOrControl+N`. Needs ⌘, ⌥ or ⌃ so it can't swallow typing.
pub fn parse_shortcut(s: &str) -> AppResult<Shortcut> {
    let s = s.trim();
    if s.is_empty() {
        return Err(invalid("Choose a shortcut."));
    }
    let sc = Shortcut::from_str(s).map_err(|_| invalid(format!("“{s}” isn't a valid shortcut.")))?;
    if !sc.mods.intersects(Modifiers::ALT | Modifiers::CONTROL | Modifiers::SUPER) {
        return Err(invalid("Add ⌘, ⌥ or ⌃ to the shortcut so it doesn't get in the way of typing."));
    }
    Ok(sc)
}

fn prefs(db: &Db) -> (bool, String) {
    let Ok(c) = db.conn() else { return (true, DEFAULT_SHORTCUT.into()) };
    let enabled = models::get_setting(&c, KEY_ENABLED).ok().flatten().and_then(|v| v.as_bool()).unwrap_or(true);
    let shortcut = models::get_setting(&c, KEY_SHORTCUT)
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(String::from))
        .filter(|s| parse_shortcut(s).is_ok())
        .unwrap_or_else(|| DEFAULT_SHORTCUT.into());
    (enabled, shortcut)
}

fn register<R: Runtime>(app: &AppHandle<R>, shortcut: &str) -> Result<(), String> {
    let sc = parse_shortcut(shortcut).map_err(|e| e.to_string())?;
    app.global_shortcut().register(sc).map_err(|e| {
        format!("This shortcut is already used by another app or by macOS. Choose a different one. ({e})")
    })
}

fn unregister<R: Runtime>(app: &AppHandle<R>, shortcut: &str) {
    if let Ok(sc) = parse_shortcut(shortcut) {
        let _ = app.global_shortcut().unregister(sc);
    }
}

pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let app = app.clone();
                // window calls from the hotkey callback would run re-entrantly on the main thread
                std::thread::spawn(move || open(&app));
            }
        })
        .build()
}

/// Reads the saved preference and registers the shortcut off the main thread
/// (registration dispatches to the main thread and waits, which would deadlock during setup).
pub fn init(app: &AppHandle, db: &Db) {
    let (enabled, shortcut) = prefs(db);
    app.manage(CaptureState(Mutex::new(CaptureStatus { enabled, shortcut: shortcut.clone(), registered: false, error: None })));
    if !enabled {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let res = register(&app, &shortcut);
        if let Err(e) = &res {
            log::warn!("quick capture shortcut not registered: {e}");
        }
        let state = app.state::<CaptureState>();
        let mut st = state.0.lock().unwrap_or_else(|e| e.into_inner());
        st.registered = res.is_ok();
        st.error = res.err();
        let _ = app.emit("capture://status", st.clone());
    });
}

pub fn open<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    let _ = app.emit("capture://open", ());
}

#[tauri::command]
pub async fn capture_status(cap: State<'_, CaptureState>) -> AppResult<CaptureStatus> {
    Ok(cap.0.lock().unwrap_or_else(|e| e.into_inner()).clone())
}

#[tauri::command]
pub async fn capture_configure(
    app: AppHandle,
    state: State<'_, AppState>,
    cap: State<'_, CaptureState>,
    enabled: bool,
    shortcut: String,
) -> AppResult<CaptureStatus> {
    let shortcut = shortcut.trim().to_string();
    parse_shortcut(&shortcut)?;
    let prev = cap.0.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let db = state.db.clone();
    let next = tauri::async_runtime::spawn_blocking(move || -> AppResult<CaptureStatus> {
        if prev.registered {
            unregister(&app, &prev.shortcut);
        }
        let mut next = CaptureStatus { enabled, shortcut, registered: false, error: None };
        if enabled {
            if let Err(e) = register(&app, &next.shortcut) {
                if prev.registered {
                    let _ = register(&app, &prev.shortcut);
                }
                return Err(invalid(e));
            }
            next.registered = true;
        }
        let c = db.conn()?;
        models::set_setting(&c, KEY_ENABLED, &serde_json::Value::Bool(enabled))?;
        models::set_setting(&c, KEY_SHORTCUT, &serde_json::Value::String(next.shortcut.clone()))?;
        Ok(next)
    })
    .await
    .map_err(|e| crate::error::AppError::Other(e.to_string()))??;
    *cap.0.lock().unwrap_or_else(|e| e.into_inner()) = next.clone();
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_global_shortcut::Code;

    #[test]
    fn parses_and_validates_shortcuts() {
        let sc = parse_shortcut(DEFAULT_SHORTCUT).unwrap();
        assert_eq!(sc.key, Code::KeyN);
        assert!(sc.mods.contains(Modifiers::ALT));
        assert!(parse_shortcut(" Control+Shift+Space ").is_ok());
        assert!(parse_shortcut("Super+Digit1").is_ok());
        for bad in ["", "N", "Shift+N", "Alt+", "Alt+N+M", "Alt+Bogus"] {
            assert!(parse_shortcut(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn prefs_default_and_ignore_invalid_saved_values() {
        let (db, _d) = crate::db::test_db();
        assert_eq!(prefs(&db), (true, DEFAULT_SHORTCUT.to_string()));
        let c = db.conn().unwrap();
        models::set_setting(&c, KEY_ENABLED, &serde_json::json!(false)).unwrap();
        models::set_setting(&c, KEY_SHORTCUT, &serde_json::json!("Control+Alt+K")).unwrap();
        assert_eq!(prefs(&db), (false, "Control+Alt+K".to_string()));
        models::set_setting(&c, KEY_SHORTCUT, &serde_json::json!("K")).unwrap();
        assert_eq!(prefs(&db).1, DEFAULT_SHORTCUT);
    }
}
