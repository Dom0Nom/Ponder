//! Watched folders: supported files dropped into a folder are imported into its space.
//!
//! One `watch` thread owns every notify watcher. A filesystem event only marks its folder dirty;
//! after a quiet period the folder is rescanned and reconciled against `watched_files`
//! (see scan.rs). Missing folders are retried periodically and never stop the thread.
pub mod commands;
pub mod scan;

use crate::db::{new_id, now_ms, Db};
use crate::error::{invalid, AppError, AppResult};
use crate::ingest::{Emit, Ingest};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::{params, Connection, OptionalExtension};
use scan::{Known, Stamp};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFolder {
    pub id: String,
    pub space_id: String,
    pub path: String,
    pub recursive: bool,
    pub created_at: i64,
    pub file_count: i64,
    /// watching | scanning | missing | error
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct Timing {
    /// quiet period after the last filesystem event before rescanning
    pub debounce: Duration,
    /// rescan interval while files are still being written
    pub recheck: Duration,
    pub retry_missing: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            debounce: Duration::from_secs(2),
            recheck: Duration::from_millis(1500),
            retry_missing: Duration::from_secs(15),
        }
    }
}

#[derive(Debug, Clone)]
struct Runtime {
    status: &'static str,
    error: Option<String>,
}

enum Msg {
    Add(String),
    Remove(String),
    Changed(String),
    #[cfg_attr(not(test), allow(dead_code))]
    Stop,
}

struct FolderRow {
    id: String,
    space_id: String,
    path: String,
    recursive: bool,
}

struct FolderState {
    row: FolderRow,
    watcher: Option<RecommendedWatcher>,
    due: Option<Instant>,
    pending: HashMap<String, Stamp>,
}

impl FolderState {
    fn new(row: FolderRow) -> Self {
        Self {
            row,
            watcher: None,
            due: Some(Instant::now()),
            pending: HashMap::new(),
        }
    }
}

#[derive(Clone)]
pub struct WatchService {
    core: Arc<Core>,
    tx: Sender<Msg>,
}

struct Core {
    db: Db,
    ingest: Ingest,
    emit: Emit,
    timing: Timing,
    runtime: Mutex<HashMap<String, Runtime>>,
}

