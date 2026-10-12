//! `ponder://` links. Rust only collects them (cold start, a second launch, macOS open-URL events);
//! the UI takes them and parses them, so a link that arrives before the UI exists is not lost.
use crate::error::AppResult;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_deep_link::DeepLinkExt;

pub const SCHEME: &str = "ponder://";
const MAX_PENDING: usize = 16;

#[derive(Default)]
pub struct DeepLinks(Mutex<Vec<String>>);

impl DeepLinks {
    pub fn push(&self, urls: impl IntoIterator<Item = String>) -> bool {
        let mut q = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let before = q.len();
        for u in urls {
            if u.len() <= 8192 && u.get(..SCHEME.len()).is_some_and(|p| p.eq_ignore_ascii_case(SCHEME)) && q.len() < MAX_PENDING {
                q.push(u);
            }
        }
        q.len() > before
    }

    pub fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().unwrap_or_else(|e| e.into_inner()))
    }
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn deliver<R: Runtime>(app: &AppHandle<R>, urls: Vec<String>) {
    if app.state::<DeepLinks>().push(urls) {
        show_main(app);
        let _ = app.emit("deeplink://pending", ());
    }
}

pub fn init(app: &AppHandle) {
    let dl = app.deep_link();
    if let Ok(Some(urls)) = dl.get_current() {
        app.state::<DeepLinks>().push(urls.into_iter().map(String::from));
    }
    let handle = app.clone();
    dl.on_open_url(move |e| deliver(&handle, e.urls().into_iter().map(String::from).collect()));
    // installed bundles register the scheme themselves; running from a build folder needs it done here
    #[cfg(any(windows, target_os = "linux"))]
    if let Err(e) = dl.register_all() {
        log::warn!("couldn't register the ponder:// scheme: {e}");
    }
}

#[tauri::command]
pub async fn deeplink_take(links: State<'_, DeepLinks>) -> AppResult<Vec<String>> {
    Ok(links.take())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_ponder_links() {
        let q = DeepLinks::default();
        assert!(!q.push(["https://example.com".to_string(), "file:///etc/passwd".to_string()]));
        assert!(q.push(["ponder://space/abc".to_string(), "PONDER://ask?q=hi".to_string()]));
        assert_eq!(q.take(), vec!["ponder://space/abc", "PONDER://ask?q=hi"]);
        assert!(q.take().is_empty());
    }

    #[test]
    fn bounds_the_queue() {
        let q = DeepLinks::default();
        q.push((0..100).map(|i| format!("ponder://space/{i}")));
        assert_eq!(q.take().len(), MAX_PENDING);
        assert!(!q.push(["ponder://".to_string() + &"x".repeat(9000)]));
    }
}
