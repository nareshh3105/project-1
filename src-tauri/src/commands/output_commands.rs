use std::io::Write as IoWrite;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, State};
use crate::state::AppState;
use crate::error::CommandResult;
use crate::output::{
    ffmpeg_available, default_recording_path,
    RecordingSession, StreamingSession, ReplaySession, VirtualCameraSession,
    RecordingStatusPayload, StreamingStatusPayload, ReplayStatusPayload, VirtualCameraStatusPayload,
    RECORDING_STATUS_EVENT, STREAMING_STATUS_EVENT, REPLAY_STATUS_EVENT, VIRTUAL_CAMERA_STATUS_EVENT,
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
    app:          AppHandle,
    state:        State<'_, AppState>,
    output_path:  Option<String>,
    audio_tracks: Option<Vec<String>>,
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

    if let Some(parent) = std::path::Path::new(&file_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let tracks = audio_tracks.unwrap_or_default();

    // Build args dynamically to support multi-track audio
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-f".into(),         "gdigrab".into(),
        "-framerate".into(), "30".into(),
        "-draw_mouse".into(),"1".into(),
        "-i".into(),         "desktop".into(),
    ];

    // Add one dshow audio input per track
    for device in &tracks {
        let dshow_input = format!("audio={}", device);
        args.push("-f".into());
        args.push("dshow".into());
        args.push("-i".into());
        args.push(dshow_input);
    }

    // Video encoder
    args.extend_from_slice(&[
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "ultrafast".into(),
        "-crf".into(), "23".into(),
        "-pix_fmt".into(), "yuv420p".into(),
    ]);

    // Audio encoders — one AAC stream per track
    for (i, _) in tracks.iter().enumerate() {
        args.push(format!("-c:a:{}", i));
        args.push("aac".into());
        args.push(format!("-b:a:{}", i));
        args.push("192k".into());
    }

    // Map video (input 0) + each audio input
    args.push("-map".into());
    args.push("0:v:0".into());
    for i in 0..tracks.len() {
        args.push("-map".into());
        args.push(format!("{}:a:0", i + 1));
    }

    args.push(file_path.clone());

    let child = Command::new("ffmpeg")
        .args(&args)
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

    Ok(())
}

// ── Replay Buffer ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_replay_buffer(
    app:         AppHandle,
    state:       State<'_, AppState>,
    buffer_secs: Option<u32>,
) -> CommandResult<()> {
    if state.output.is_replay_active() {
        return Err("Replay buffer is already running".to_string());
    }

    if !ffmpeg_available() {
        return Err(
            "ffmpeg not found in PATH. Download ffmpeg from https://ffmpeg.org and add it to PATH."
                .to_string(),
        );
    }

    let secs = buffer_secs.unwrap_or(30);

    // Temp dir for ring segments
    let segment_dir = std::env::temp_dir().join(format!("codebuilders_replay_{}", std::process::id()));
    std::fs::create_dir_all(&segment_dir).map_err(|e| e.to_string())?;

    let segment_pattern = segment_dir.join("seg%05d.mkv");
    let segment_str = segment_pattern.to_string_lossy().to_string();

    // Keep enough segments to cover the buffer + a few extra for overlap
    let max_files = (secs / 5) + 3;

    let child = Command::new("ffmpeg")
        .args([
            "-y",
            "-f",              "gdigrab",
            "-framerate",      "30",
            "-draw_mouse",     "1",
            "-i",              "desktop",
            "-c:v",            "libx264",
            "-preset",         "ultrafast",
            "-crf",            "23",
            "-pix_fmt",        "yuv420p",
            "-f",              "segment",
            "-segment_time",   "5",
            "-segment_wrap",   &max_files.to_string(),
            "-reset_timestamps", "1",
            &segment_str,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to launch ffmpeg: {}", e))?;

    *state.output.replay.lock().map_err(|e| e.to_string())? =
        Some(ReplaySession { child, segment_dir, buffer_secs: secs });

    let _ = app.emit(REPLAY_STATUS_EVENT, ReplayStatusPayload { active: true });

    Ok(())
}

#[tauri::command]
pub async fn stop_replay_buffer(
    app:   AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let session = state.output.replay.lock()
        .map_err(|e| e.to_string())?
        .take();

    if let Some(mut s) = session {
        drop(s.child.stdin.take());
        let seg_dir = s.segment_dir.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let _ = s.child.kill();
            let _ = s.child.wait();
            let _ = std::fs::remove_dir_all(&seg_dir);
        });
    }

    let _ = app.emit(REPLAY_STATUS_EVENT, ReplayStatusPayload { active: false });

    Ok(())
}

