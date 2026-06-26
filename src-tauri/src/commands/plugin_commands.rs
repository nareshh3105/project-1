use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use tauri_plugin_shell::ShellExt;

use crate::{
    db::plugin_repo::{self, PluginRow},
    state::AppState,
};

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginManifest {
    id:          String,
    name:        String,
    version:     String,
    phase:       String,
    entry_point: String,
    #[serde(default)]
    permissions: Vec<String>,
    #[serde(default)]
    author: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    source_types: Vec<String>,
    #[serde(default)]
    filter_types: Vec<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────

fn plugins_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("plugins"))
        .map_err(|e| e.to_string())
}

async fn ensure_sample_plugin(plugins_dir: &std::path::Path) {
    let hello_dir = plugins_dir.join("hello-world");
    if tokio::fs::try_exists(&hello_dir).await.unwrap_or(false) {
        return;
    }
    let _ = tokio::fs::create_dir_all(&hello_dir).await;

    let manifest = r#"{
  "id": "hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "author": "CodeBuilders",
  "description": "Sample plugin — logs a greeting every 5 seconds.",
  "phase": "js_sandbox",
  "permissions": ["scene_read"],
  "entryPoint": "index.js",
  "sourceTypes": [],
  "filterTypes": []
}"#;
    let _ = tokio::fs::write(hello_dir.join("plugin.json"), manifest).await;

    let script = r#"// Hello World Plugin
CodeBuilders.log('Hello World plugin loaded!');

let tick = 0;
const id = setInterval(function() {
  tick += 1;
  CodeBuilders.log('Hello from plugin — tick ' + tick);
}, 5000);
"#;
    let _ = tokio::fs::write(hello_dir.join("index.js"), script).await;
}

// ── Commands ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_plugins(state: State<'_, AppState>) -> Result<Vec<PluginRow>, String> {
    plugin_repo::list(&state.db).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn discover_plugins(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<PluginRow>, String> {
    let dir = plugins_dir(&app_handle)?;
    tokio::fs::create_dir_all(&dir).await.ok();
    ensure_sample_plugin(&dir).await;

    let mut read_dir = tokio::fs::read_dir(&dir)
        .await
        .map_err(|e| e.to_string())?;

    let existing = plugin_repo::list(&state.db).await.unwrap_or_default();

    while let Ok(Some(entry)) = read_dir.next_entry().await {
        if !entry
            .file_type()
            .await
            .map(|t| t.is_dir())
            .unwrap_or(false)
        {
            continue;
        }
        let manifest_path = entry.path().join("plugin.json");
        if !tokio::fs::try_exists(&manifest_path).await.unwrap_or(false) {
            continue;
        }
        let content = match tokio::fs::read_to_string(&manifest_path).await {
            Ok(c) => c,
            Err(_) => continue,
        };
        let manifest: PluginManifest = match serde_json::from_str(&content) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let now = now_ms();
        let current_state = existing
            .iter()
            .find(|r| r.id == manifest.id)
            .map(|r| r.state.clone())
            .unwrap_or_else(|| "disabled".to_string());
        let installed_at = existing
            .iter()
            .find(|r| r.id == manifest.id)
            .map(|r| r.installed_at)
            .unwrap_or(now);

        let row = PluginRow {
            id:           manifest.id,
            name:         manifest.name,
            version:      manifest.version,
            phase:        manifest.phase,
            state:        current_state,
            manifest:     content,
            config_path:  entry.path().to_string_lossy().to_string(),
            installed_at,
            updated_at:   now,
        };
        plugin_repo::upsert(&state.db, &row)
            .await
            .map_err(|e| e.to_string())?;
    }

    plugin_repo::list(&state.db).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn enable_plugin(id: String, state: State<'_, AppState>) -> Result<(), String> {
    plugin_repo::set_state(&state.db, &id, "enabled", now_ms())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn disable_plugin(id: String, state: State<'_, AppState>) -> Result<(), String> {
    plugin_repo::set_state(&state.db, &id, "disabled", now_ms())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_plugins_folder(app_handle: tauri::AppHandle) -> Result<String, String> {
    let dir = plugins_dir(&app_handle)?;
    tokio::fs::create_dir_all(&dir).await.ok();
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn open_plugins_folder(app_handle: tauri::AppHandle) -> Result<(), String> {
    let dir = plugins_dir(&app_handle)?;
    tokio::fs::create_dir_all(&dir).await.ok();
    #[allow(deprecated)]
    app_handle
        .shell()
        .open(dir.to_string_lossy().to_string(), None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_plugin_script(
    id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let plugins = plugin_repo::list(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    let plugin = plugins
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Plugin '{}' not found", id))?;

    let manifest: PluginManifest = serde_json::from_str(&plugin.manifest)
        .map_err(|e| e.to_string())?;

    let script_path = std::path::Path::new(&plugin.config_path).join(&manifest.entry_point);
    tokio::fs::read_to_string(&script_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn uninstall_plugin(id: String, state: State<'_, AppState>) -> Result<(), String> {
    plugin_repo::remove(&state.db, &id)
        .await
        .map_err(|e| e.to_string())
}
