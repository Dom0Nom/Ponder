//! Automatic local backups: a consistent SQLite snapshot plus app-owned files in one zip,
//! pruned to the newest N, restored by staging the snapshot and swapping it in on next start.
use crate::db::{self, models, now_ms, Db};
use crate::error::{invalid, invalid_key, AppError, AppResult};
use crate::AppState;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

const KEY_CONFIG: &str = "backup.config";
const PREFIX: &str = "ponder-backup-";
const EXT: &str = ".zip";
const MANIFEST: &str = "manifest.json";
const DB_ENTRY: &str = "app.db";
const FILES_PREFIX: &str = "files/";
const OWNED_DIRS: [&str; 2] = ["images", "imports"];
const STAGING: &str = "restore-staging";
const MARKER: &str = "restore-pending.json";
const BEFORE: &str = ".before-restore";
const CHECK_EVERY: std::time::Duration = std::time::Duration::from_secs(15 * 60);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupConfig {
    pub enabled: bool,
    pub folder: Option<String>,
    /// "daily" or "weekly"
    pub frequency: String,
    pub keep: u32,
}

impl Default for BackupConfig {
    fn default() -> Self {
        BackupConfig {
            enabled: false,
            folder: None,
            frequency: "daily".into(),
            keep: 7,
        }
    }
}

impl BackupConfig {
    fn interval_ms(&self) -> i64 {
        let day = 24 * 3600 * 1000;
        if self.frequency == "weekly" {
            7 * day
        } else {
            day
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub size: u64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub config: BackupConfig,
    pub backups: Vec<BackupInfo>,
    pub running: bool,
    pub last_error: Option<String>,
    pub restore_staged: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format: u32,
    app_version: String,
    schema_version: i64,
    created_at: i64,
}

#[derive(Default)]
pub struct BackupService {
    run: Mutex<()>,
    last_error: Mutex<Option<String>>,
}

pub fn load_config(c: &Connection) -> BackupConfig {
    models::get_setting(c, KEY_CONFIG)
        .ok()
        .flatten()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn save_config(c: &Connection, cfg: &BackupConfig) -> AppResult<()> {
    models::set_setting(c, KEY_CONFIG, &serde_json::to_value(cfg)?)
}

fn civil(ms: i64) -> (i64, u32, u32, u32, u32, u32) {
    let secs = ms.div_euclid(1000);
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400) as u32;
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    (y, m, d, rem / 3600, rem % 3600 / 60, rem % 60)
}

fn file_name_for(ms: i64) -> String {
    let (y, mo, d, h, mi, s) = civil(ms);
    format!("{PREFIX}{y:04}-{mo:02}-{d:02}-{h:02}{mi:02}{s:02}{EXT}")
}

fn parse_name(name: &str) -> Option<i64> {
    let t = name.strip_prefix(PREFIX)?.strip_suffix(EXT)?;
    let b = t.as_bytes();
    if b.len() != 17 || b[4] != b'-' || b[7] != b'-' || b[10] != b'-' {
        return None;
    }
    let n = |r: std::ops::Range<usize>| -> Option<i64> {
        let s = t.get(r)?;
        s.bytes()
            .all(|c| c.is_ascii_digit())
            .then(|| s.parse().ok())
            .flatten()
    };
    let (y, mo, d, h, mi, s) = (
        n(0..4)?,
        n(5..7)?,
        n(8..10)?,
        n(11..13)?,
        n(13..15)?,
        n(15..17)?,
    );
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2.rem_euclid(400);
    let mp = if mo > 2 { mo - 3 } else { mo + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some((days * 86400 + h * 3600 + mi * 60 + s) * 1000)
}

pub fn list_backups(dir: &Path) -> Vec<BackupInfo> {
    let Ok(rd) = fs::read_dir(dir) else {
        return vec![];
    };
    let mut out: Vec<BackupInfo> = rd
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let created_at = parse_name(&name)?;
            let meta = e.metadata().ok().filter(|m| m.is_file())?;
            Some(BackupInfo {
                name,
                size: meta.len(),
                created_at,
            })
        })
        .collect();
    out.sort_by(|a, b| b.name.cmp(&a.name));
    out
}

pub fn prune(dir: &Path, keep: u32) -> AppResult<usize> {
    let keep = keep.max(1) as usize;
    let mut removed = 0;
    for b in list_backups(dir).into_iter().skip(keep) {
        fs::remove_file(dir.join(&b.name))?;
        removed += 1;
    }
    Ok(removed)
}

pub fn is_due(cfg: &BackupConfig, latest: Option<i64>, now: i64) -> bool {
    cfg.enabled && cfg.folder.is_some() && latest.is_none_or(|t| now - t >= cfg.interval_ms())
}

fn zip_err(e: zip::result::ZipError) -> AppError {
    AppError::Other(format!("zip error: {e}"))
}

fn add_dir(
    zip: &mut zip::ZipWriter<File>,
    root: &Path,
    dir: &Path,
    opts: zip::write::SimpleFileOptions,
) -> AppResult<()> {
    let Ok(rd) = fs::read_dir(dir) else {
        return Ok(());
    };
    for e in rd.flatten() {
        let path = e.path();
        let ft = e.file_type()?;
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            add_dir(zip, root, &path, opts)?;
        } else {
            let rel = path
                .strip_prefix(root)
                .map_err(|e| AppError::Other(e.to_string()))?;
            let entry = format!("{FILES_PREFIX}{}", rel.to_string_lossy().replace('\\', "/"));
            zip.start_file(entry, opts).map_err(zip_err)?;
            std::io::copy(&mut File::open(&path)?, zip)?;
        }
    }
    Ok(())
}

