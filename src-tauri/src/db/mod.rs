pub mod collection_repo;
pub mod plugin_repo;
pub mod scene_repo;
pub mod source_repo;

use sqlx::{Pool, Sqlite, SqlitePool};
use std::path::Path;

pub type Db = Pool<Sqlite>;

pub async fn init(db_path: &Path) -> Result<Db, sqlx::Error> {
    if let Some(parent) = db_path.parent() {
        tokio::fs::create_dir_all(parent).await.ok();
    }

    let url = format!("sqlite:{}?mode=rwc", db_path.display());
    let pool = SqlitePool::connect(&url).await?;

    migrate(&pool).await?;
    Ok(pool)
}

async fn migrate(pool: &Db) -> Result<(), sqlx::Error> {
    sqlx::query(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS scene_collections (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS scenes (
            id            TEXT PRIMARY KEY,
            collection_id TEXT NOT NULL,
            name          TEXT NOT NULL,
            order_index   INTEGER NOT NULL DEFAULT 0,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            FOREIGN KEY (collection_id)
                REFERENCES scene_collections(id) ON DELETE CASCADE
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS plugins (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            version      TEXT NOT NULL DEFAULT '0.0.0',
            phase        TEXT NOT NULL DEFAULT 'js_sandbox',
            state        TEXT NOT NULL DEFAULT 'disabled',
            manifest     TEXT NOT NULL DEFAULT '{}',
            config_path  TEXT NOT NULL DEFAULT '',
            installed_at INTEGER NOT NULL,
            updated_at   INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS sources (
            id          TEXT PRIMARY KEY,
            scene_id    TEXT NOT NULL,
            name        TEXT NOT NULL,
            source_type TEXT NOT NULL,
            settings    TEXT NOT NULL DEFAULT '{}',
            order_index INTEGER NOT NULL DEFAULT 0,
            visible     INTEGER NOT NULL DEFAULT 1,
            locked      INTEGER NOT NULL DEFAULT 0,
            muted       INTEGER NOT NULL DEFAULT 0,
            volume      REAL NOT NULL DEFAULT 1.0,
            transform   TEXT NOT NULL DEFAULT
                '{\"x\":0,\"y\":0,\"width\":1920,\"height\":1080,\"rotation\":0,\"scaleX\":1,\"scaleY\":1}',
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL,
            FOREIGN KEY (scene_id)
                REFERENCES scenes(id) ON DELETE CASCADE
        )",
    )
    .execute(pool)
    .await?;

    Ok(())
}
