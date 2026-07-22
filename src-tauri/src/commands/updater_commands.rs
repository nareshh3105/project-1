use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;
use crate::error::CommandResult;

pub const UPDATE_AVAILABLE_EVENT: &str = "updater:update-available";
pub const UPDATE_PROGRESS_EVENT:  &str = "updater:download-progress";
pub const UPDATE_ERROR_EVENT:     &str = "updater:error";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version:      String,
    pub current_version: String,
    pub notes:        Option<String>,
    pub pub_date:     Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub downloaded: usize,
    pub total:      Option<u64>,
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> CommandResult<Option<UpdateInfo>> {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(_) => return Ok(None),
    };

    let update = match updater.check().await {
        Ok(u) => u,
        Err(_) => return Ok(None),
    };

    Ok(update.map(|u| UpdateInfo {
        version:         u.version.clone(),
        current_version: u.current_version.clone(),
        notes:           u.body.clone(),
        pub_date:        u.date.map(|d| d.to_string()),
    }))
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> CommandResult<()> {
    let updater = app.updater().map_err(|e| e.to_string())?;

    let update = updater.check().await
        .map_err(|e| e.to_string())?
        .ok_or("No update available")?;

    let app2 = app.clone();
    let app3 = app.clone();

    update
        .download_and_install(
            move |downloaded, total| {
                let _ = app2.emit(UPDATE_PROGRESS_EVENT, DownloadProgress { downloaded, total });
            },
            move || {
                let _ = app3.emit(UPDATE_PROGRESS_EVENT, DownloadProgress {
                    downloaded: 1,
                    total:      Some(1),
                });
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
