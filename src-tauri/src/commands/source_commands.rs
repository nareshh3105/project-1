use tauri::State;
use uuid::Uuid;
use chrono::Utc;

use crate::db::source_repo;
use crate::error::CommandResult;
use crate::state::AppState;

fn now() -> i64 {
    Utc::now().timestamp_millis()
}

#[tauri::command]
pub async fn list_sources(
    state: State<'_, AppState>,
    scene_id: String,
) -> CommandResult<Vec<source_repo::SourceRow>> {
    source_repo::list(&state.db, &scene_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_source(
    state: State<'_, AppState>,
    scene_id: String,
    name: String,
    source_type: String,
    settings: String,
) -> CommandResult<source_repo::SourceRow> {
    let pool  = &state.db;
    let id    = Uuid::new_v4().to_string();
    let now   = now();
    let count = source_repo::count(pool, &scene_id)
        .await
        .map_err(|e| e.to_string())?;

    source_repo::create(pool, &id, &scene_id, &name, &source_type, &settings, count, now)
        .await
        .map_err(|e| e.to_string())?;

    source_repo::list(pool, &scene_id)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| "Source not found after create".to_string())
}

#[tauri::command]
pub async fn rename_source(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> CommandResult<()> {
    source_repo::rename(&state.db, &id, &name, now())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_source(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<()> {
    source_repo::delete(&state.db, &id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_source_visible(
    state: State<'_, AppState>,
    id: String,
    visible: bool,
) -> CommandResult<()> {
    source_repo::set_visible(&state.db, &id, visible, now())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_source_locked(
    state: State<'_, AppState>,
    id: String,
    locked: bool,
) -> CommandResult<()> {
    source_repo::set_locked(&state.db, &id, locked, now())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reorder_sources(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> CommandResult<()> {
    source_repo::reorder(&state.db, &ids, now())
        .await
        .map_err(|e| e.to_string())
}
