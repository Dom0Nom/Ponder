//! Global ask-anything overlay window and screenshot snip.
use crate::capture::{parse_shortcut, register, unregister};
use crate::db::{models, Db};
use crate::error::{invalid, AppError, AppResult};
use crate::AppState;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::Shortcut;

pub const WINDOW_LABEL: &str = "ask";
pub const DEFAULT_SHORTCUT: &str = "Alt+CommandOrControl+A";
pub const DEFAULT_SNIP_SHORTCUT: &str = "Alt+CommandOrControl+S";
const WIDTH: f64 = 640.0;
const MIN_HEIGHT: f64 = 128.0;
const MAX_HEIGHT: f64 = 680.0;
const KEY_ENABLED: &str = "askEnabled";
const KEY_SHORTCUT: &str = "askShortcut";
const KEY_SNIP_ENABLED: &str = "askSnipEnabled";
const KEY_SNIP_SHORTCUT: &str = "askSnipShortcut";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AskStatus {
    pub enabled: bool,
    pub shortcut: String,
    pub registered: bool,
    pub error: Option<String>,
    pub snip_enabled: bool,
    pub snip_shortcut: String,
    pub snip_registered: bool,
    pub snip_error: Option<String>,
}

struct Inner {
    status: AskStatus,
    pending_snip: bool,
}

pub struct AskState(Mutex<Inner>);

impl AskState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
    fn status(&self) -> AskStatus {
        self.lock().status.clone()
    }
    fn set(&self, st: AskStatus) {
        self.lock().status = st;
    }
}

fn prefs(db: &Db) -> (bool, String, bool, String) {
    let Ok(c) = db.conn() else { return (true, DEFAULT_SHORTCUT.into(), false, DEFAULT_SNIP_SHORTCUT.into()) };
    let flag = |key: &str, default: bool| models::get_setting(&c, key).ok().flatten().and_then(|v| v.as_bool()).unwrap_or(default);
    let accel = |key: &str, default: &str| {
        models::get_setting(&c, key)
            .ok()
            .flatten()
            .and_then(|v| v.as_str().map(String::from))
            .filter(|s| parse_shortcut(s).is_ok())
            .unwrap_or_else(|| default.into())
    };
    (
        flag(KEY_ENABLED, true),
        accel(KEY_SHORTCUT, DEFAULT_SHORTCUT),
        flag(KEY_SNIP_ENABLED, false),
        accel(KEY_SNIP_SHORTCUT, DEFAULT_SNIP_SHORTCUT),
    )
}

fn same(a: &str, b: &str) -> bool {
    matches!((parse_shortcut(a), parse_shortcut(b)), (Ok(x), Ok(y)) if x == y)
}

/// Registers what the status asks for; each failure lands in that hotkey's error field.
fn apply<R: Runtime>(app: &AppHandle<R>, st: &mut AskStatus) {
    st.registered = false;
    st.snip_registered = false;
    st.error = None;
    st.snip_error = None;
    if st.enabled {
        match register(app, &st.shortcut) {
            Ok(()) => st.registered = true,
            Err(e) => st.error = Some(e),
        }
    }
    if st.snip_enabled {
        match register(app, &st.snip_shortcut) {
            Ok(()) => st.snip_registered = true,
            Err(e) => st.snip_error = Some(e),
        }
    }
}

fn release<R: Runtime>(app: &AppHandle<R>, st: &AskStatus) {
    if st.registered {
        unregister(app, &st.shortcut);
    }
    if st.snip_registered {
        unregister(app, &st.snip_shortcut);
    }
}

/// Registers on a worker thread (registration waits on the main thread, which would deadlock during setup).
pub fn init(app: &AppHandle, db: &Db) {
    let (enabled, shortcut, snip_enabled, snip_shortcut) = prefs(db);
    let mut st = AskStatus { enabled, shortcut, registered: false, error: None, snip_enabled, snip_shortcut, snip_registered: false, snip_error: None };
    app.manage(AskState(Mutex::new(Inner { status: st.clone(), pending_snip: false })));
    let app = app.clone();
    std::thread::spawn(move || {
        if let Some(cap) = crate::capture::current_shortcut(&app) {
            if same(&cap, &st.shortcut) {
                st.enabled = false;
            }
            if same(&cap, &st.snip_shortcut) {
                st.snip_enabled = false;
            }
        }
        apply(&app, &mut st);
        for e in [&st.error, &st.snip_error].into_iter().flatten() {
            log::warn!("ask shortcut not registered: {e}");
        }
        app.state::<AskState>().set(st.clone());
        let _ = app.emit("ask://status", st);
    });
}

