use serde::Serialize;
use crate::error::CommandResult;

#[derive(Serialize)]
pub struct PlatformInfo {
    pub os: String,
    pub arch: String,
    pub version: String,
}

#[tauri::command]
pub async fn get_app_version() -> CommandResult<String> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

#[tauri::command]
pub async fn get_platform_info() -> CommandResult<PlatformInfo> {
    Ok(PlatformInfo {
        os:      std::env::consts::OS.to_string(),
        arch:    std::env::consts::ARCH.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}
