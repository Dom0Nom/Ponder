mod annotations;
mod ask;
mod backup;
mod calculator;
mod ccode;
mod capture;
mod context;
#[cfg(debug_assertions)]
pub mod devserve;
mod cards;
pub mod cli;
mod cloud;
mod commands;
mod db;
mod deeplink;
mod error;
mod exams;
mod focus;
mod i18n;
mod icons;
mod inbox;
mod ingest;
mod insights;
mod lan;
pub mod mcp;
mod mcp_client;
mod mcp_oauth;
mod micro_steps;
mod music;
mod notes;
mod oauth;
mod openrouter;
mod pack;
pub mod paths;
mod placement;
mod plans;
mod practice;
mod projects;
mod proxy;
mod retrieval;
mod secrets;
mod studio;
mod watch;

use db::Db;
use std::path::PathBuf;
use tauri::Manager;

pub struct AppState {
    pub db: Db,
    pub data_dir: PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        deeplink::show_main(app)
    }));
    builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(capture::plugin())
        .on_window_event(focus::on_window_event)
        .manage(music::MusicService::new(music::default_backend()))
        .manage(backup::BackupService::default())
        .manage(deeplink::DeepLinks::default())
        .manage(mcp_client::McpClients::default())
        .manage(commands::providers::ProviderServices::new())
        .manage(std::sync::Arc::new(cloud::CloudServices::new(
            secrets::default_store(),
        )))
        .setup(|app| {
            let data_dir = paths::dev_data_dir_override().unwrap_or(app.path().app_data_dir()?);
            std::fs::create_dir_all(&data_dir)?;
            secrets::init(&data_dir);
            match backup::apply_pending_restore(&data_dir) {
                Ok(true) => log::info!("restored the database from a backup"),
                Ok(false) => {}
                Err(e) => log::error!("restoring the backup failed: {e}"),
            }
            let db = Db::open(data_dir.join("app.db"))?;
            i18n::init(app.handle(), &db);
            ingest::start(app.handle(), db.clone(), data_dir.clone());
            focus::start(app.handle(), db.clone());
            watch::start(app.handle(), db.clone());
            capture::init(app.handle(), &db);
            ask::init(app.handle(), &db);
            backup::start(app.handle(), db.clone(), data_dir.clone());
            deeplink::init(app.handle());
            inbox::start(app.handle(), db.clone());
            app.manage(AppState { db, data_dir });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backup::backup_status,
            backup::backup_configure,
            backup::backup_choose_folder,
            backup::backup_now,
            backup::backup_delete,
            backup::backup_restore,
            backup::backup_cancel_restore,
            backup::restart_app,
            deeplink::deeplink_take,
            inbox::inbox_pending,
            inbox::inbox_finish,
            cli::integrations_info,
            pack::pack_export,
            pack::pack_import,
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
            commands::core::source_pdf,
            commands::core::list_threads,
            commands::core::create_thread,
            commands::core::rename_thread,
            commands::core::pin_thread,
            commands::core::delete_thread,
            commands::core::list_messages,
            commands::core::add_message,
            commands::core::update_message,
            commands::core::delete_message,
            commands::core::list_journal,
            commands::core::add_journal,
            commands::core::get_settings,
            commands::core::set_setting,
            i18n::set_locale,
            focus::distraction::running_apps,
            music::music_status,
            music::music_test,
            music::music_pause,
            cards::cards_add,
            cards::card_update,
            cards::card_delete,
            cards::cards_list,
            cards::cards_due,
            cards::cards_due_counts,
            cards::card_review,
            cards::mistakes_add,
            cards::mistakes_list,
            insights::insights_activity,
            exams::exam_save,
            exams::exams_list,
            exams::exam_get,
            exams::exam_delete,
            ccode::run_c,
            projects::projects_list,
            projects::project_save,
            projects::project_delete,
            projects::milestone_save,
            projects::milestone_delete,
            projects::milestone_done,
            projects::log_add,
            projects::log_delete,
            studio::output_save,
            studio::outputs_list,
            studio::output_get,
            studio::output_delete,
            studio::export_file,
            studio::print_window,
            annotations::annotations_list,
            annotations::annotation_add,
            annotations::annotation_update,
            annotations::annotation_delete,
            mcp_client::mcp_client_tools,
            mcp_client::mcp_client_call,
            mcp_client::mcp_client_stop,
            mcp_client::mcp_client_auth_status,
            mcp_client::mcp_client_sign_in,
            mcp_client::mcp_client_sign_out,
            notes::notes_list,
            notes::note_get,
            notes::note_save,
            notes::note_delete,
            notes::glossary_get,
            notes::glossary_save,
            notes::rewrites_list,
            notes::rewrite_save,
            cards::mistake_set_resolved,
            cards::mistake_delete,
            cards::image_store,
            cards::image_read,
            micro_steps::micro_steps_list,
            micro_steps::micro_steps_replace,
            micro_steps::micro_step_set_done,
            micro_steps::micro_step_update,
            micro_steps::micro_step_delete,
            micro_steps::micro_steps_clear,
            practice::abilities_list,
            practice::ability_get,
            practice::practice_item_add,
            practice::practice_recent,
            practice::practice_attempt,
            practice::mistake_set_error_type,
            practice::error_patterns_list,
            placement::curriculum_get,
            placement::curriculum_set,
            placement::curriculum_clear,
            placement::topic_levels,
            placement::topic_level_set,
            placement::assessment_create,
            placement::assessment_complete,
            placement::assessments_list,
            placement::courses_list,
            placement::course_create,
            placement::course_delete,
            placement::lesson_set_status,
            plans::get_study_plan,
            plans::save_study_plan,
            plans::set_plan_task_done,
            plans::delete_study_plan,
            plans::list_plan_tasks,
            commands::core::list_memory,
            commands::core::add_memory,
            commands::core::update_memory,
            commands::core::delete_memory,
            ingest::commands::import_file,
            ingest::commands::import_text,
            ingest::commands::reindex_source,
            ingest::commands::search_chunks,
            ingest::commands::embedder_status,
            ingest::commands::embedding_models,
            ingest::commands::set_embedding_model,
            ingest::commands::openrouter_embedding_models,
            context::search_many_chunks,
            context::read_source_ranges,
            context::source_outlines,
            context::set_source_context_mode,
            context::save_thread_summary,
            context::set_thread_auto_compact,
            context::get_thread,
            ingest::commands::topic_coverage,
            watch::commands::watch_list,
            watch::commands::watch_add,
            watch::commands::watch_remove,
            calculator::open_calculator_window,
            ask::ask_status,
            ask::ask_configure,
            ask::ask_take_pending,
            ask::ask_close,
            ask::ask_set_height,
            ask::ask_open_in_main,
            ask::snip_screen,
            capture::capture_status,
            capture::capture_configure,
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
            commands::providers::list_providers,
            commands::providers::save_provider,
            commands::providers::delete_provider,
            commands::providers::secret_set,
            commands::providers::secret_has,
            commands::providers::secret_delete,
            commands::providers::lan_scan,
            commands::providers::oauth_chatgpt_start,
            commands::providers::oauth_xai_device_start,
            commands::providers::oauth_status,
            commands::providers::oauth_sign_out,
            commands::providers::http_stream,
            commands::providers::http_bytes,
            commands::providers::http_abort,
            commands::providers::http_get_text,
            commands::providers::list_openrouter_models,
            commands::providers::site_icon,
            cloud::commands::cloud_status,
            cloud::commands::cloud_set_client,
            cloud::commands::cloud_connect,
            cloud::commands::cloud_disconnect,
            cloud::commands::cloud_list,
            cloud::commands::cloud_import,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(focus::on_run_event);
}

/// The streaming proxy without Tauri, for `examples/proxy_stream.rs` (scripts/stream-check.ts).
#[doc(hidden)]
pub mod dev_proxy {
    pub use crate::proxy::{run, stream_client, Prepared, ProxyEvent};
}