impl WatchService {
    /// Spawns the watch thread and restores watchers for every saved folder.
    pub fn start(db: Db, ingest: Ingest, emit: Emit, timing: Timing) -> AppResult<Self> {
        let core = Arc::new(Core {
            db,
            ingest,
            emit,
            timing,
            runtime: Mutex::new(HashMap::new()),
        });
        let (tx, rx) = channel::<Msg>();
        let ids: Vec<String> = {
            let c = core.db.conn()?;
            let mut st = c.prepare("SELECT id FROM watched_folders ORDER BY created_at")?;
            let rows = st.query_map([], |r| r.get(0))?;
            rows.collect::<Result<_, _>>()?
        };
        for id in ids {
            core.set_runtime(&id, "scanning", None);
            let _ = tx.send(Msg::Add(id));
        }
        let (thread_core, thread_tx) = (core.clone(), tx.clone());
        std::thread::Builder::new()
            .name("watch".into())
            .spawn(move || {
                let mut folders: HashMap<String, FolderState> = HashMap::new();
                loop {
                    let now = Instant::now();
                    let wait = folders
                        .values()
                        .filter_map(|f| f.due)
                        .min()
                        .map(|d| d.saturating_duration_since(now))
                        .unwrap_or(Duration::from_secs(3600));
                    match rx.recv_timeout(wait) {
                        Ok(Msg::Add(id)) => match thread_core.load_row(&id) {
                            Ok(Some(row)) => {
                                folders.insert(id, FolderState::new(row));
                            }
                            Ok(None) => {}
                            Err(e) => thread_core.set_runtime(&id, "error", Some(e.to_string())),
                        },
                        Ok(Msg::Remove(id)) => {
                            folders.remove(&id);
                        }
                        Ok(Msg::Changed(id)) => {
                            if let Some(f) = folders.get_mut(&id) {
                                f.due = Some(Instant::now() + thread_core.timing.debounce);
                            }
                        }
                        Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => break,
                        Err(RecvTimeoutError::Timeout) => {}
                    }
                    let now = Instant::now();
                    let due: Vec<String> = folders
                        .iter()
                        .filter(|(_, f)| f.due.is_some_and(|d| d <= now))
                        .map(|(k, _)| k.clone())
                        .collect();
                    for id in due {
                        let Some(f) = folders.get_mut(&id) else {
                            continue;
                        };
                        f.due = None;
                        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            thread_core.sync(f, Some(&thread_tx))
                        }));
                        match res {
                            Ok(true) => {}
                            Ok(false) => {
                                folders.remove(&id);
                            }
                            Err(_) => {
                                log::error!("watched folder sync panicked");
                                thread_core.set_runtime(
                                    &id,
                                    "error",
                                    Some("Something went wrong while scanning this folder.".into()),
                                );
                            }
                        }
                    }
                }
            })
            .map_err(AppError::Io)?;
        Ok(Self { core, tx })
    }

    pub fn list(&self, space_id: &str) -> AppResult<Vec<WatchedFolder>> {
        let c = self.core.db.conn()?;
        let mut st =
            c.prepare("SELECT id FROM watched_folders WHERE space_id=?1 ORDER BY created_at")?;
        let ids: Vec<String> = st
            .query_map([space_id], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        ids.iter().map(|id| self.core.folder(&c, id)).collect()
    }

    pub fn add(&self, space_id: &str, path: &str, recursive: bool) -> AppResult<WatchedFolder> {
        let p = Path::new(path);
        if !p.is_absolute() || !p.is_dir() {
            return Err(invalid(format!("Folder not found: {path}")));
        }
        let c = self.core.db.conn()?;
        crate::db::models::get_space(&c, space_id)?;
        let dup: Option<String> = c
            .query_row(
                "SELECT id FROM watched_folders WHERE space_id=?1 AND path=?2",
                params![space_id, path],
                |r| r.get(0),
            )
            .optional()?;
        if dup.is_some() {
            return Err(invalid("This folder is already watched in this space."));
        }
        let id = new_id();
        c.execute(
            "INSERT INTO watched_folders (id, space_id, path, recursive, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, space_id, path, recursive as i64, now_ms()],
        )?;
        self.core.set_runtime(&id, "scanning", None);
        self.send(Msg::Add(id.clone()))?;
        let f = self.core.folder(&c, &id)?;
        self.core.emit_folder(&f.id, &f.space_id);
        Ok(f)
    }

    /// Stops watching; sources imported from the folder stay.
    pub fn remove(&self, id: &str) -> AppResult<()> {
        let c = self.core.db.conn()?;
        let space_id: Option<String> = c
            .query_row(
                "SELECT space_id FROM watched_folders WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        let space_id = space_id.ok_or_else(|| AppError::NotFound("watched folder".into()))?;
        c.execute("DELETE FROM watched_folders WHERE id=?1", [id])?;
        self.core
            .runtime
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id);
        self.send(Msg::Remove(id.into()))?;
        self.core.emit_folder(id, &space_id);
        Ok(())
    }

    /// Queues a rescan as if the folder had changed.
    #[cfg(test)]
    fn touch(&self, id: &str) {
        let _ = self.tx.send(Msg::Changed(id.into()));
    }

    fn send(&self, m: Msg) -> AppResult<()> {
        self.tx
            .send(m)
            .map_err(|_| AppError::Other("The folder watcher stopped. Restart the app.".into()))
    }

    #[cfg(test)]
    fn stop(&self) {
        let _ = self.tx.send(Msg::Stop);
    }
}