#[tauri::command]
pub async fn save_replay(
    state: State<'_, AppState>,
    output_path: Option<String>,
) -> CommandResult<String> {
    let guard = state.output.replay.lock().map_err(|e| e.to_string())?;

    let session = guard.as_ref().ok_or("Replay buffer is not running")?;
    let segment_dir  = session.segment_dir.clone();
    let buffer_secs  = session.buffer_secs;
    drop(guard);

    // Collect completed segments (exclude the one ffmpeg is actively writing)
    let mut segments: Vec<_> = std::fs::read_dir(&segment_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().extension().map(|x| x == "mkv").unwrap_or(false)
        })
        .collect();

    if segments.is_empty() {
        return Err("No replay segments available yet".to_string());
    }

    // Sort by modification time — oldest first
    segments.sort_by_key(|e| {
        e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH)
    });

    // Drop the last entry — it's the segment currently being written
    segments.pop();

    if segments.is_empty() {
        return Err("Not enough replay data yet — wait a few more seconds".to_string());
    }

    // Keep only the segments that fall within the buffer window
    let keep = ((buffer_secs / 5) as usize).max(1);
    let start_idx = segments.len().saturating_sub(keep);
    let segments = &segments[start_idx..];

    // Write concat list to a temp file
    let list_path = segment_dir.join("filelist.txt");
    {
        let mut f = std::fs::File::create(&list_path).map_err(|e| e.to_string())?;
        for seg in segments {
            let p = seg.path().to_string_lossy().replace('\\', "/");
            writeln!(f, "file '{}'", p).map_err(|e| e.to_string())?;
        }
    }

    let dest = output_path.unwrap_or_else(|| {
        let home = std::env::var("USERPROFILE")
            .unwrap_or_else(|_| std::env::var("HOME").unwrap_or_else(|_| ".".to_string()));
        let ts = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
        format!("{}/Videos/Replay_{}.mkv", home, ts)
    });

    if let Some(parent) = std::path::Path::new(&dest).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let list_str = list_path.to_string_lossy().to_string();

    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-f",     "concat",
            "-safe",  "0",
            "-i",     &list_str,
            "-c",     "copy",
            &dest,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("Failed to run ffmpeg concat: {}", e))?;

    let _ = std::fs::remove_file(&list_path);

    if !status.success() {
        return Err("ffmpeg concat failed — replay segments may be incomplete".to_string());
    }

    Ok(dest)
}

// ── Virtual Camera ─────────────────────────────────────────────────────────────

const VIRTUAL_CAMERA_PORT: u16 = 12345;

#[tauri::command]
pub async fn start_virtual_camera(
    app:   AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<String> {
    if state.output.is_virtual_camera_active() {
        return Err("Virtual camera is already active".to_string());
    }

    if !ffmpeg_available() {
        return Err(
            "ffmpeg not found in PATH. Download ffmpeg from https://ffmpeg.org and add it to PATH."
                .to_string(),
        );
    }

    let url = format!("udp://127.0.0.1:{}", VIRTUAL_CAMERA_PORT);

    let child = Command::new("ffmpeg")
        .args([
            "-y",
            "-f",          "gdigrab",
            "-framerate",  "30",
            "-draw_mouse", "1",
            "-i",          "desktop",
            "-c:v",        "libx264",
            "-preset",     "ultrafast",
            "-tune",       "zerolatency",
            "-pix_fmt",    "yuv420p",
            "-g",          "30",
            "-f",          "mpegts",
            &url,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to launch ffmpeg: {}", e))?;

    *state.output.virtual_camera.lock().map_err(|e| e.to_string())? =
        Some(VirtualCameraSession { child, url: url.clone() });

    let _ = app.emit(VIRTUAL_CAMERA_STATUS_EVENT, VirtualCameraStatusPayload {
        active: true,
        url:    Some(url.clone()),
    });

    Ok(url)
}

#[tauri::command]
pub async fn stop_virtual_camera(
    app:   AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let session = state.output.virtual_camera.lock()
        .map_err(|e| e.to_string())?
        .take();

    if let Some(mut s) = session {
        drop(s.child.stdin.take());
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let _ = s.child.kill();
            let _ = s.child.wait();
        });
    }

    let _ = app.emit(VIRTUAL_CAMERA_STATUS_EVENT, VirtualCameraStatusPayload {
        active: false,
        url:    None,
    });

    Ok(())
}
