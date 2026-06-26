use chrono::Utc;
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::db::{collection_repo, scene_repo, source_repo};
use crate::error::CommandResult;
use crate::state::AppState;

fn now() -> i64 {
    Utc::now().timestamp_millis()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionInitResult {
    pub collection: collection_repo::CollectionRow,
    pub scenes: Vec<scene_repo::SceneRow>,
}

#[tauri::command]
pub async fn list_collections(
    state: State<'_, AppState>,
) -> CommandResult<Vec<collection_repo::CollectionRow>> {
    collection_repo::list(&state.db).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_collection(
    state: State<'_, AppState>,
    name: String,
) -> CommandResult<CollectionInitResult> {
    let pool = &state.db;
    let cid  = Uuid::new_v4().to_string();
    let sid  = Uuid::new_v4().to_string();
    let now  = now();

    collection_repo::create(pool, &cid, &name, now)
        .await
        .map_err(|e| e.to_string())?;
    scene_repo::create(pool, &sid, &cid, "Scene 1", 0, now)
        .await
        .map_err(|e| e.to_string())?;

    let scenes = scene_repo::list(pool, &cid).await.map_err(|e| e.to_string())?;
    let collection = collection_repo::list(pool)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|c| c.id == cid)
        .ok_or_else(|| "Collection not found after create".to_string())?;

    Ok(CollectionInitResult { collection, scenes })
}

#[tauri::command]
pub async fn rename_collection(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> CommandResult<()> {
    collection_repo::rename(&state.db, &id, &name, now())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_collection(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    let count = collection_repo::count(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    if count <= 1 {
        return Err("Cannot delete the last scene collection".to_string());
    }
    collection_repo::delete(&state.db, &id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duplicate_collection(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<CollectionInitResult> {
    let pool = &state.db;
    let now  = now();

    let collections = collection_repo::list(pool).await.map_err(|e| e.to_string())?;
    let orig = collections
        .iter()
        .find(|c| c.id == id)
        .ok_or("Collection not found")?;

    let new_cid  = Uuid::new_v4().to_string();
    let new_name = format!("{} (copy)", orig.name);
    collection_repo::create(pool, &new_cid, &new_name, now)
        .await
        .map_err(|e| e.to_string())?;

    let orig_scenes = scene_repo::list(pool, &id).await.map_err(|e| e.to_string())?;
    for scene in &orig_scenes {
        let new_sid = Uuid::new_v4().to_string();
        scene_repo::create(pool, &new_sid, &new_cid, &scene.name, scene.order_index, now)
            .await
            .map_err(|e| e.to_string())?;

        let sources = source_repo::list(pool, &scene.id).await.map_err(|e| e.to_string())?;
        for src in &sources {
            let new_src_id = Uuid::new_v4().to_string();
            source_repo::create(
                pool, &new_src_id, &new_sid, &src.name, &src.source_type,
                &src.settings, src.order_index, now,
            )
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    let scenes = scene_repo::list(pool, &new_cid).await.map_err(|e| e.to_string())?;
    let collection = collection_repo::list(pool)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|c| c.id == new_cid)
        .ok_or_else(|| "Collection not found after duplicate".to_string())?;

    Ok(CollectionInitResult { collection, scenes })
}