/// Writes one backup zip into `dest`: a `VACUUM INTO` snapshot of the DB (consistent even while
/// the app writes) plus the app-owned file folders. Written under a temp name, renamed when complete.
pub fn create_backup(
    db: &Db,
    data_dir: &Path,
    dest: &Path,
    app_version: &str,
) -> AppResult<BackupInfo> {
    fs::create_dir_all(dest)?;
    let now = now_ms() / 1000 * 1000;
    let name = file_name_for(now);
    let final_path = dest.join(&name);
    if final_path.exists() {
        return Err(invalid_key(
            "backupJustMade",
            "A backup was just made. Try again in a moment.",
        ));
    }
    let tmp_snapshot = dest.join(format!(".{name}.db.tmp"));
    let tmp_zip = dest.join(format!(".{name}.tmp"));
    let _ = fs::remove_file(&tmp_snapshot);
    let result = (|| -> AppResult<()> {
        let conn = db.conn()?;
        conn.execute("VACUUM INTO ?1", [tmp_snapshot.to_string_lossy().as_ref()])?;
        let schema_version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .large_file(true);
        let mut zip = zip::ZipWriter::new(File::create(&tmp_zip)?);
        let manifest = Manifest {
            format: 1,
            app_version: app_version.into(),
            schema_version,
            created_at: now,
        };
        zip.start_file(MANIFEST, opts).map_err(zip_err)?;
        zip.write_all(&serde_json::to_vec_pretty(&manifest)?)?;
        zip.start_file(DB_ENTRY, opts).map_err(zip_err)?;
        std::io::copy(&mut File::open(&tmp_snapshot)?, &mut zip)?;
        for d in OWNED_DIRS {
            add_dir(&mut zip, data_dir, &data_dir.join(d), opts)?;
        }
        zip.finish().map_err(zip_err)?;
        fs::rename(&tmp_zip, &final_path)?;
        Ok(())
    })();
    let _ = fs::remove_file(&tmp_snapshot);
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp_zip);
        return Err(e);
    }
    let size = fs::metadata(&final_path)?.len();
    Ok(BackupInfo {
        name,
        size,
        created_at: now,
    })
}

