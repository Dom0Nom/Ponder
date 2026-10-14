//! Sources and notes handed over by other apps through the MCP server. The MCP process only
//! queues rows here; the open app imports them with its normal importers and records the result.
use crate::db::{new_id, now_ms, Db};
use crate::error::{invalid, AppError, AppResult};
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::State;

pub const MAX_TEXT: usize = 5_000_000;
pub const MAX_TITLE: usize = 300;
const KEEP_FINISHED_MS: i64 = 30 * 24 * 3600 * 1000;
const POLL: Duration = Duration::from_secs(2);

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    pub id: String,
    pub space_id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub target: Option<String>,
    pub use_as_source: bool,
    pub status: String,
    pub error: Option<String>,
    pub result_id: Option<String>,
    pub created_at: i64,
}

const COLS: &str =
    "id, space_id, kind, title, body, target, use_as_source, status, error, result_id, created_at";

fn row(r: &rusqlite::Row) -> rusqlite::Result<InboxItem> {
    Ok(InboxItem {
        id: r.get(0)?,
        space_id: r.get(1)?,
        kind: r.get(2)?,
        title: r.get(3)?,
        body: r.get(4)?,
        target: r.get(5)?,
        use_as_source: r.get::<_, i64>(6)? != 0,
        status: r.get(7)?,
        error: r.get(8)?,
        result_id: r.get(9)?,
        created_at: r.get(10)?,
    })
}

pub struct NewItem<'a> {
    pub space_id: &'a str,
    pub kind: &'a str,
    pub title: &'a str,
    pub body: &'a str,
    pub target: Option<&'a str>,
    pub use_as_source: bool,
}

pub fn queue(c: &Connection, n: NewItem) -> AppResult<InboxItem> {
    if !matches!(n.kind, "text" | "url" | "file" | "note") {
        return Err(invalid(format!("Unknown kind: {}", n.kind)));
    }
    if n.title.chars().count() > MAX_TITLE {
        return Err(invalid("Titles can be up to 300 characters."));
    }
    if n.body.len() > MAX_TEXT {
        return Err(invalid("Text can be up to 5 MB."));
    }
    let id = new_id();
    let now = now_ms();
    c.execute(
        "INSERT INTO inbox (id, space_id, kind, title, body, target, use_as_source, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![id, n.space_id, n.kind, n.title.trim(), n.body, n.target, n.use_as_source as i64, now],
    )?;
    get(c, &id)?.ok_or_else(|| AppError::NotFound(format!("Inbox item “{id}”")))
}

pub fn get(c: &Connection, id: &str) -> AppResult<Option<InboxItem>> {
    Ok(c.query_row(
        &format!("SELECT {COLS} FROM inbox WHERE id = ?1"),
        [id],
        row,
    )
    .optional()?)
}

/// Pending items, oldest first. Finished rows older than 30 days are dropped on the way.
pub fn pending(c: &Connection) -> AppResult<Vec<InboxItem>> {
    c.execute(
        "DELETE FROM inbox WHERE status != 'pending' AND updated_at < ?1",
        [now_ms() - KEEP_FINISHED_MS],
    )?;
    let mut st = c.prepare(&format!(
        "SELECT {COLS} FROM inbox WHERE status = 'pending' ORDER BY created_at, id"
    ))?;
    let rows = st.query_map([], row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn finish(
    c: &Connection,
    id: &str,
    result_id: Option<&str>,
    error: Option<&str>,
) -> AppResult<()> {
    let status = if error.is_some() { "error" } else { "done" };
    let n = c.execute(
        "UPDATE inbox SET status = ?2, result_id = ?3, error = ?4, body = '', updated_at = ?5 WHERE id = ?1",
        params![id, status, result_id, error, now_ms()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("Inbox item “{id}”")));
    }
    Ok(())
}

/// Changes another process could have made: pending inbox rows (count and newest row) and the set
/// of spaces. The newest row matters: one item finishing while another is queued keeps the count.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Signature {
    pending: i64,
    newest: i64,
    spaces: i64,
    touched: i64,
}

fn signature(c: &Connection) -> rusqlite::Result<Signature> {
    c.query_row(
        "SELECT (SELECT count(*) FROM inbox WHERE status = 'pending'), (SELECT coalesce(max(rowid), 0) FROM inbox), (SELECT count(*) FROM spaces), (SELECT coalesce(max(updated_at), 0) FROM spaces)",
        [],
        |r| {
            Ok(Signature {
                pending: r.get(0)?,
                newest: r.get(1)?,
                spaces: r.get(2)?,
                touched: r.get(3)?,
            })
        },
    )
}

/// Polls between nudges while items stay pending, in case the UI missed one (it was mid-run).
const RENUDGE_POLLS: u32 = 5;

/// Whether to tell the UI, given the last signature, this one and how many polls passed since the
/// last nudge.
fn should_nudge(last: Option<Signature>, now: Signature, quiet_polls: u32) -> bool {
    let Some(last) = last else { return false };
    let spaces_changed = (last.spaces, last.touched) != (now.spaces, now.touched);
    let new_items = now.newest != last.newest && now.pending > 0;
    let still_pending = now.pending > 0 && quiet_polls >= RENUDGE_POLLS;
    spaces_changed || new_items || still_pending || (now.pending > last.pending)
}

