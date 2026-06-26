use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SourceRow {
    pub id: String,
    pub scene_id: String,
    pub name: String,
    pub source_type: String,
    pub settings: String,    // JSON text
    pub order_index: i64,
    pub visible: bool,
    pub locked: bool,
    pub muted: bool,
    pub volume: f64,
    pub transform: String,   // JSON text
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list(pool: &Pool<Sqlite>, scene_id: &str) -> Result<Vec<SourceRow>, sqlx::Error> {
    sqlx::query_as::<_, SourceRow>(
        "SELECT id, scene_id, name, source_type, settings, order_index,
                visible, locked, muted, volume, transform, created_at, updated_at
         FROM sources WHERE scene_id = ? ORDER BY order_index ASC",
    )
    .bind(scene_id)
    .fetch_all(pool)
    .await
}

pub async fn create(
    pool: &Pool<Sqlite>,
    id: &str,
    scene_id: &str,
    name: &str,
    source_type: &str,
    settings: &str,
    order_index: i64,
    now: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO sources
         (id, scene_id, name, source_type, settings, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(scene_id)
    .bind(name)
    .bind(source_type)
    .bind(settings)
    .bind(order_index)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn rename(pool: &Pool<Sqlite>, id: &str, name: &str, now: i64) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE sources SET name = ?, updated_at = ? WHERE id = ?")
        .bind(name)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete(pool: &Pool<Sqlite>, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM sources WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_visible(pool: &Pool<Sqlite>, id: &str, visible: bool, now: i64) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE sources SET visible = ?, updated_at = ? WHERE id = ?")
        .bind(visible)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_locked(pool: &Pool<Sqlite>, id: &str, locked: bool, now: i64) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE sources SET locked = ?, updated_at = ? WHERE id = ?")
        .bind(locked)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn reorder(pool: &Pool<Sqlite>, ids: &[String], now: i64) -> Result<(), sqlx::Error> {
    for (i, id) in ids.iter().enumerate() {
        sqlx::query("UPDATE sources SET order_index = ?, updated_at = ? WHERE id = ?")
            .bind(i as i64)
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub async fn count(pool: &Pool<Sqlite>, scene_id: &str) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sources WHERE scene_id = ?")
        .bind(scene_id)
        .fetch_one(pool)
        .await
}
