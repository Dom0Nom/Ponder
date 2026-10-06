//! Focus music: plays a playlist during work blocks and pauses it on breaks.
pub mod transition;
pub mod uri;

use crate::db::models::get_setting;
use crate::error::{invalid, AppError, AppResult};
use crate::focus::machine::FocusState;
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use transition::{Action, Tracker};

pub const SETTINGS_KEY: &str = "focus.music";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicStatus {
    pub available: bool,
    pub backend: Option<String>,
    pub running: bool,
    pub last_error: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct MusicPrefs {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    playlist: String,
}

/// A player that can be controlled on this machine. Other platforms add their own (e.g. Spotify Web API).
pub trait MusicBackend: Send + Sync {
    fn name(&self) -> &'static str;
    fn available(&self) -> bool;
    fn running(&self) -> bool;
    fn play_playlist(&self, uri: &str) -> AppResult<()>;
    fn resume(&self) -> AppResult<()>;
    /// Must never launch the player.
    fn pause(&self) -> AppResult<()>;
}

fn backend_status(b: &dyn MusicBackend) -> MusicStatus {
    let available = b.available();
    MusicStatus {
        available,
        backend: available.then(|| b.name().to_string()),
        running: available && b.running(),
        last_error: None,
    }
}

pub struct MusicService {
    backend: Arc<dyn MusicBackend>,
    tracker: Mutex<Option<Tracker>>,
    last_error: Mutex<Option<String>>,
    /// keeps player commands in the order they were issued
    exec: Mutex<()>,
}

impl MusicService {
    pub fn new(backend: Arc<dyn MusicBackend>) -> Self {
        MusicService { backend, tracker: Mutex::new(None), last_error: Mutex::new(None), exec: Mutex::new(()) }
    }

    fn set_error(&self, app: &AppHandle, err: Option<String>) {
        *self.last_error.lock().unwrap_or_else(|e| e.into_inner()) = err.clone();
        let _ = app.emit("music://error", err);
    }

    fn status(&self) -> MusicStatus {
        let mut st = backend_status(self.backend.as_ref());
        st.last_error = self.last_error.lock().unwrap_or_else(|e| e.into_inner()).clone();
        st
    }

    fn run(&self, action: Action, uri: &str) -> AppResult<()> {
        let _guard = self.exec.lock().unwrap_or_else(|e| e.into_inner());
        match action {
            Action::Start => self.backend.play_playlist(uri),
            Action::Resume if self.backend.running() => self.backend.resume(),
            Action::Resume => self.backend.play_playlist(uri),
            Action::Pause => self.backend.pause(),
        }
    }
}

fn read_prefs(app: &AppHandle) -> Option<MusicPrefs> {
    let state = app.try_state::<AppState>()?;
    let c = state.db.conn().ok()?;
    let v = get_setting(&c, SETTINGS_KEY).ok()??;
    serde_json::from_value(v).ok()
}

/// Called after every focus outcome. The first call only records the current state (a restored
/// session must not start or stop music); later calls act on changes of the desired state.
pub fn sync(app: &AppHandle, state: Option<&FocusState>) {
    let Some(svc) = app.try_state::<MusicService>() else { return };
    let mut guard = svc.tracker.lock().unwrap_or_else(|e| e.into_inner());
    let Some(prev) = guard.as_ref() else {
        *guard = Some(transition::initial(state));
        return;
    };
    let (mut next, action) = transition::next(prev, state);
    let Some(action) = action else {
        *guard = Some(next);
        return;
    };
    let prefs = read_prefs(app).filter(|p| p.enabled);
    let uri = prefs.as_ref().and_then(|p| uri::parse_playlist(&p.playlist).ok());
    if uri.is_none() {
        if action != Action::Pause {
            next.started = prev.started.clone();
        }
        *guard = Some(next);
        return;
    }
    *guard = Some(next);
    drop(guard);
    let uri = uri.unwrap_or_default();
    let app = app.clone();
    std::thread::spawn(move || {
        let svc = app.state::<MusicService>();
        match svc.run(action, &uri) {
            Ok(()) => {
                if action != Action::Pause {
                    svc.set_error(&app, None);
                }
            }
            Err(e) => {
                log::warn!("focus music {action:?} failed: {e}");
                svc.set_error(&app, Some(e.to_string()));
            }
        }
    });
}

#[tauri::command]
pub async fn music_status(svc: State<'_, MusicService>) -> AppResult<MusicStatus> {
    let backend = svc.backend.clone();
    let mut st = tauri::async_runtime::spawn_blocking(move || backend_status(backend.as_ref()))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;
    st.last_error = svc.last_error.lock().unwrap_or_else(|e| e.into_inner()).clone();
    Ok(st)
}

#[tauri::command]
pub async fn music_test(app: AppHandle, svc: State<'_, MusicService>, playlist: String) -> AppResult<()> {
    let uri = uri::parse_playlist(&playlist)?;
    if !svc.backend.available() {
        return Err(invalid("Spotify isn't installed"));
    }
    let backend = svc.backend.clone();
    let res = tauri::async_runtime::spawn_blocking(move || backend.play_playlist(&uri))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;
    match &res {
        Ok(()) => svc.set_error(&app, None),
        Err(e) => {
            log::warn!("focus music test failed: {e}");
            svc.set_error(&app, Some(e.to_string()));
        }
    }
    res
}

#[tauri::command]
pub async fn music_pause(app: AppHandle, svc: State<'_, MusicService>) -> AppResult<()> {
    let backend = svc.backend.clone();
    let res = tauri::async_runtime::spawn_blocking(move || backend.pause())
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;
    if let Err(e) = &res {
        svc.set_error(&app, Some(e.to_string()));
    }
    res
}

#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(target_os = "macos"))]
mod unsupported;

pub fn default_backend() -> Arc<dyn MusicBackend> {
    #[cfg(target_os = "macos")]
    return Arc::new(macos::SpotifyAppleScript);
    #[cfg(not(target_os = "macos"))]
    return Arc::new(unsupported::Unsupported);
}