impl Core {
    fn set_runtime(&self, id: &str, status: &'static str, error: Option<String>) {
        self.runtime
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id.into(), Runtime { status, error });
    }

    fn emit_folder(&self, id: &str, space_id: &str) {
        (self.emit)(
            "watch://updated",
            serde_json::json!({ "id": id, "spaceId": space_id }),
        );
    }

    fn load_row(&self, id: &str) -> AppResult<Option<FolderRow>> {
        let c = self.db.conn()?;
        Ok(c.query_row(
            "SELECT id, space_id, path, recursive FROM watched_folders WHERE id=?1",
            [id],
            |r| {
                Ok(FolderRow {
                    id: r.get(0)?,
                    space_id: r.get(1)?,
                    path: r.get(2)?,
                    recursive: r.get::<_, i64>(3)? != 0,
                })
            },
        )
        .optional()?)
    }

    fn folder(&self, c: &Connection, id: &str) -> AppResult<WatchedFolder> {
        let (space_id, path, recursive, created_at): (String, String, i64, i64) = c
            .query_row(
                "SELECT space_id, path, recursive, created_at FROM watched_folders WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound("watched folder".into()))?;
        let file_count: i64 = c.query_row(
            "SELECT count(*) FROM watched_files WHERE folder_id=?1 AND removed=0 AND source_id IS NOT NULL",
            [id],
            |r| r.get(0),
        )?;
        let rt = self
            .runtime
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .cloned();
        let rt = rt.unwrap_or(Runtime {
            status: "scanning",
            error: None,
        });
        Ok(WatchedFolder {
            id: id.into(),
            space_id,
            path,
            recursive: recursive != 0,
            created_at,
            file_count,
            status: rt.status.into(),
            error: rt.error,
        })
    }

    /// Rescans one folder and applies the plan. Returns false once the folder no longer exists in the DB.
    fn sync(&self, f: &mut FolderState, tx: Option<&Sender<Msg>>) -> bool {
        let id = f.row.id.clone();
        match self.try_sync(f, tx) {
            Ok(true) => {}
            Ok(false) => return false,
            Err(e) => {
                log::warn!("watched folder {} failed: {e}", f.row.path);
                self.set_runtime(&id, "error", Some(e.to_string()));
                f.due = Some(Instant::now() + self.timing.retry_missing);
            }
        }
        self.emit_folder(&id, &f.row.space_id);
        true
    }

    fn try_sync(&self, f: &mut FolderState, tx: Option<&Sender<Msg>>) -> AppResult<bool> {
        let mut c = self.db.conn()?;
        let exists: bool = c.query_row(
            "SELECT count(*) FROM watched_folders WHERE id=?1",
            [&f.row.id],
            |r| r.get::<_, i64>(0),
        )? > 0;
        if !exists {
            return Ok(false);
        }
        let root = PathBuf::from(&f.row.path);
        if !root.is_dir() {
            f.watcher = None;
            f.pending.clear();
            self.set_runtime(
                &f.row.id,
                "missing",
                Some(format!("Folder not found: {}", f.row.path)),
            );
            f.due = Some(Instant::now() + self.timing.retry_missing);
            return Ok(true);
        }
        if f.watcher.is_none() {
            if let Some(tx) = tx {
                f.watcher = Some(self.make_watcher(&f.row, tx.clone())?);
            }
        }
        let scanned = scan::scan_dir(&root, f.row.recursive)?;
        let known = load_known(&c, &f.row.id)?;
        let plan = scan::reconcile(&known, &scanned, &f.pending);

        for (rel, stamp) in &plan.import {
            let path = root.join(rel);
            let source_id = match self
                .ingest
                .import_file(&f.row.space_id, &path.to_string_lossy())
            {
                Ok(s) => Some(s.id),
                Err(e) => {
                    log::warn!("couldn't import {}: {e}", path.display());
                    None
                }
            };
            upsert_file(&c, &f.row.id, rel, stamp, source_id.as_deref())?;
        }
        for (rel, stamp, source_id) in &plan.reimport {
            let path = root.join(rel);
            let source_id = match self.ingest.reimport_file(source_id, &path) {
                Ok(s) => Some(s.id),
                Err(AppError::NotFound(_)) => self
                    .ingest
                    .import_file(&f.row.space_id, &path.to_string_lossy())
                    .ok()
                    .map(|s| s.id),
                Err(e) => {
                    log::warn!("couldn't reimport {}: {e}", path.display());
                    Some(source_id.clone())
                }
            };
            upsert_file(&c, &f.row.id, rel, stamp, source_id.as_deref())?;
        }
        if !plan.removed.is_empty() || !plan.restored.is_empty() {
            let tx = c.transaction()?;
            for rel in &plan.removed {
                tx.execute(
                    "UPDATE watched_files SET removed=1 WHERE folder_id=?1 AND rel_path=?2",
                    params![f.row.id, rel],
                )?;
            }
            for rel in &plan.restored {
                tx.execute(
                    "UPDATE watched_files SET removed=0 WHERE folder_id=?1 AND rel_path=?2",
                    params![f.row.id, rel],
                )?;
            }
            tx.commit()?;
        }
        f.pending = plan.pending;
        if !f.pending.is_empty() {
            f.due = Some(Instant::now() + self.timing.recheck);
        }
        self.set_runtime(&f.row.id, "watching", None);
        Ok(true)
    }

    fn make_watcher(&self, row: &FolderRow, tx: Sender<Msg>) -> AppResult<RecommendedWatcher> {
        let id = row.id.clone();
        let mut w =
            notify::recommended_watcher(move |res: notify::Result<notify::Event>| match res {
                Ok(ev) if matches!(ev.kind, EventKind::Access(_)) => {}
                Ok(_) => {
                    let _ = tx.send(Msg::Changed(id.clone()));
                }
                Err(e) => log::warn!("folder watch error: {e}"),
            })
            .map_err(|e| AppError::Other(format!("Couldn't watch this folder: {e}")))?;
        let mode = if row.recursive {
            RecursiveMode::Recursive
        } else {
            RecursiveMode::NonRecursive
        };
        w.watch(Path::new(&row.path), mode)
            .map_err(|e| AppError::Other(format!("Couldn't watch this folder: {e}")))?;
        Ok(w)
    }
}

