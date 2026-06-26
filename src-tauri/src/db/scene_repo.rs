use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SceneRow {
    pub id: String,
    pub collection_id: String,
    pub name: String,
    pub order_index: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list(pool: &Pool<Sqlite>, collection_id: &str) -> Result<Vec<SceneRow>, sqlx::Error> {
    sqlx::query_as::<_, SceneRow>(
        "SELECT id, collection_id, name, order_index, created_at, updated_at
         FROM scenes WHERE collection_id = ? ORDER BY order_index ASC",
    )
    .bind(collection_id)
    .fetch_all(pool)
    .await
}

pub async fn create(
    pool: &Pool<Sqlite>,
    id: &str,
    collection_id: &str,
    name: &str,
    order_index: i64,
    now: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO scenes (id, collection_id, name, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(collection_id)
    .bind(name)
    .bind(order_index)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn rename(pool: &Pool<Sqlite>, id: &str, name: &str, now: i64) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE scenes SET name = ?, updated_at = ? WHERE id = ?")
        .bind(name)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete(pool: &Pool<Sqlite>, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM scenes WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn reorder(pool: &Pool<Sqlite>, ids: &[String], now: i64) -> Result<(), sqlx::Error> {
    for (i, id) in ids.iter().enumerate() {
        sqlx::query("UPDATE scenes SET order_index = ?, updated_at = ? WHERE id = ?")
            .bind(i as i64)
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub async fn count(pool: &Pool<Sqlite>, collection_id: &str) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM scenes WHERE collection_id = ?",
    )
    .bind(collection_id)
    .fetch_one(pool)
    .await
}
