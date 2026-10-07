pub mod models;

use crate::error::AppResult;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::Once;

const MIGRATIONS: &[&str] = &[
    include_str!("schema.sql"),
    include_str!("002_learner_memory.sql"),
    include_str!("003_placement.sql"),
    include_str!("004_watched_folders.sql"),
    include_str!("005_cards.sql"),
    include_str!("006_practice.sql"),
    include_str!("007_micro_steps.sql"),
    include_str!("008_thread_pins.sql"),
    include_str!("009_practice_hint.sql"),
];

static VEC_INIT: Once = Once::new();

fn register_sqlite_vec() {
    VEC_INIT.call_once(|| unsafe {
        #[allow(clippy::missing_transmute_annotations)]
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite_vec::sqlite3_vec_init as *const (),
        )));
    });
}

/// Cheap handle; every caller opens its own connection (WAL mode allows concurrent readers
/// alongside the ingestion worker's writes).
#[derive(Clone)]
pub struct Db {
    path: PathBuf,
}

impl Db {
    pub fn open(path: impl AsRef<Path>) -> AppResult<Self> {
        register_sqlite_vec();
        if let Some(dir) = path.as_ref().parent() {
            std::fs::create_dir_all(dir)?;
        }
        let db = Db { path: path.as_ref().to_path_buf() };
        let conn = db.conn()?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        migrate(&conn)?;
        Ok(db)
    }

    pub fn conn(&self) -> AppResult<Connection> {
        let conn = Connection::open(&self.path)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.busy_timeout(std::time::Duration::from_secs(10))?;
        Ok(conn)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

fn migrate(conn: &Connection) -> AppResult<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(test)]
pub fn test_db() -> (Db, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(dir.path().join("test.db")).unwrap();
    (db, dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_and_has_extensions() {
        let (db, _dir) = test_db();
        let conn = db.conn().unwrap();
        let v: String = conn.query_row("select vec_version()", [], |r| r.get(0)).unwrap();
        assert!(v.starts_with('v'));
        let uv: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(uv as usize, MIGRATIONS.len());
        // reopening must not re-run migrations
        Db::open(db.path()).unwrap();
    }
}