fn load_known(c: &Connection, folder_id: &str) -> AppResult<HashMap<String, Known>> {
    let mut st = c.prepare(
        "SELECT rel_path, size, mtime, source_id, removed FROM watched_files WHERE folder_id=?1",
    )?;
    let rows = st.query_map([folder_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            Known {
                stamp: Stamp {
                    size: r.get::<_, i64>(1)? as u64,
                    mtime: r.get(2)?,
                },
                source_id: r.get(3)?,
                removed: r.get::<_, i64>(4)? != 0,
            },
        ))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn upsert_file(
    c: &Connection,
    folder_id: &str,
    rel: &str,
    st: &Stamp,
    source_id: Option<&str>,
) -> AppResult<()> {
    c.execute(
        "INSERT INTO watched_files (folder_id, rel_path, size, mtime, source_id, removed) VALUES (?1, ?2, ?3, ?4, ?5, 0)
         ON CONFLICT(folder_id, rel_path) DO UPDATE SET size=?3, mtime=?4, source_id=?5, removed=0",
        params![folder_id, rel, st.size as i64, st.mtime, source_id],
    )?;
    Ok(())
}

pub fn start(app: &tauri::AppHandle, db: Db) {
    use tauri::{Emitter, Manager};
    let Some(ingest) = app.try_state::<Ingest>().map(|s| s.inner().clone()) else {
        log::error!("folder watcher not started: the import worker isn't running");
        return;
    };
    let handle = app.clone();
    let emit: Emit = Arc::new(move |event: &str, payload: serde_json::Value| {
        let _ = handle.emit(event, payload);
    });
    match WatchService::start(db, ingest, emit, Timing::default()) {
        Ok(svc) => {
            app.manage(svc);
        }
        Err(e) => log::error!("couldn't start the folder watcher: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models;
    use crate::ingest::embed::{EmbedderService, FakeEmbedder};

    struct Env {
        db: Db,
        ingest: Ingest,
        emit: Emit,
        space: String,
        _dir: tempfile::TempDir,
    }

    fn env() -> Env {
        let (db, dir) = crate::db::test_db();
        let emit: Emit = Arc::new(|_, _| {});
        let svc = Arc::new(EmbedderService::ready(Arc::new(FakeEmbedder), emit.clone()));
        let space = models::create_space(
            &db.conn().unwrap(),
            models::SpacePatch {
                name: Some("S".into()),
                ..Default::default()
            },
        )
        .unwrap()
        .id;
        let ingest = Ingest::spawn(db.clone(), svc, emit.clone()).unwrap();
        Env {
            db,
            ingest,
            emit,
            space,
            _dir: dir,
        }
    }

    fn core(e: &Env) -> Core {
        Core {
            db: e.db.clone(),
            ingest: e.ingest.clone(),
            emit: e.emit.clone(),
            timing: Timing::default(),
            runtime: Mutex::new(HashMap::new()),
        }
    }

    fn insert_folder(db: &Db, space: &str, path: &Path, recursive: bool) -> FolderState {
        let id = new_id();
        db.conn()
            .unwrap()
            .execute(
                "INSERT INTO watched_folders (id, space_id, path, recursive, created_at) VALUES (?1, ?2, ?3, ?4, 0)",
                params![id, space, path.to_string_lossy(), recursive as i64],
            )
            .unwrap();
        FolderState::new(FolderRow {
            id,
            space_id: space.into(),
            path: path.to_string_lossy().into(),
            recursive,
        })
    }

    fn sources(db: &Db, space: &str) -> Vec<models::Source> {
        let mut v = models::list_sources(&db.conn().unwrap(), space).unwrap();
        v.sort_by(|a, b| a.title.cmp(&b.title));
        v
    }

    fn wait_for<T>(what: &str, mut f: impl FnMut() -> Option<T>) -> T {
        let t = Instant::now();
        loop {
            if let Some(v) = f() {
                return v;
            }
            assert!(
                t.elapsed() < Duration::from_secs(20),
                "timed out waiting for {what}"
            );
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn wait_ready(db: &Db, id: &str) -> models::Source {
        wait_for("source ready", || {
            let s = models::get_source(&db.conn().unwrap(), id).unwrap();
            (s.status != "processing").then_some(s)
        })
    }

    fn text_of(db: &Db, id: &str) -> String {
        models::get_source_text(&db.conn().unwrap(), id)
            .unwrap()
            .text
    }

    #[test]
    fn scan_imports_once_skips_temp_files_and_reindexes_changes() {
        let e = env();
        let c = core(&e);
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        std::fs::write(r.join("Cells.md"), "# Cells\n\nMitochondria make energy.").unwrap();
        std::fs::write(r.join("Plants.txt"), "Chlorophyll absorbs light.").unwrap();
        std::fs::write(r.join(".DS_Store"), "junk").unwrap();
        std::fs::write(r.join("~$Report.docx"), "lock").unwrap();
        std::fs::write(r.join(".~lock.Report.docx#"), "lock").unwrap();
        std::fs::write(r.join("image.png"), "png").unwrap();
        std::fs::create_dir(r.join("week2")).unwrap();
        std::fs::write(r.join("week2/Atoms.md"), "Atoms have electrons.").unwrap();
        let mut f = insert_folder(&e.db, &e.space, r, true);

        assert!(c.sync(&mut f, None));
        assert!(
            sources(&e.db, &e.space).is_empty(),
            "first sight only records stamps"
        );
        assert_eq!(f.pending.len(), 3);
        assert!(f.due.is_some());

        assert!(c.sync(&mut f, None));
        let srcs = sources(&e.db, &e.space);
        let titles: Vec<&str> = srcs.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, vec!["Atoms", "Cells", "Plants"]);
        for s in &srcs {
            assert_eq!(wait_ready(&e.db, &s.id).status, "ready");
        }
        let folder = c.folder(&e.db.conn().unwrap(), &f.row.id).unwrap();
        assert_eq!((folder.file_count, folder.status.as_str()), (3, "watching"));

        // rescans don't duplicate
        c.sync(&mut f, None);
        c.sync(&mut f, None);
        assert_eq!(sources(&e.db, &e.space).len(), 3);

        // a changed file reindexes the same source
        let cells = srcs.iter().find(|s| s.title == "Cells").unwrap().id.clone();
        std::fs::write(
            r.join("Cells.md"),
            "# Cells\n\nRibosomes build proteins from amino acids.",
        )
        .unwrap();
        c.sync(&mut f, None);
        c.sync(&mut f, None);
        let after = sources(&e.db, &e.space);
        assert_eq!(after.len(), 3);
        assert!(after.iter().any(|s| s.id == cells));
        wait_ready(&e.db, &cells);
        wait_for("new text", || {
            text_of(&e.db, &cells).contains("Ribosomes").then_some(())
        });

        // a deleted file keeps its source
        std::fs::remove_file(r.join("Plants.txt")).unwrap();
        c.sync(&mut f, None);
        assert_eq!(sources(&e.db, &e.space).len(), 3);
        assert_eq!(
            c.folder(&e.db.conn().unwrap(), &f.row.id)
                .unwrap()
                .file_count,
            2
        );
    }

    #[test]
    fn growing_file_waits_until_stable() {
        let e = env();
        let c = core(&e);
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("Lecture.txt");
        std::fs::write(&file, "part one").unwrap();
        let mut f = insert_folder(&e.db, &e.space, dir.path(), false);
        c.sync(&mut f, None);
        std::fs::write(&file, "part one, part two, still copying").unwrap();
        c.sync(&mut f, None);
        assert!(sources(&e.db, &e.space).is_empty());
        c.sync(&mut f, None);
        let srcs = sources(&e.db, &e.space);
        assert_eq!(srcs.len(), 1);
        wait_ready(&e.db, &srcs[0].id);
        assert!(text_of(&e.db, &srcs[0].id).contains("still copying"));
    }

    #[test]
    fn missing_folder_is_an_error_state_not_a_panic() {
        let e = env();
        let c = core(&e);
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("Unplugged drive");
        let mut f = insert_folder(&e.db, &e.space, &gone, true);
        assert!(c.sync(&mut f, None));
        let st = c.folder(&e.db.conn().unwrap(), &f.row.id).unwrap();
        assert_eq!(st.status, "missing");
        assert!(st.error.unwrap().contains("Unplugged drive"));
        assert!(f.due.is_some(), "retried later");

        // comes back
        std::fs::create_dir(&gone).unwrap();
        std::fs::write(gone.join("a.md"), "Back again.").unwrap();
        c.sync(&mut f, None);
        c.sync(&mut f, None);
        assert_eq!(
            c.folder(&e.db.conn().unwrap(), &f.row.id).unwrap().status,
            "watching"
        );
        assert_eq!(sources(&e.db, &e.space).len(), 1);

        // deleted from the DB (e.g. space removed): the thread drops it
        e.db.conn()
            .unwrap()
            .execute("DELETE FROM watched_folders", [])
            .unwrap();
        assert!(!c.sync(&mut f, None));
    }

    fn fast() -> Timing {
        Timing {
            debounce: Duration::from_millis(100),
            recheck: Duration::from_millis(150),
            retry_missing: Duration::from_millis(200),
        }
    }

    #[test]
    fn add_validates_and_remove_keeps_sources() {
        let e = env();
        let svc =
            WatchService::start(e.db.clone(), e.ingest.clone(), e.emit.clone(), fast()).unwrap();
        assert!(svc.add(&e.space, "/definitely/not/here", true).is_err());
        assert!(svc.add(&e.space, "relative/path", true).is_err());
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "Alpha.").unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        let f = svc.add(&e.space, &path, true).unwrap();
        assert!(svc.add(&e.space, &path, true).is_err(), "duplicate");
        wait_for("import", || {
            (sources(&e.db, &e.space).len() == 1).then_some(())
        });
        svc.remove(&f.id).unwrap();
        assert!(svc.list(&e.space).unwrap().is_empty());
        assert_eq!(sources(&e.db, &e.space).len(), 1);
        svc.stop();
    }

    #[test]
    fn notify_picks_up_new_files_and_restart_restores_watchers() {
        let e = env();
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("first.md"), "First file.").unwrap();
        let path = dir.path().to_string_lossy().into_owned();

        let svc =
            WatchService::start(e.db.clone(), e.ingest.clone(), e.emit.clone(), fast()).unwrap();
        let f = svc.add(&e.space, &path, true).unwrap();
        wait_for("initial import", || {
            (sources(&e.db, &e.space).len() == 1).then_some(())
        });
        wait_for("watching", || {
            let l = svc.list(&e.space).unwrap();
            (l[0].status == "watching" && l[0].file_count == 1).then_some(())
        });

        // no manual rescan: only the filesystem event can trigger this import
        std::fs::write(dir.path().join("second.txt"), "Dropped in later.").unwrap();
        wait_for("notify import", || {
            (sources(&e.db, &e.space).len() == 2).then_some(())
        });
        svc.stop();

        // app closed: a file arrives; on restart the watcher comes back and catches up
        std::thread::sleep(Duration::from_millis(100));
        std::fs::write(dir.path().join("third.md"), "Added while closed.").unwrap();
        let svc2 =
            WatchService::start(e.db.clone(), e.ingest.clone(), e.emit.clone(), fast()).unwrap();
        let l = svc2.list(&e.space).unwrap();
        assert_eq!((l.len(), l[0].id.as_str()), (1, f.id.as_str()));
        wait_for("catch-up import", || {
            (sources(&e.db, &e.space).len() == 3).then_some(())
        });
        std::fs::write(dir.path().join("fourth.md"), "After restart.").unwrap();
        wait_for("watching after restart", || {
            (sources(&e.db, &e.space).len() == 4).then_some(())
        });
        svc2.touch(&f.id);
        std::thread::sleep(Duration::from_millis(400));
        assert_eq!(sources(&e.db, &e.space).len(), 4);
        svc2.stop();
    }
}