fn staging_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(STAGING)
}

fn marker_path(data_dir: &Path) -> PathBuf {
    data_dir.join(MARKER)
}

pub fn restore_staged(data_dir: &Path) -> bool {
    marker_path(data_dir).exists() && staging_dir(data_dir).join(DB_ENTRY).exists()
}

pub fn cancel_restore(data_dir: &Path) -> AppResult<()> {
    let _ = fs::remove_file(marker_path(data_dir));
    let s = staging_dir(data_dir);
    if s.exists() {
        fs::remove_dir_all(s)?;
    }
    Ok(())
}

fn check_snapshot(path: &Path) -> AppResult<i64> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| invalid("This backup's database can't be opened."))?;
    let ok: String = conn
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|_| invalid("This backup's database can't be read."))?;
    if ok != "ok" {
        return Err(invalid("This backup's database is damaged."));
    }
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 1 {
        return Err(invalid("This file isn't a Ponder database."));
    }
    if version > db::schema_version() {
        return Err(invalid(
            "This backup was made by a newer version of Ponder. Update the app first.",
        ));
    }
    for table in ["spaces", "sources", "chunks", "settings"] {
        let n: i64 = conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE name = ?1",
            [table],
            |r| r.get(0),
        )?;
        if n == 0 {
            return Err(invalid("This backup is missing expected data."));
        }
    }
    Ok(version)
}

