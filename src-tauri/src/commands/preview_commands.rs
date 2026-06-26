use std::sync::{Arc, atomic::Ordering};
use tauri::{AppHandle, Emitter};
use crate::{state::AppState, error::CommandResult};

const PREVIEW_EVENT: &str = "preview:frame";
// ~15 fps for preview — keeps IPC overhead manageable
const FRAME_INTERVAL_MS: u64 = 66;

#[tauri::command]
pub async fn start_preview(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> CommandResult<()> {
    // Swap returns previous value — if was already true, already running
    if state.preview_running.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    let running = Arc::clone(&state.preview_running);
    let handle  = app.clone();

    std::thread::spawn(move || {
        use screenshots::Screen;
        use image::{DynamicImage, ImageOutputFormat};
        use base64::{engine::general_purpose, Engine as _};
        use std::io::Cursor;

        let frame_dur = std::time::Duration::from_millis(FRAME_INTERVAL_MS);

        while running.load(Ordering::Relaxed) {
            let t = std::time::Instant::now();

            'frame: {
                let screens = match Screen::all() {
                    Ok(s) if !s.is_empty() => s,
                    _ => break 'frame,
                };

                // screenshots 0.8+ returns image::RgbaImage directly
                let cap = match screens[0].capture() {
                    Ok(c) => c,
                    Err(_) => break 'frame,
                };

                // Downscale to 640×360 to keep JPEG payload small
                let preview = DynamicImage::ImageRgba8(cap).thumbnail(640, 360);

                let mut buf = Cursor::new(Vec::<u8>::new());
                if preview
                    .write_to(&mut buf, ImageOutputFormat::Jpeg(60))
                    .is_err()
                {
                    break 'frame;
                }

                let data_url = format!(
                    "data:image/jpeg;base64,{}",
                    general_purpose::STANDARD.encode(buf.into_inner())
                );

                let _ = handle.emit(PREVIEW_EVENT, data_url);
            }

            let elapsed = t.elapsed();
            if elapsed < frame_dur {
                std::thread::sleep(frame_dur - elapsed);
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_preview(state: tauri::State<'_, AppState>) -> CommandResult<()> {
    state.preview_running.store(false, Ordering::SeqCst);
    Ok(())
}
