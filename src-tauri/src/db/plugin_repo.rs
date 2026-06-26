use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PluginRow {
    pub id:           String,
    pub name:         String,
    pub version:      String,
    pub phase:        String,
    pub state:        String,
    pub manifest:     String,
    pub config_path:  String,
    pub installed_at: i64,
    pub updated_at:   i64,
}

pub async fn list(pool: &Pool<Sqlite>) -> Result<Vec<PluginRow>, sqlx::Error> {
    sqlx::query_as::<_, PluginRow>(
        "SELECT id, name, version, phase, state, manifest, config_path, installed_at, updated_at
         FROM plugins ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await
}

pub async fn upsert(pool: &Pool<Sqlite>, row: &PluginRow) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO plugins (id, name, version, phase, state, manifest, config_path, installed_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
           name        = excluded.name,
           version     = excluded.version,
           phase       = excluded.phase,
           manifest    = excluded.manifest,
           config_path = excluded.config_path,
           updated_at  = excluded.updated_at",
    )
    .bind(&row.id)
    .bind(&row.name)
    .bind(&row.version)
    .bind(&row.phase)
    .bind(&row.state)
    .bind(&row.manifest)
    .bind(&row.config_path)
    .bind(row.installed_at)
    .bind(row.updated_at)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn set_state(
    pool: &Pool<Sqlite>,
    id: &str,
    state: &str,
    now: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE plugins SET state = ?1, updated_at = ?2 WHERE id = ?3")
        .bind(state)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn remove(pool: &Pool<Sqlite>, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM plugins WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}