/// Unpacks and validates a backup into the staging folder and writes the marker.
/// The live database is not touched; `apply_pending_restore` swaps it in on next start.
pub fn stage_restore(data_dir: &Path, zip_path: &Path) -> AppResult<()> {
    let not_backup = || invalid("This isn't a Ponder backup.");
    let mut archive = zip::ZipArchive::new(File::open(zip_path)?).map_err(|_| not_backup())?;
    let manifest: Manifest = {
        let mut f = archive.by_name(MANIFEST).map_err(|_| not_backup())?;
        let mut s = String::new();
        f.read_to_string(&mut s)?;
        serde_json::from_str(&s).map_err(|_| not_backup())?
    };
    if manifest.format != 1 {
        return Err(invalid(
            "This backup uses a format this version doesn't know.",
        ));
    }
    cancel_restore(data_dir)?;
    let staging = staging_dir(data_dir);
    fs::create_dir_all(&staging)?;
    let result = (|| -> AppResult<()> {
        for i in 0..archive.len() {
            let mut f = archive.by_index(i).map_err(zip_err)?;
            let Some(enclosed) = f.enclosed_name() else {
                continue;
            };
            if f.is_dir() {
                continue;
            }
            let target = if enclosed == Path::new(DB_ENTRY) {
                staging.join(DB_ENTRY)
            } else if let Ok(rel) = enclosed.strip_prefix("files") {
                let top = rel
                    .components()
                    .next()
                    .map(|c| c.as_os_str().to_string_lossy().into_owned());
                if !top.is_some_and(|t| OWNED_DIRS.contains(&t.as_str())) {
                    continue;
                }
                staging.join(rel)
            } else {
                continue;
            };
            if let Some(p) = target.parent() {
                fs::create_dir_all(p)?;
            }
            let limit = 4 * 1024 * 1024 * 1024u64;
            if std::io::copy(&mut (&mut f).take(limit + 1), &mut File::create(&target)?)? > limit {
                return Err(invalid("A file in this backup is too large."));
            }
        }
        if !staging.join(DB_ENTRY).exists() {
            return Err(invalid("This backup has no database."));
        }
        let version = check_snapshot(&staging.join(DB_ENTRY))?;
        let marker = serde_json::json!({ "schemaVersion": version, "stagedAt": now_ms() });
        fs::write(marker_path(data_dir), serde_json::to_vec(&marker)?)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

fn set_aside(path: &Path) -> AppResult<()> {
    if !path.exists() {
        return Ok(());
    }
    let target = with_suffix(path, BEFORE);
    if target.is_dir() {
        fs::remove_dir_all(&target)?;
    } else if target.exists() {
        fs::remove_file(&target)?;
    }
    fs::rename(path, target)?;
    Ok(())
}

/// Must run before the database is opened. Keeps the previous DB and owned folders as `*.before-restore`.
pub fn apply_pending_restore(data_dir: &Path) -> AppResult<bool> {
    if !marker_path(data_dir).exists() {
        return Ok(false);
    }
    let staging = staging_dir(data_dir);
    if !staging.join(DB_ENTRY).exists() {
        let _ = fs::remove_file(marker_path(data_dir));
        return Ok(false);
    }
    let live = data_dir.join(DB_ENTRY);
    let wal = with_suffix(&live, "-wal");
    let mut moved: Vec<PathBuf> = Vec::new();
    let result = (|| -> AppResult<()> {
        for p in [live.clone(), wal.clone()]
            .into_iter()
            .chain(OWNED_DIRS.iter().map(|d| data_dir.join(d)))
        {
            if p.exists() {
                set_aside(&p)?;
                moved.push(p);
            }
        }
        let _ = fs::remove_file(with_suffix(&live, "-shm"));
        fs::rename(staging.join(DB_ENTRY), &live)?;
        for d in OWNED_DIRS {
            let staged = staging.join(d);
            if staged.exists() {
                fs::rename(staged, data_dir.join(d))?;
            }
        }
        Ok(())
    })();
    if let Err(e) = result {
        for p in moved.iter().rev() {
            if p.is_dir() {
                let _ = fs::remove_dir_all(p);
            } else {
                let _ = fs::remove_file(p);
            }
            let _ = fs::rename(with_suffix(p, BEFORE), p);
        }
        let _ = fs::remove_file(marker_path(data_dir));
        return Err(e);
    }
    fs::remove_file(marker_path(data_dir))?;
    let _ = fs::remove_dir_all(&staging);
    Ok(true)
}

/// A name from the UI must be a plain backup file name in the chosen folder.
fn backup_path(cfg: &BackupConfig, name: &str) -> AppResult<PathBuf> {
    let folder = cfg
        .folder
        .as_deref()
        .ok_or_else(|| invalid_key("chooseBackupFolder", "Choose a backup folder first."))?;
    if parse_name(name).is_none() {
        return Err(invalid_key("notBackupFile", "Not a backup file."));
    }
    let p = Path::new(folder).join(name);
    if !p.is_file() {
        return Err(AppError::NotFound("backup".into()));
    }
    Ok(p)
}

impl BackupService {
    fn status(&self, db: &Db, data_dir: &Path) -> AppResult<BackupStatus> {
        let config = load_config(&db.conn()?);
        let backups = config
            .folder
            .as_deref()
            .map(|f| list_backups(Path::new(f)))
            .unwrap_or_default();
        Ok(BackupStatus {
            config,
            backups,
            running: self.run.try_lock().is_err(),
            last_error: self
                .last_error
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
            restore_staged: restore_staged(data_dir),
        })
    }

    pub fn run_now(&self, db: &Db, data_dir: &Path, version: &str) -> AppResult<BackupInfo> {
        let _guard = self.run.lock().unwrap_or_else(|e| e.into_inner());
        let cfg = load_config(&db.conn()?);
        let folder = cfg
            .folder
            .clone()
            .ok_or_else(|| invalid_key("chooseBackupFolder", "Choose a backup folder first."))?;
        let res = create_backup(db, data_dir, Path::new(&folder), version).and_then(|b| {
            prune(Path::new(&folder), cfg.keep)?;
            Ok(b)
        });
        *self.last_error.lock().unwrap_or_else(|e| e.into_inner()) =
            res.as_ref().err().map(|e| e.to_string());
        res
    }

    fn run_if_due(&self, db: &Db, data_dir: &Path, version: &str) -> Option<AppResult<BackupInfo>> {
        let cfg = load_config(&db.conn().ok()?);
        let latest = list_backups(Path::new(cfg.folder.as_deref()?))
            .first()
            .map(|b| b.created_at);
        is_due(&cfg, latest, now_ms()).then(|| self.run_now(db, data_dir, version))
    }
}

/// Startup check plus a periodic one: a missed interval produces one backup.
pub fn start(app: &AppHandle, db: Db, data_dir: PathBuf) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(20));
        loop {
            let svc = app.state::<BackupService>();
            let version = app.package_info().version.to_string();
            if let Some(res) = svc.run_if_due(&db, &data_dir, &version) {
                if let Err(e) = &res {
                    log::warn!("automatic backup failed: {e}");
                }
                let _ = app.emit("backup://updated", ());
            }
            std::thread::sleep(CHECK_EVERY);
        }
    });
}