/// Called for every global hotkey press; true when the key belonged to the overlay.
pub fn handle_hotkey<R: Runtime>(app: &AppHandle<R>, pressed: &Shortcut) -> bool {
    let Some(state) = app.try_state::<AskState>() else { return false };
    let st = state.status();
    if st.registered && parse_shortcut(&st.shortcut).is_ok_and(|s| s == *pressed) {
        match app.get_webview_window(WINDOW_LABEL) {
            Some(w) => {
                let _ = w.close();
            }
            None => summon(app, false),
        }
        return true;
    }
    if st.snip_registered && parse_shortcut(&st.snip_shortcut).is_ok_and(|s| s == *pressed) {
        summon(app, true);
        return true;
    }
    false
}

fn summon<R: Runtime>(app: &AppHandle<R>, snip: bool) {
    app.state::<AskState>().lock().pending_snip = snip;
    if let Some(w) = app.get_webview_window(WINDOW_LABEL) {
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit_to(WINDOW_LABEL, "ask://open", ());
        return;
    }
    let built = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App("index.html".into()))
        .title("Ask Ponder")
        .inner_size(WIDTH, MIN_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .focused(true)
        .build();
    if let Err(e) = built {
        log::warn!("couldn't open the ask window: {e}");
    }
}

#[tauri::command]
pub async fn ask_status(state: State<'_, AskState>) -> AppResult<AskStatus> {
    Ok(state.status())
}

#[tauri::command]
pub async fn ask_configure(
    app: AppHandle,
    state: State<'_, AppState>,
    ask: State<'_, AskState>,
    enabled: bool,
    shortcut: String,
    snip_enabled: bool,
    snip_shortcut: String,
) -> AppResult<AskStatus> {
    let shortcut = shortcut.trim().to_string();
    let snip_shortcut = snip_shortcut.trim().to_string();
    parse_shortcut(&shortcut)?;
    parse_shortcut(&snip_shortcut)?;
    if enabled && snip_enabled && same(&shortcut, &snip_shortcut) {
        return Err(invalid("The ask and snip shortcuts must be different."));
    }
    if let Some(cap) = crate::capture::current_shortcut(&app) {
        if (enabled && same(&cap, &shortcut)) || (snip_enabled && same(&cap, &snip_shortcut)) {
            return Err(invalid("That shortcut is already used by quick capture. Choose a different one."));
        }
    }
    let prev = ask.status();
    let db = state.db.clone();
    let next = tauri::async_runtime::spawn_blocking(move || -> AppResult<AskStatus> {
        release(&app, &prev);
        let mut next = AskStatus { enabled, shortcut, registered: false, error: None, snip_enabled, snip_shortcut, snip_registered: false, snip_error: None };
        apply(&app, &mut next);
        if let Some(e) = next.error.clone().or_else(|| next.snip_error.clone()) {
            release(&app, &next);
            let mut back = prev.clone();
            apply(&app, &mut back);
            return Err(invalid(e));
        }
        let c = db.conn()?;
        models::set_setting(&c, KEY_ENABLED, &serde_json::Value::Bool(enabled))?;
        models::set_setting(&c, KEY_SHORTCUT, &serde_json::Value::String(next.shortcut.clone()))?;
        models::set_setting(&c, KEY_SNIP_ENABLED, &serde_json::Value::Bool(snip_enabled))?;
        models::set_setting(&c, KEY_SNIP_SHORTCUT, &serde_json::Value::String(next.snip_shortcut.clone()))?;
        Ok(next)
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))??;
    ask.set(next.clone());
    Ok(next)
}

/// Whether the overlay was opened by the snip hotkey; read when the overlay starts or is summoned again.
#[tauri::command]
pub async fn ask_take_pending(state: State<'_, AskState>) -> AppResult<bool> {
    Ok(std::mem::take(&mut state.lock().pending_snip))
}

#[tauri::command]
pub async fn ask_close(app: AppHandle) -> AppResult<()> {
    if let Some(w) = app.get_webview_window(WINDOW_LABEL) {
        w.close().map_err(|e| AppError::Other(e.to_string()))?;
    }
    Ok(())
}

pub fn clamp_height(h: f64) -> f64 {
    if h.is_finite() {
        h.clamp(MIN_HEIGHT, MAX_HEIGHT)
    } else {
        MIN_HEIGHT
    }
}

