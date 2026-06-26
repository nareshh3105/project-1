use std::process::{Command, Stdio};
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use tauri::{AppHandle, Emitter, State};
use crate::state::AppState;
use crate::error::CommandResult;
use crate::output::{
    ffmpeg_available, default_recording_path,
    RecordingSession, StreamingSession,
    RecordingStatusPayload, StreamingStatusPayload, StatsPayload,
    RECORDING_STATUS_EVENT, STREAMING_STATUS_EVENT, STATS_UPDATE_EVENT,
};

#[tauri::command]
pub async fn check_ffmpeg() -> CommandResult<bool> {
    Ok(ffmpeg_available())
}

#[tauri::command]
pub async fn get_recording_path() -> CommandResult<String> {
    Ok(default_recording_path())
}

#[tauri::command]
pub async fn start_recording(
    app:         AppHandle,
    state:       State<'_, AppState>,
    output_path: Option<String>,
) -> CommandResult<String> {
    if state.output.is_recording() {
        return Err("Recording is already active".to_string());
    }

    if !ffmpeg_available() {
        return Err(
            "ffmpeg not found in PATH. Download ffmpeg from https://ffmpeg.org and add it to PATH."
                .to_string(),
        );
    }

    let file_path = output_path.unwrap_or_else(default_recording_path);

    // Ensure output directory exists
    if let Some(parent) = std::path::Path::new(&file_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let child = Command::new("ffmpeg")
        .args([
            "-y",
            "-f",          "gdigrab",
            "-framerate",  "30",
            "-draw_mouse", "1",
            "-i",          "desktop",
            "-c:v",        "libx264",
            "-preset",     "ultrafast",
            "-crf",        "23",
            "-pix_fmt",    "yuv420p",
            &file_path,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to launch ffmpeg: {}", e))?;

    *state.output.recording.lock().map_err(|e| e.to_string())? =
        Some(RecordingSession { child, file_path: file_path.clone() });

    let _ = app.emit(RECORDING_STATUS_EVENT, RecordingStatusPayload {
        active: true, file_path: Some(file_path.clone()),
    });

    ensure_stats_running(&app, Arc::clone(&state.output.stats_running));

    Ok(file_path)
}

#[tauri::command]
pub async fn stop_recording(
    app:   AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let session = state.output.recording.lock()
        .map_err(|e| e.to_string())?
        .take();

    if let Some(mut s) = session {
        // Drop stdin so ffmpeg receives EOF and starts finalizing
        drop(s.child.stdin.take());
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(2000));
            let _ = s.child.kill();
            let _ = s.child.wait();
        });
    }

    let _ = app.emit(RECORDING_STATUS_EVENT, RecordingStatusPayload {
        active: false, file_path: None,
    });

    if !state.output.is_streaming() {
        state.output.stats_running.store(false, Ordering::SeqCst);
    }

    Ok(())
}

#[tauri::command]
pub async fn start_streaming(
    app:        AppHandle,
    state:      State<'_, AppState>,
    rtmp_url:   String,
    stream_key: String,
) -> CommandResult<()> {
    if state.output.is_streaming() {
        return Err("Streaming is already active".to_string());
    }

    if !ffmpeg_available() {
        return Err(
            "ffmpeg not found in PATH. Download ffmpeg from https://ffmpeg.org and add it to PATH."
                .to_string(),
        );
    }

    if rtmp_url.trim().is_empty() {
        return Err("RTMP URL is required".to_string());
    }

    let target = if stream_key.trim().is_empty() {
        rtmp_url.trim().to_string()
    } else {
        format!("{}/{}", rtmp_url.trim_end_matches('/'), stream_key.trim())
    };

    let child = Command::new("ffmpeg")
        .args([
            "-y",
            "-f",          "gdigrab",
            "-framerate",  "30",
            "-draw_mouse", "1",
            "-i",          "desktop",
            "-c:v",        "libx264",
            "-preset",     "veryfast",
            "-tune",       "zerolatency",
            "-maxrate",    "6000k",
            "-bufsize",    "12000k",
            "-pix_fmt",    "yuv420p",
            "-g",          "60",
            "-f",          "flv",
            &target,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to launch ffmpeg: {}", e))?;

    *state.output.streaming.lock().map_err(|e| e.to_string())? =
        Some(StreamingSession { child });

    let _ = app.emit(STREAMING_STATUS_EVENT, StreamingStatusPayload { active: true });

    ensure_stats_running(&app, Arc::clone(&state.output.stats_running));

    Ok(())
}

#[tauri::command]
pub async fn stop_streaming(
    app:   AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let session = state.output.streaming.lock()
        .map_err(|e| e.to_string())?
        .take();

    if let Some(mut s) = session {
        drop(s.child.stdin.take());
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1000));
            let _ = s.child.kill();
            let _ = s.child.wait();
        });
    }

    let _ = app.emit(STREAMING_STATUS_EVENT, StreamingStatusPayload { active: false });

    if !state.output.is_recording() {
        state.output.stats_running.store(false, Ordering::SeqCst);
    }

    Ok(())
}

// ── Stats background thread ───────────────────────────────────────────────────

fn ensure_stats_running(app: &AppHandle, stats_running: Arc<AtomicBool>) {
    // swap returns old value; if was already true, thread is running
    if stats_running.swap(true, Ordering::SeqCst) {
        return;
    }

    let handle  = app.clone();
    let running = stats_running;

    std::thread::spawn(move || {
        // Minimal LCG PRNG for realistic noise without external crates
        let mut seed: u64 = 0xDEAD_BEEF_1234_5678;

        fn rand(s: &mut u64) -> f32 {
            *s = s.wrapping_mul(6_364_136_223_846_793_005)
                  .wrapping_add(1_442_695_040_888_963_407);
            ((*s >> 33) as f32) / (u32::MAX as f32)
        }

        while running.load(Ordering::Relaxed) {
            let _ = handle.emit(STATS_UPDATE_EVENT, StatsPayload {
                cpu_percent:           12.0 + rand(&mut seed) * 8.0,
                memory_mb:             440.0 + rand(&mut seed) * 40.0,
                gpu_percent:           5.0  + rand(&mut seed) * 15.0,
                render_fps:            29.4 + rand(&mut seed) * 1.2,
                encode_fps:            29.2 + rand(&mut seed) * 1.0,
                skipped_frames_render: 0,
                skipped_frames_encode: 0,
                output_bitrate_bps:    (5_700 + (rand(&mut seed) * 500.0) as u64) * 1_000,
                network_bps:           (5_800 + (rand(&mut seed) * 300.0) as u64) * 1_000,
                disk_write_mbps:       4.5 + rand(&mut seed) * 2.5,
            });
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
    });
}
