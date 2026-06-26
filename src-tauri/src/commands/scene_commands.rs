use serde::Serialize;
use tauri::State;
use uuid::Uuid;
use chrono::Utc;

use crate::db::{scene_repo, source_repo};
use crate::error::CommandResult;
use crate::state::AppState;

fn now() -> i64 {
    Utc::now().timestamp_millis()
}

// ── Init ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitResult {
    pub collection_id: String,
    pub scenes: Vec<scene_repo::SceneRow>,
}

/// Called once on app startup. Creates the default collection + Scene 1 if none exist.
#[tauri::command]
pub async fn init_default_collection(state: State<'_, AppState>) -> CommandResult<InitResult> {
    let pool = &state.db;

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM scene_collections")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;

    let collection_id = if count == 0 {
        let cid  = Uuid::new_v4().to_string();
        let sid  = Uuid::new_v4().to_string();
        let now  = now();

        sqlx::query(
            "INSERT INTO scene_collections (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        )
        .bind(&cid)
        .bind("Default")
        .bind(now)
        .bind(now)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

        scene_repo::create(pool, &sid, &cid, "Scene 1", 0, now)
            .await
            .map_err(|e| e.to_string())?;

        cid
    } else {
        sqlx::query_scalar::<_, String>("SELECT id FROM scene_collections LIMIT 1")
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?
    };

    let scenes = scene_repo::list(pool, &collection_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(InitResult { collection_id, scenes })
}

// ── Scene CRUD ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_scenes(
    state: State<'_, AppState>,
    collection_id: String,
) -> CommandResult<Vec<scene_repo::SceneRow>> {
    scene_repo::list(&state.db, &collection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_scene(
    state: State<'_, AppState>,
    collection_id: String,
    name: String,
) -> CommandResult<scene_repo::SceneRow> {
    let pool = &state.db;
    let id  = Uuid::new_v4().to_string();
    let now = now();

    let count = scene_repo::count(pool, &collection_id)
        .await
        .map_err(|e| e.to_string())?;

    scene_repo::create(pool, &id, &collection_id, &name, count, now)
        .await
        .map_err(|e| e.to_string())?;

    scene_repo::list(pool, &collection_id)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| "Scene not found after create".to_string())
}

#[tauri::command]
pub async fn rename_scene(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> CommandResult<()> {
    scene_repo::rename(&state.db, &id, &name, now())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_scene(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<()> {
    scene_repo::delete(&state.db, &id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reorder_scenes(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> CommandResult<()> {
    scene_repo::reorder(&state.db, &ids, now())
        .await
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateResult {
    pub scene: scene_repo::SceneRow,
    pub sources: Vec<source_repo::SourceRow>,
}

#[tauri::command]
pub async fn duplicate_scene(
    state: State<'_, AppState>,
    id: String,
    collection_id: String,
) -> CommandResult<DuplicateResult> {
    let pool = &state.db;
    let now  = now();

    // Fetch original
    let originals = scene_repo::list(pool, &collection_id)
        .await
        .map_err(|e| e.to_string())?;

    let orig = originals
        .iter()
        .find(|s| s.id == id)
        .ok_or("Scene not found")?;

    let new_id    = Uuid::new_v4().to_string();
    let new_name  = format!("{} (copy)", orig.name);
    let count     = scene_repo::count(pool, &collection_id)
        .await
        .map_err(|e| e.to_string())?;

    scene_repo::create(pool, &new_id, &collection_id, &new_name, count, now)
        .await
        .map_err(|e| e.to_string())?;

    // Duplicate sources
    let orig_sources = source_repo::list(pool, &id)
        .await
        .map_err(|e| e.to_string())?;

    for src in &orig_sources {
        let sid = Uuid::new_v4().to_string();
        source_repo::create(
            pool, &sid, &new_id, &src.name, &src.source_type,
            &src.settings, src.order_index, now,
        )
        .await
        .map_err(|e| e.to_string())?;
    }

    let new_scene = scene_repo::list(pool, &collection_id)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|s| s.id == new_id)
        .ok_or("Duplicated scene not found")?;

    let new_sources = source_repo::list(pool, &new_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(DuplicateResult { scene: new_scene, sources: new_sources })
}
