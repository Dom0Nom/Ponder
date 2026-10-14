pub mod models;

use crate::error::{AppError, AppResult};
use rusqlite::{Connection, OptionalExtension};
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
    include_str!("010_source_local_path.sql"),
    include_str!("011_study_plans.sql"),
    include_str!("012_exams.sql"),
    include_str!("013_studio_outputs.sql"),
    include_str!("014_notes.sql"),
    include_str!("015_annotations.sql"),
    include_str!("016_inbox.sql"),
    include_str!("018_space_language.sql"),
];

pub fn schema_version() -> i64 {
    MIGRATIONS.len() as i64
}

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
        let db = Db {
            path: path.as_ref().to_path_buf(),
        };
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

/// Migrations 010–015 were merged in more than one order during development, so a database's
/// user_version doesn't say which of them ran; each is detected by what it creates.
const DETECTED: &[(usize, &str)] = &[
    (
        9,
        "SELECT 1 FROM pragma_table_info('sources') WHERE name = 'local_path'",
    ),
    (
        10,
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'study_plans'",
    ),
    (
        11,
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'exam_attempts'",
    ),
    (
        12,
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'studio_outputs'",
    ),
    (
        13,
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notes'",
    ),
    (
        14,
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'annotations'",
    ),
    (
        16,
        "SELECT 1 FROM pragma_table_info('spaces') WHERE name = 'language'",
    ),
];

fn migrate(conn: &Connection) -> AppResult<()> {
    let mut version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version as usize > MIGRATIONS.len() {
        return Err(AppError::Other(
            "This data was written by a newer version of Ponder. Update the app to open it.".into(),
        ));
    }
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let applied = match DETECTED.iter().find(|(n, _)| *n == i) {
            Some((_, probe)) => conn.query_row(probe, [], |_| Ok(())).optional()?.is_some(),
            _ => (i as i64) < version,
        };
        if applied {
            continue;
        }
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        version = version.max(i as i64 + 1);
        tx.pragma_update(None, "user_version", version)?;
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
        let v: String = conn
            .query_row("select vec_version()", [], |r| r.get(0))
            .unwrap();
        assert!(v.starts_with('v'));
        let uv: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(uv as usize, MIGRATIONS.len());
        // reopening must not re-run migrations
        Db::open(db.path()).unwrap();
    }

    #[test]
    fn adds_the_space_language_column_once() {
        let (db, _dir) = test_db();
        let c = db.conn().unwrap();
        let has = |c: &Connection| -> i64 {
            c.query_row(
                "SELECT count(*) FROM pragma_table_info('spaces') WHERE name = 'language'",
                [],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(has(&c), 1);
        drop(c);
        Db::open(db.path()).unwrap();
        assert_eq!(has(&db.conn().unwrap()), 1);
    }

    #[test]
    fn refuses_a_database_from_a_newer_version() {
        let (db, _dir) = test_db();
        db.conn()
            .unwrap()
            .pragma_update(None, "user_version", MIGRATIONS.len() as i64 + 1)
            .unwrap();
        assert!(Db::open(db.path()).is_err());
    }

    #[test]
    fn repairs_a_database_migrated_in_another_order() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("old.db");
        register_sqlite_vec();
        let conn = Connection::open(&path).unwrap();
        for sql in MIGRATIONS[..10]
            .iter()
            .chain([MIGRATIONS[11], MIGRATIONS[12]].iter())
        {
            conn.execute_batch(sql).unwrap();
        }
        conn.pragma_update(None, "user_version", 12).unwrap();
        drop(conn);

        let db = Db::open(&path).unwrap();
        let c = db.conn().unwrap();
        let uv: i64 = c
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(uv as usize, MIGRATIONS.len());
        for table in [
            "study_plans",
            "plan_tasks",
            "exam_attempts",
            "studio_outputs",
            "notes",
            "annotations",
        ] {
            let n: i64 = c
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "{table}");
        }
    }
}
