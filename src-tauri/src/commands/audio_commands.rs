use std::sync::Arc;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, State};
use crate::state::AppState;
use crate::error::CommandResult;

#[tauri::command]
pub async fn start_audio(
    app:   AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    if state.audio_running.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let channels = Arc::clone(&state.audio_channels);
    let running  = Arc::clone(&state.audio_running);
    crate::audio::spawn_audio_thread(app, channels, running);
    Ok(())
}

#[tauri::command]
pub async fn stop_audio(state: State<'_, AppState>) -> CommandResult<()> {
    state.audio_running.store(false, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn set_channel_volume(
    state:  State<'_, AppState>,
    id:     String,
    volume: f32,
) -> CommandResult<()> {
    let mut guard = state.audio_channels.lock().map_err(|e| e.to_string())?;
    if let Some(ch) = guard.get_mut(&id) {
        ch.volume = volume.clamp(0.0, 1.0);
    }
    Ok(())
}

#[tauri::command]
pub async fn set_channel_muted(
    state: State<'_, AppState>,
    id:    String,
    muted: bool,
) -> CommandResult<()> {
    let mut guard = state.audio_channels.lock().map_err(|e| e.to_string())?;
    if let Some(ch) = guard.get_mut(&id) {
        ch.muted = muted;
    }
    Ok(())
}
