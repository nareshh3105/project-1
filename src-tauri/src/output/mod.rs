use std::process::Child;
use std::sync::{Arc, Mutex, atomic::AtomicBool};
use serde::Serialize;

pub const RECORDING_STATUS_EVENT: &str = "output:recording-status";
pub const STREAMING_STATUS_EVENT: &str = "output:streaming-status";
pub const STATS_UPDATE_EVENT:     &str = "stats:update";

// ── Event payloads ────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatusPayload {
    pub active:    bool,
    pub file_path: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamingStatusPayload {
    pub active: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsPayload {
    pub cpu_percent:           f32,
    pub memory_mb:             f32,
    pub gpu_percent:           f32,
    pub render_fps:            f32,
    pub encode_fps:            f32,
    pub skipped_frames_render: u32,
    pub skipped_frames_encode: u32,
    pub output_bitrate_bps:    u64,
    pub network_bps:           u64,
    pub disk_write_mbps:       f32,
}

// ── Session containers ────────────────────────────────────────────────────────

pub struct RecordingSession {
    pub child:     Child,
    pub file_path: String,
}

pub struct StreamingSession {
    pub child: Child,
}

// ── Output state (shared via AppState) ───────────────────────────────────────

pub struct OutputState {
    pub recording:     Arc<Mutex<Option<RecordingSession>>>,
    pub streaming:     Arc<Mutex<Option<StreamingSession>>>,
    pub stats_running: Arc<AtomicBool>,
}

impl OutputState {
    pub fn new() -> Self {
        OutputState {
            recording:     Arc::new(Mutex::new(None)),
            streaming:     Arc::new(Mutex::new(None)),
            stats_running: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn is_recording(&self) -> bool {
        self.recording.lock().map(|g| g.is_some()).unwrap_or(false)
    }

    pub fn is_streaming(&self) -> bool {
        self.streaming.lock().map(|g| g.is_some()).unwrap_or(false)
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

pub fn ffmpeg_available() -> bool {
    std::process::Command::new("ffmpeg")
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn default_recording_path() -> String {
    let home = std::env::var("USERPROFILE")
        .unwrap_or_else(|_| std::env::var("HOME").unwrap_or_else(|_| ".".to_string()));

    let ts = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    // MKV is resilient to abrupt termination (no moov-atom dependency)
    format!("{}/Videos/CodeBuilders_{}.mkv", home, ts)
}
