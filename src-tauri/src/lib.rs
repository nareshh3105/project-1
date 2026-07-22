pub mod audio;
pub mod commands;
pub mod db;
pub mod error;
pub mod output;
pub mod state;

use state::AppState;
use tauri::Manager;
use std::sync::{Arc, Mutex, atomic::AtomicBool};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "codebuilders=debug,tauri=info".to_string()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let db_path = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir")
                .join("codebuilders.db");

            let pool = tauri::async_runtime::block_on(db::init(&db_path))
                .expect("failed to initialize database");

            app.manage(AppState {
                db:              pool,
                preview_running: Arc::new(AtomicBool::new(false)),
                audio_channels:  Arc::new(Mutex::new(audio::default_channels())),
                audio_running:   Arc::new(AtomicBool::new(false)),
                output:          output::OutputState::new(),
            });

            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_commands::get_app_version,
            commands::app_commands::get_platform_info,
            commands::collection_commands::list_collections,
            commands::collection_commands::create_collection,
            commands::collection_commands::rename_collection,
            commands::collection_commands::delete_collection,
            commands::collection_commands::duplicate_collection,
            commands::scene_commands::init_default_collection,
            commands::scene_commands::list_scenes,
            commands::scene_commands::create_scene,
            commands::scene_commands::rename_scene,
            commands::scene_commands::delete_scene,
            commands::scene_commands::reorder_scenes,
            commands::scene_commands::duplicate_scene,
            commands::source_commands::list_sources,
            commands::source_commands::add_source,
            commands::source_commands::rename_source,
            commands::source_commands::remove_source,
            commands::source_commands::set_source_visible,
            commands::source_commands::set_source_locked,
            commands::source_commands::reorder_sources,
            commands::preview_commands::start_preview,
            commands::preview_commands::stop_preview,
            commands::audio_commands::start_audio,
            commands::audio_commands::stop_audio,
            commands::audio_commands::set_channel_volume,
            commands::audio_commands::set_channel_muted,
            commands::output_commands::check_ffmpeg,
            commands::output_commands::get_recording_path,
            commands::output_commands::start_recording,
            commands::output_commands::stop_recording,
            commands::output_commands::start_streaming,
            commands::output_commands::stop_streaming,
            commands::plugin_commands::list_plugins,
            commands::plugin_commands::discover_plugins,
            commands::plugin_commands::enable_plugin,
            commands::plugin_commands::disable_plugin,
            commands::plugin_commands::get_plugins_folder,
            commands::plugin_commands::open_plugins_folder,
            commands::plugin_commands::read_plugin_script,
            commands::plugin_commands::uninstall_plugin,
            commands::stats_commands::start_stats_polling,
            commands::output_commands::start_replay_buffer,
            commands::output_commands::stop_replay_buffer,
            commands::output_commands::save_replay,
            commands::updater_commands::check_for_updates,
            commands::updater_commands::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
