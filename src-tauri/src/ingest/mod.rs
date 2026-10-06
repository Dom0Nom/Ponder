//! Source ingestion: extract → chunk → embed → index. Runs on a dedicated worker thread.
pub mod commands;

use crate::db::Db;
use tauri::AppHandle;

pub fn start(_app: &AppHandle, _db: Db, _data_dir: std::path::PathBuf) {}
