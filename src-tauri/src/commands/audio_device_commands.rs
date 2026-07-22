use std::process::Command;
use crate::error::CommandResult;

/// Returns DirectShow audio device names available on Windows.
/// Runs `ffmpeg -list_devices true -f dshow -i dummy` and parses stdout+stderr.
#[tauri::command]
pub async fn list_audio_devices() -> CommandResult<Vec<String>> {
    let output = Command::new("ffmpeg")
        .args(["-list_devices", "true", "-f", "dshow", "-i", "dummy"])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    // ffmpeg writes device list to stderr
    let text = String::from_utf8_lossy(&output.stderr);

    let mut devices = Vec::new();
    let mut in_audio_section = false;

    for line in text.lines() {
        if line.contains("DirectShow audio devices") {
            in_audio_section = true;
            continue;
        }
        if line.contains("DirectShow video devices") {
            in_audio_section = false;
        }
        if !in_audio_section {
            continue;
        }
        // Lines look like: [dshow @ ......]  "Device Name"
        // Skip "Alternative name" lines
        if line.contains("Alternative name") {
            continue;
        }
        if let Some(start) = line.find('"') {
            if let Some(end) = line[start + 1..].find('"') {
                let name = &line[start + 1..start + 1 + end];
                if !name.is_empty() {
                    devices.push(name.to_string());
                }
            }
        }
    }

    Ok(devices)
}
