pub mod collection_repo;
pub mod plugin_repo;
pub mod scene_repo;
pub mod source_repo;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{Pool, Sqlite};
use std::path::Path;

pub type Db = Pool<Sqlite>;

pub async fn init(db_path: &Path) -> Result<Db, sqlx::Error> {
    if let Some(parent) = db_path.parent() {
        tokio::fs::create_dir_all(parent).await.ok();
    }

    // foreign_keys is a PER-CONNECTION pragma and SQLite defaults it to OFF.
    // Setting it through the connect options applies it to every connection the
    // pool opens; running it as a one-off query only ever configured whichever
    // single pooled connection happened to serve it, so ON DELETE CASCADE
    // silently never fired and deletes left orphaned rows behind.
    let opts = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal);

    let pool = SqlitePoolOptions::new().connect_with(opts).await?;

    migrate(&pool).await?;
    Ok(pool)
}

async fn migrate(pool: &Db) -> Result<(), sqlx::Error> {

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

    cleanup_orphans(pool).await?;

    Ok(())
}

/// Removes rows stranded by deletes that happened while foreign keys were not
/// being enforced. These rows are unreachable from the UI — a scene whose
/// collection is gone can never be listed — so they would otherwise accumulate
/// in the database forever.
///
/// Order matters: sources are cleared first so that scenes deleted in the
/// second statement cannot themselves strand more sources.
async fn cleanup_orphans(pool: &Db) -> Result<(), sqlx::Error> {
    let sources = sqlx::query(
        "DELETE FROM sources
         WHERE scene_id NOT IN (SELECT id FROM scenes)",
    )
    .execute(pool)
    .await?
    .rows_affected();

    let scenes = sqlx::query(
        "DELETE FROM scenes
         WHERE collection_id NOT IN (SELECT id FROM scene_collections)",
    )
    .execute(pool)
    .await?
    .rows_affected();

    // Sources orphaned by the scenes just removed.
    let cascaded = sqlx::query(
        "DELETE FROM sources
         WHERE scene_id NOT IN (SELECT id FROM scenes)",
    )
    .execute(pool)
    .await?
    .rows_affected();

    if sources + scenes + cascaded > 0 {
        tracing::info!(
            scenes,
            sources = sources + cascaded,
            "removed orphaned rows left by unenforced foreign keys"
        );
    }

    Ok(())
}
