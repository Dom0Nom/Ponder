use crate::error::{AppError, AppResult};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const WINDOW_LABEL: &str = "calculator";
pub const WIDTH: f64 = 400.0;
pub const HEIGHT: f64 = 560.0;

/// Opens the calculator in its own always-on-top window, or focuses it when it is already open.
/// The frontend renders only the calculator when its window label is `calculator`.
#[tauri::command]
pub async fn open_calculator_window(app: AppHandle, title: String) -> AppResult<()> {
    let err = |e: tauri::Error| AppError::Other(e.to_string());
    if let Some(w) = app.get_webview_window(WINDOW_LABEL) {
        w.unminimize().map_err(err)?;
        w.show().map_err(err)?;
        w.set_focus().map_err(err)?;
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, WINDOW_LABEL, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .maximizable(false)
        .always_on_top(true)
        .build()
        .map_err(err)?;
    Ok(())
}
