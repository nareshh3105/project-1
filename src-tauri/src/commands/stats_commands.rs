use serde::Serialize;
use sysinfo::System;
use tauri::{AppHandle, Emitter};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStats {
    pub cpu_percent:           f64,
    pub memory_mb:             f64,
    pub gpu_percent:           f64,
    pub render_fps:            f64,
    pub encode_fps:            f64,
    pub skipped_frames_render: u32,
    pub skipped_frames_encode: u32,
    pub output_bitrate_bps:    u64,
    pub network_bps:           u64,
    pub disk_write_mbps:       f64,
}

static POLLING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub async fn start_stats_polling(app: AppHandle) {
    // Guard: only one polling loop allowed
    if POLLING.swap(true, Ordering::SeqCst) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let mut sys = System::new();

        // Prime CPU counters — first call establishes a baseline
        sys.refresh_cpu_usage();
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        loop {
            sys.refresh_cpu_usage();
            sys.refresh_memory();

            let stats = RuntimeStats {
                cpu_percent:           sys.global_cpu_info().cpu_usage() as f64,
                memory_mb:             sys.used_memory() as f64 / (1024.0 * 1024.0),
                gpu_percent:           0.0,
                render_fps:            30.0,
                encode_fps:            0.0,
                skipped_frames_render: 0,
                skipped_frames_encode: 0,
                output_bitrate_bps:    0,
                network_bps:           0,
                disk_write_mbps:       0.0,
            };

            let _ = app.emit("stats:update", &stats);

            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    });
}
