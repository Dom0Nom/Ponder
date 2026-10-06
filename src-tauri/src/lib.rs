mod commands;
mod db;
mod error;
mod focus;
mod ingest;
mod lan;
mod oauth;
mod proxy;
mod retrieval;
mod secrets;

use db::Db;
use std::path::PathBuf;
use tauri::Manager;

pub struct AppState {
    pub db: Db,
    pub data_dir: PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(focus::on_window_event)
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db = Db::open(data_dir.join("app.db"))?;
            ingest::start(app.handle(), db.clone(), data_dir.clone());
            focus::start(app.handle(), db.clone());
            app.manage(AppState { db, data_dir });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::core::list_spaces,
            commands::core::get_space,
            commands::core::create_space,
            commands::core::update_space,
            commands::core::touch_space,
            commands::core::delete_space,
            commands::core::list_sources,
            commands::core::get_source,
            commands::core::update_source,
            commands::core::delete_source,
            commands::core::get_source_text,
            commands::core::list_threads,
            commands::core::create_thread,
            commands::core::rename_thread,
            commands::core::delete_thread,
            commands::core::list_messages,
            commands::core::add_message,
            commands::core::update_message,
            commands::core::delete_message,
            commands::core::list_journal,
            commands::core::add_journal,
            commands::core::get_settings,
            commands::core::set_setting,
            ingest::commands::import_file,
            ingest::commands::import_text,
            ingest::commands::reindex_source,
            ingest::commands::search_chunks,
            ingest::commands::embedder_status,
            focus::commands::focus_start,
            focus::commands::focus_state,
            focus::commands::focus_pause,
            focus::commands::focus_resume,
            focus::commands::focus_need_app,
            focus::commands::focus_end_work,
            focus::commands::focus_stop,
            focus::commands::focus_set_summary,
            focus::commands::focus_history,
            focus::commands::focus_events,
            focus::commands::parking_add,
            focus::commands::parking_list,
            focus::commands::parking_resolve,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(focus::on_run_event);
}