#[tauri::command]
pub async fn backup_status(
    state: State<'_, AppState>,
    svc: State<'_, BackupService>,
) -> AppResult<BackupStatus> {
    svc.status(&state.db, &state.data_dir)
}

#[tauri::command]
pub async fn backup_configure(
    state: State<'_, AppState>,
    svc: State<'_, BackupService>,
    enabled: bool,
    frequency: String,
    keep: u32,
) -> AppResult<BackupStatus> {
    if !["daily", "weekly"].contains(&frequency.as_str()) {
        return Err(invalid("Unknown backup frequency."));
    }
    let c = state.db.conn()?;
    let mut cfg = load_config(&c);
    if enabled && cfg.folder.is_none() {
        return Err(invalid_key(
            "chooseBackupFolder",
            "Choose a backup folder first.",
        ));
    }
    cfg.enabled = enabled;
    cfg.frequency = frequency;
    cfg.keep = keep.clamp(1, 100);
    save_config(&c, &cfg)?;
    svc.status(&state.db, &state.data_dir)
}

/// The folder comes from a native dialog, never from the webview.
#[tauri::command]
pub async fn backup_choose_folder(
    window: WebviewWindow,
    state: State<'_, AppState>,
    svc: State<'_, BackupService>,
) -> AppResult<BackupStatus> {
    let picked = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(crate::i18n::t("native.dialog.backupFolder"))
        .blocking_pick_folder();
    if let Some(p) = picked {
        let p = p.into_path().map_err(|e| AppError::Other(e.to_string()))?;
        let c = state.db.conn()?;
        let mut cfg = load_config(&c);
        cfg.folder = Some(p.to_string_lossy().into_owned());
        save_config(&c, &cfg)?;
    }
    svc.status(&state.db, &state.data_dir)
}

