use crate::error::CommandResult;

#[tauri::command]
pub async fn take_screenshot(output_path: Option<String>) -> CommandResult<String> {
    use screenshots::Screen;
    use image::{DynamicImage, ImageFormat};

    let screens = Screen::all().map_err(|e| e.to_string())?;
    let screen  = screens.into_iter().next().ok_or("No screen found")?;

    let cap  = screen.capture().map_err(|e| e.to_string())?;
    let rgba = DynamicImage::ImageRgba8(cap);

    let dest = output_path.unwrap_or_else(|| {
        let home = std::env::var("USERPROFILE")
            .unwrap_or_else(|_| std::env::var("HOME").unwrap_or_else(|_| ".".to_string()));
        let ts = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
        format!("{}/Pictures/Screenshot_{}.png", home, ts)
    });

    if let Some(parent) = std::path::Path::new(&dest).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    rgba.save_with_format(&dest, ImageFormat::Png)
        .map_err(|e| e.to_string())?;

    Ok(dest)
}
