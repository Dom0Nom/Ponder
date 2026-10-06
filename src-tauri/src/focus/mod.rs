//! Focus timer: pure state machine (machine.rs) + service (tick thread, persistence, tray, window).
use crate::db::Db;
use tauri::AppHandle;

pub fn start(_app: &AppHandle, _db: Db) {}