#[tauri::command]
pub async fn backup_now(app: AppHandle, state: State<'_, AppState>) -> AppResult<BackupInfo> {
    let version = app.package_info().version.to_string();
    let (db, dir) = (state.db.clone(), state.data_dir.clone());
    let app2 = app.clone();
    let res = tauri::async_runtime::spawn_blocking(move || {
        app2.state::<BackupService>().run_now(&db, &dir, &version)
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;
    let _ = app.emit("backup://updated", ());
    res
}

#[tauri::command]
pub async fn backup_delete(
    state: State<'_, AppState>,
    svc: State<'_, BackupService>,
    name: String,
) -> AppResult<BackupStatus> {
    let cfg = load_config(&state.db.conn()?);
    fs::remove_file(backup_path(&cfg, &name)?)?;
    svc.status(&state.db, &state.data_dir)
}

#[tauri::command]
pub async fn backup_restore(
    state: State<'_, AppState>,
    svc: State<'_, BackupService>,
    name: String,
) -> AppResult<BackupStatus> {
    let cfg = load_config(&state.db.conn()?);
    let path = backup_path(&cfg, &name)?;
    let dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || stage_restore(&dir, &path))
        .await
        .map_err(|e| AppError::Other(e.to_string()))??;
    svc.status(&state.db, &state.data_dir)
}

#[tauri::command]
pub async fn backup_cancel_restore(
    state: State<'_, AppState>,
    svc: State<'_, BackupService>,
) -> AppResult<BackupStatus> {
    cancel_restore(&state.data_dir)?;
    svc.status(&state.db, &state.data_dir)
}

#[tauri::command]
pub async fn restart_app(app: AppHandle) -> AppResult<()> {
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;

    fn count(db: &Db, sql: &str) -> i64 {
        db.conn().unwrap().query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn seed(db: &Db, data_dir: &Path) {
        let c = db.conn().unwrap();
        c.execute(
            "INSERT INTO spaces (id,name,created_at,updated_at) VALUES ('s1','Biology',1,1)",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO sources (id,space_id,title,kind,created_at,updated_at) VALUES ('a','s1','Cells','text',1,1)", []).unwrap();
        c.execute("INSERT INTO chunks (source_id,space_id,ord,text,start_offset,end_offset) VALUES ('a','s1',0,'mitochondria make energy',0,24)", []).unwrap();
        fs::create_dir_all(data_dir.join("images")).unwrap();
        fs::write(data_dir.join("images/pic.png"), b"png-bytes").unwrap();
    }

    #[test]
    fn names_roundtrip() {
        let ms = 1_760_000_000_000;
        let n = file_name_for(ms);
        assert_eq!(parse_name(&n), Some(ms));
        assert_eq!(parse_name("ponder-backup-nope.zip"), None);
        assert_eq!(parse_name("../ponder-backup-2026-10-12-143005.zip"), None);
    }

    #[test]
    fn due_logic() {
        let cfg = BackupConfig {
            enabled: true,
            folder: Some("/x".into()),
            ..Default::default()
        };
        let day = 24 * 3600 * 1000;
        assert!(is_due(&cfg, None, 5 * day));
        assert!(!is_due(&cfg, Some(4 * day + 1), 5 * day));
        assert!(is_due(&cfg, Some(4 * day), 5 * day));
        assert!(!is_due(
            &BackupConfig {
                enabled: false,
                ..cfg.clone()
            },
            None,
            day
        ));
        assert!(!is_due(
            &BackupConfig {
                frequency: "weekly".into(),
                ..cfg.clone()
            },
            Some(0),
            6 * day
        ));
    }

    #[test]
    fn snapshot_contains_data_and_files() {
        let (db, dir) = test_db();
        seed(&db, dir.path());
        let dest = tempfile::tempdir().unwrap();
        let info = create_backup(&db, dir.path(), dest.path(), "9.9.9").unwrap();
        assert!(info.size > 0);
        assert_eq!(list_backups(dest.path()), vec![info.clone()]);
        let mut z =
            zip::ZipArchive::new(File::open(dest.path().join(&info.name)).unwrap()).unwrap();
        let names: Vec<String> = (0..z.len())
            .map(|i| z.by_index(i).unwrap().name().to_string())
            .collect();
        assert!(names.contains(&"app.db".to_string()));
        assert!(names.contains(&"files/images/pic.png".to_string()));
        assert!(names.contains(&"manifest.json".to_string()));
        assert!(fs::read_dir(dest.path())
            .unwrap()
            .flatten()
            .all(|e| !e.file_name().to_string_lossy().starts_with('.')));
    }

    #[test]
    fn prune_keeps_newest() {
        let dest = tempfile::tempdir().unwrap();
        for i in 0..5 {
            fs::write(
                dest.path()
                    .join(file_name_for(1_760_000_000_000 + i * 1000)),
                b"x",
            )
            .unwrap();
        }
        fs::write(dest.path().join("notes.txt"), b"keep").unwrap();
        assert_eq!(prune(dest.path(), 2).unwrap(), 3);
        let left = list_backups(dest.path());
        assert_eq!(left.len(), 2);
        assert_eq!(left[0].created_at, 1_760_000_004_000);
        assert!(dest.path().join("notes.txt").exists());
    }

    #[test]
    fn restore_swaps_on_start_and_keeps_previous() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().to_path_buf();
        let live = data.join("app.db");
        let db = Db::open(&live).unwrap();
        seed(&db, &data);
        let dest = tempfile::tempdir().unwrap();
        let info = create_backup(&db, &data, dest.path(), "1.0.0").unwrap();
        db.conn()
            .unwrap()
            .execute(
                "INSERT INTO spaces (id,name,created_at,updated_at) VALUES ('s2','Later',2,2)",
                [],
            )
            .unwrap();
        fs::write(data.join("images/pic.png"), b"changed").unwrap();

        stage_restore(&data, &dest.path().join(&info.name)).unwrap();
        assert!(restore_staged(&data));
        assert_eq!(count(&db, "SELECT count(*) FROM spaces"), 2);
        assert_eq!(fs::read(data.join("images/pic.png")).unwrap(), b"changed");

        assert!(apply_pending_restore(&data).unwrap());
        assert!(!restore_staged(&data));
        assert_eq!(fs::read(data.join("images/pic.png")).unwrap(), b"png-bytes");
        assert_eq!(
            fs::read(data.join("images.before-restore/pic.png")).unwrap(),
            b"changed"
        );
        let restored = Db::open(&live).unwrap();
        assert_eq!(count(&restored, "SELECT count(*) FROM spaces"), 1);
        assert_eq!(
            count(
                &restored,
                "SELECT count(*) FROM chunks_fts WHERE chunks_fts MATCH 'mitochondria'"
            ),
            1
        );
        let before = Db::open(data.join("app.db.before-restore")).unwrap();
        assert_eq!(count(&before, "SELECT count(*) FROM spaces"), 2);
        assert!(!apply_pending_restore(&data).unwrap());
    }

    #[test]
    fn rejects_bad_backups() {
        let dir = tempfile::tempdir().unwrap();
        let bad = dir.path().join("ponder-backup-2026-01-01-000000.zip");
        fs::write(&bad, b"not a zip").unwrap();
        assert!(stage_restore(dir.path(), &bad).is_err());

        let newer = dir.path().join("newer.zip");
        let snap = dir.path().join("snap.db");
        {
            let c = Connection::open(&snap).unwrap();
            c.execute_batch("CREATE TABLE spaces(id); CREATE TABLE sources(id); CREATE TABLE chunks(id); CREATE TABLE settings(k);").unwrap();
            c.pragma_update(None, "user_version", 999).unwrap();
        }
        let opts = zip::write::SimpleFileOptions::default();
        let mut out = zip::ZipWriter::new(File::create(&newer).unwrap());
        out.start_file(MANIFEST, opts).unwrap();
        out.write_all(br#"{"format":1,"appVersion":"1","schemaVersion":999,"createdAt":1}"#)
            .unwrap();
        out.start_file(DB_ENTRY, opts).unwrap();
        out.write_all(&fs::read(&snap).unwrap()).unwrap();
        out.finish().unwrap();
        let e = stage_restore(dir.path(), &newer).unwrap_err().to_string();
        assert!(e.contains("newer version"), "{e}");
        assert!(!restore_staged(dir.path()));
        assert!(!dir.path().join(STAGING).exists());
    }

    #[test]
    fn backup_path_rejects_traversal() {
        let cfg = BackupConfig {
            folder: Some("/tmp".into()),
            ..Default::default()
        };
        assert!(backup_path(&cfg, "../etc/passwd").is_err());
        assert!(backup_path(&cfg, "ponder-backup-2026-01-01-000000.zip").is_err());
    }
}
