use super::machine::{FocusConfig, FocusState};
use super::service::{apply, FocusEvent, FocusService, FocusSessionSummary, Outcome, ParkingItem};
use crate::db::now_ms;
use crate::error::{invalid, AppResult};
use tauri::{AppHandle, State};

fn finish(app: &AppHandle, out: AppResult<Outcome>) -> AppResult<FocusState> {
    let out = out?;
    apply(app, &out);
    out.state
        .ok_or_else(|| invalid("No focus session is running"))
}

#[tauri::command]
pub async fn focus_start(
    app: AppHandle,
    svc: State<'_, FocusService>,
    config: FocusConfig,
) -> AppResult<FocusState> {
    finish(&app, svc.start(config, now_ms()))
}

#[tauri::command]
pub async fn focus_state(svc: State<'_, FocusService>) -> AppResult<Option<FocusState>> {
    Ok(svc.snapshot(now_ms()))
}

#[tauri::command]
pub async fn focus_pause(app: AppHandle, svc: State<'_, FocusService>) -> AppResult<FocusState> {
    finish(&app, svc.pause(now_ms()))
}

#[tauri::command]
pub async fn focus_resume(app: AppHandle, svc: State<'_, FocusService>) -> AppResult<FocusState> {
    finish(&app, svc.resume(now_ms()))
}

#[tauri::command]
pub async fn focus_need_app(
    app: AppHandle,
    svc: State<'_, FocusService>,
    reason: Option<String>,
) -> AppResult<FocusState> {
    finish(&app, svc.need_app(now_ms(), reason))
}

#[tauri::command]
pub async fn focus_end_work(app: AppHandle, svc: State<'_, FocusService>) -> AppResult<FocusState> {
    finish(&app, svc.end_work(now_ms()))
}

#[tauri::command]
pub async fn focus_stop(
    app: AppHandle,
    svc: State<'_, FocusService>,
) -> AppResult<FocusSessionSummary> {
    let (summary, out) = svc.stop(now_ms())?;
    apply(&app, &out);
    Ok(summary)
}

#[tauri::command]
pub async fn focus_set_summary(
    svc: State<'_, FocusService>,
    session_id: String,
    summary: String,
) -> AppResult<()> {
    svc.set_summary(&session_id, &summary)
}

#[tauri::command]
pub async fn focus_history(
    svc: State<'_, FocusService>,
    space_id: Option<String>,
) -> AppResult<Vec<FocusSessionSummary>> {
    svc.history(space_id.as_deref())
}

#[tauri::command]
pub async fn focus_events(
    svc: State<'_, FocusService>,
    session_id: String,
) -> AppResult<Vec<FocusEvent>> {
    svc.events(&session_id)
}

#[tauri::command]
pub async fn parking_add(svc: State<'_, FocusService>, text: String) -> AppResult<ParkingItem> {
    svc.parking_add(&text, now_ms())
}

#[tauri::command]
pub async fn parking_list(
    svc: State<'_, FocusService>,
    session_id: Option<String>,
) -> AppResult<Vec<ParkingItem>> {
    svc.parking_list(session_id.as_deref())
}

#[tauri::command]
pub async fn parking_resolve(svc: State<'_, FocusService>, id: String) -> AppResult<()> {
    svc.parking_resolve(&id)
}
