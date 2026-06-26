use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CollectionRow {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list(pool: &Pool<Sqlite>) -> Result<Vec<CollectionRow>, sqlx::Error> {
    sqlx::query_as::<_, CollectionRow>(
        "SELECT id, name, created_at, updated_at FROM scene_collections ORDER BY created_at ASC",
    )
    .fetch_all(pool)
    .await
}

pub async fn create(pool: &Pool<Sqlite>, id: &str, name: &str, now: i64) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO scene_collections (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
    )
    .bind(id)
    .bind(name)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn rename(pool: &Pool<Sqlite>, id: &str, name: &str, now: i64) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE scene_collections SET name = ?, updated_at = ? WHERE id = ?")
        .bind(name)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete(pool: &Pool<Sqlite>, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM scene_collections WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn count(pool: &Pool<Sqlite>) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM scene_collections")
        .fetch_one(pool)
        .await
}
