//! Where the app keeps its data, for the command line and the MCP server (which run without Tauri),
//! plus a read-only way to open the database.
use crate::error::{invalid, AppResult};
use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};

pub const IDENTIFIER: &str = "dev.ponder.app";

/// Same folder Tauri's `app_data_dir` resolves to for this app's identifier.
pub fn default_data_dir() -> Option<PathBuf> {
    let home = || std::env::var_os("HOME").map(PathBuf::from);
    let base = if cfg!(target_os = "macos") {
        home()?.join("Library/Application Support")
    } else if cfg!(windows) {
        PathBuf::from(std::env::var_os("APPDATA")?)
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| home().map(|h| h.join(".local/share")))?
    };
    Some(base.join(IDENTIFIER))
}

/// `--db` wins, then `PONDER_DB`, then the app's own database.
pub fn resolve_db(flag: Option<&str>) -> AppResult<PathBuf> {
    let p = match flag
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("PONDER_DB").map(PathBuf::from))
    {
        Some(p) => p,
        None => default_data_dir()
            .ok_or_else(|| invalid("Can't find the Ponder data folder."))?
            .join("app.db"),
    };
    if !p.is_file() {
        return Err(invalid(format!(
            "No Ponder database at {}. Open the app once first.",
            p.display()
        )));
    }
    Ok(p)
}

/// Read-only: never creates, migrates or writes anything.
pub fn open_readonly(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(conn)
}

/// Read-write for the MCP server's write tools. Never creates or migrates: the app owns the schema.
pub fn open_for_inbox(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(std::time::Duration::from_secs(10))?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    let has_inbox: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'inbox')",
        [],
        |r| r.get(0),
    )?;
    if !has_inbox {
        return Err(invalid("This Ponder database is too old for --write. Open the updated app once, then try again."));
    }
    Ok(conn)
}

pub struct SpaceRow {
    pub id: String,
    pub name: String,
    pub source_count: i64,
}

pub fn list_spaces(conn: &Connection) -> AppResult<Vec<SpaceRow>> {
    let mut st = conn.prepare(
        "SELECT s.id, s.name, (SELECT count(*) FROM sources x WHERE x.space_id = s.id)
         FROM spaces s ORDER BY coalesce(s.last_opened_at, s.updated_at) DESC",
    )?;
    let rows = st
        .query_map([], |r| {
            Ok(SpaceRow {
                id: r.get(0)?,
                name: r.get(1)?,
                source_count: r.get(2)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

/// A space by id, or by name when exactly one matches (case-insensitive).
pub fn resolve_space(conn: &Connection, key: &str) -> AppResult<String> {
    let spaces = list_spaces(conn)?;
    if let Some(s) = spaces.iter().find(|s| s.id == key) {
        return Ok(s.id.clone());
    }
    let hits: Vec<&SpaceRow> = spaces
        .iter()
        .filter(|s| s.name.eq_ignore_ascii_case(key.trim()))
        .collect();
    match hits.as_slice() {
        [one] => Ok(one.id.clone()),
        [] => Err(invalid(format!(
            "No space matches “{key}”. List them with: ponder spaces"
        ))),
        _ => Err(invalid(format!(
            "More than one space is named “{key}”. Use its id (ponder spaces)."
        ))),
    }
}