/// Polls for rows the MCP server queued and tells the UI, which imports them. Runs in Rust so a
/// hidden or minimized window (whose timers WebKit throttles) still starts imports.
pub fn start(app: &tauri::AppHandle, db: Db) {
    use tauri::Emitter;
    let handle = app.clone();
    let spawned = std::thread::Builder::new()
        .name("inbox".into())
        .spawn(move || {
            let mut last = None;
            let mut quiet = 0;
            loop {
                std::thread::sleep(POLL);
                let Ok(c) = db.conn() else { continue };
                let Ok(sig) = signature(&c) else { continue };
                if should_nudge(last, sig, quiet) {
                    let _ = handle.emit("inbox://changed", ());
                    quiet = 0;
                } else {
                    quiet += 1;
                }
                last = Some(sig);
            }
        });
    if let Err(e) = spawned {
        log::error!("inbox watcher not started: {e}");
    }
}

#[tauri::command]
pub async fn inbox_pending(state: State<'_, AppState>) -> AppResult<Vec<InboxItem>> {
    pending(&state.db.conn()?)
}

#[tauri::command]
pub async fn inbox_finish(
    state: State<'_, AppState>,
    id: String,
    result_id: Option<String>,
    error: Option<String>,
) -> AppResult<()> {
    finish(
        &state.db.conn()?,
        &id,
        result_id.as_deref(),
        error.as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item<'a>(space: &'a str, kind: &'a str) -> NewItem<'a> {
        NewItem {
            space_id: space,
            kind,
            title: " T ",
            body: "b",
            target: None,
            use_as_source: false,
        }
    }

    #[test]
    fn nudges_when_one_item_finishes_as_another_arrives() {
        let (db, _d) = crate::db::test_db();
        let c = db.conn().unwrap();
        c.execute(
            "INSERT INTO spaces (id,name,created_at,updated_at) VALUES ('s','S',1,1)",
            [],
        )
        .unwrap();
        let a = queue(&c, item("s", "text")).unwrap();
        let before = signature(&c).unwrap();
        finish(&c, &a.id, Some("x"), None).unwrap();
        queue(&c, item("s", "text")).unwrap();
        let after = signature(&c).unwrap();
        assert_eq!(before.pending, after.pending);
        assert!(should_nudge(Some(before), after, 0));
        assert!(!should_nudge(Some(after), after, 0));
        assert!(should_nudge(Some(after), after, RENUDGE_POLLS));
        let done = Signature { pending: 0, ..after };
        assert!(!should_nudge(Some(done), done, RENUDGE_POLLS));
        assert!(!should_nudge(None, after, 0));
    }

    #[test]
    fn queues_lists_and_finishes() {
        let (db, _d) = crate::db::test_db();
        let c = db.conn().unwrap();
        c.execute(
            "INSERT INTO spaces (id,name,created_at,updated_at) VALUES ('s','S',1,1)",
            [],
        )
        .unwrap();
        let a = queue(&c, item("s", "text")).unwrap();
        let b = queue(&c, item("s", "note")).unwrap();
        assert_eq!(a.title, "T");
        assert_eq!(a.status, "pending");
        assert_eq!(pending(&c).unwrap().len(), 2);

        finish(&c, &a.id, Some("src1"), None).unwrap();
        finish(&c, &b.id, None, Some("broke")).unwrap();
        assert!(pending(&c).unwrap().is_empty());
        let a = get(&c, &a.id).unwrap().unwrap();
        assert_eq!(
            (a.status.as_str(), a.result_id.as_deref(), a.body.as_str()),
            ("done", Some("src1"), "")
        );
        assert_eq!(
            get(&c, &b.id).unwrap().unwrap().error.as_deref(),
            Some("broke")
        );
        assert!(finish(&c, "nope", None, None).is_err());
    }

    #[test]
    fn rejects_bad_items_and_prunes_old_ones() {
        let (db, _d) = crate::db::test_db();
        let c = db.conn().unwrap();
        c.execute(
            "INSERT INTO spaces (id,name,created_at,updated_at) VALUES ('s','S',1,1)",
            [],
        )
        .unwrap();
        assert!(queue(&c, item("s", "video")).is_err());
        assert!(queue(&c, item("missing", "text")).is_err());
        let long = "x".repeat(MAX_TITLE + 1);
        assert!(queue(
            &c,
            NewItem {
                title: &long,
                ..item("s", "text")
            }
        )
        .is_err());

        let old = queue(&c, item("s", "text")).unwrap();
        finish(&c, &old.id, Some("x"), None).unwrap();
        c.execute("UPDATE inbox SET updated_at = 0 WHERE id = ?1", [&old.id])
            .unwrap();
        pending(&c).unwrap();
        assert!(get(&c, &old.id).unwrap().is_none());
    }
}