#[tauri::command]
pub async fn ask_set_height(app: AppHandle, height: f64) -> AppResult<()> {
    if let Some(w) = app.get_webview_window(WINDOW_LABEL) {
        w.set_size(LogicalSize::new(WIDTH, clamp_height(height))).map_err(|e| AppError::Other(e.to_string()))?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequest {
    pub space_id: String,
    pub thread_id: String,
    pub source_id: Option<String>,
    pub start: Option<i64>,
    pub end: Option<i64>,
}

/// Brings the main window forward, tells it to show the thread, and closes the overlay.
#[tauri::command]
pub async fn ask_open_in_main(app: AppHandle, request: OpenRequest) -> AppResult<()> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    app.emit_to("main", "ask://navigate", request).map_err(|e| AppError::Other(e.to_string()))?;
    if let Some(w) = app.get_webview_window(WINDOW_LABEL) {
        let _ = w.close();
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnipImage {
    pub media_type: String,
    /// base64 PNG
    pub data: String,
}

pub fn temp_snip_path() -> PathBuf {
    std::env::temp_dir().join(format!("ponder-snip-{}.png", uuid::Uuid::new_v4()))
}

/// Reads the captured file and always deletes it. None when the user cancelled (no or empty file).
pub fn take_snip(path: &Path) -> AppResult<Option<Vec<u8>>> {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            let _ = std::fs::remove_file(path);
            return Err(e.into());
        }
    };
    let _ = std::fs::remove_file(path);
    Ok(if bytes.is_empty() { None } else { Some(bytes) })
}

#[cfg(target_os = "macos")]
fn capture_region(path: &Path) -> AppResult<()> {
    // exits without a file when the user presses Esc, so the exit status isn't an error signal
    std::process::Command::new("/usr/sbin/screencapture").args(["-i", "-x"]).arg(path).status()?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn capture_region(_path: &Path) -> AppResult<()> {
    Err(AppError::Other("Screen snip isn't supported on this system yet.".into()))
}

/// Interactive region select. The overlay hides while the user selects, then comes back.
#[tauri::command]
pub async fn snip_screen(app: AppHandle) -> AppResult<Option<SnipImage>> {
    let overlay = app.get_webview_window(WINDOW_LABEL).filter(|w| w.is_visible().unwrap_or(false));
    if let Some(w) = &overlay {
        let _ = w.hide();
    }
    let res = tauri::async_runtime::spawn_blocking(|| -> AppResult<Option<Vec<u8>>> {
        let path = temp_snip_path();
        let captured = capture_region(&path);
        let bytes = take_snip(&path);
        captured?;
        bytes
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()));
    if let Some(w) = &overlay {
        let _ = w.show();
        let _ = w.set_focus();
    }
    Ok(res??.map(|b| SnipImage { media_type: "image/png".into(), data: base64::engine::general_purpose::STANDARD.encode(b) }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_valid_and_distinct_from_capture() {
        assert!(parse_shortcut(DEFAULT_SHORTCUT).is_ok());
        assert!(parse_shortcut(DEFAULT_SNIP_SHORTCUT).is_ok());
        assert!(!same(DEFAULT_SHORTCUT, DEFAULT_SNIP_SHORTCUT));
        assert!(!same(DEFAULT_SHORTCUT, crate::capture::DEFAULT_SHORTCUT));
        assert!(!same(DEFAULT_SNIP_SHORTCUT, crate::capture::DEFAULT_SHORTCUT));
    }

    #[test]
    fn same_ignores_spelling() {
        assert!(same("Alt+CommandOrControl+A", " alt+cmdorctrl+a "));
        assert!(!same("Alt+CommandOrControl+A", "Alt+CommandOrControl+B"));
        assert!(!same("nonsense", "nonsense"));
    }

    #[test]
    fn prefs_default_and_ignore_invalid_saved_values() {
        let (db, _d) = crate::db::test_db();
        assert_eq!(prefs(&db), (true, DEFAULT_SHORTCUT.into(), false, DEFAULT_SNIP_SHORTCUT.into()));
        let c = db.conn().unwrap();
        models::set_setting(&c, KEY_ENABLED, &serde_json::json!(false)).unwrap();
        models::set_setting(&c, KEY_SNIP_ENABLED, &serde_json::json!(true)).unwrap();
        models::set_setting(&c, KEY_SHORTCUT, &serde_json::json!("Control+Alt+K")).unwrap();
        models::set_setting(&c, KEY_SNIP_SHORTCUT, &serde_json::json!("K")).unwrap();
        assert_eq!(prefs(&db), (false, "Control+Alt+K".into(), true, DEFAULT_SNIP_SHORTCUT.into()));
    }

    #[test]
    fn height_is_clamped() {
        assert_eq!(clamp_height(10.0), MIN_HEIGHT);
        assert_eq!(clamp_height(300.0), 300.0);
        assert_eq!(clamp_height(5000.0), MAX_HEIGHT);
        assert_eq!(clamp_height(f64::NAN), MIN_HEIGHT);
    }

    #[test]
    fn snip_paths_are_unique_pngs_in_the_temp_dir() {
        let (a, b) = (temp_snip_path(), temp_snip_path());
        assert_ne!(a, b);
        assert_eq!(a.extension().unwrap(), "png");
        assert_eq!(a.parent().unwrap(), std::env::temp_dir());
    }

    #[test]
    fn take_snip_reads_then_deletes_and_treats_missing_or_empty_as_cancel() {
        let path = temp_snip_path();
        assert!(take_snip(&path).unwrap().is_none());
        std::fs::write(&path, b"png-bytes").unwrap();
        assert_eq!(take_snip(&path).unwrap().unwrap(), b"png-bytes");
        assert!(!path.exists());
        std::fs::write(&path, b"").unwrap();
        assert!(take_snip(&path).unwrap().is_none());
        assert!(!path.exists());
    }
}
