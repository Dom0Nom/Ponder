//! Notes (Markdown, per space), the auto glossary cache and the reading-level / translation cache.
//!
//! A note with `use_as_source` set keeps one source row in sync: it is created on the first save with text,
//! its text and title are replaced (and re-indexed) on every later save, and it is removed when the toggle
//! goes off, the body is emptied or the note is deleted.
use crate::db::{new_id, now_ms};
use crate::error::{invalid_key, AppResult};
use crate::ingest::Ingest;
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    #[serde(default)]
    pub id: String,
    pub space_id: String,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub use_as_source: bool,
    #[serde(default)]
    pub source_id: Option<String>,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

const COLS: &str = "id, space_id, title, body, use_as_source, source_id, created_at, updated_at";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Note> {
    Ok(Note {
        id: r.get(0)?,
        space_id: r.get(1)?,
        title: r.get(2)?,
        body: r.get(3)?,
        use_as_source: r.get::<_, i64>(4)? != 0,
        source_id: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
    })
}

pub fn list(c: &Connection, space_id: &str) -> AppResult<Vec<Note>> {
    let mut st = c.prepare(&format!(
        "SELECT {COLS} FROM notes WHERE space_id = ?1 ORDER BY updated_at DESC"
    ))?;
    let out = st.query_map([space_id], row)?.collect::<Result<_, _>>()?;
    Ok(out)
}

pub fn get(c: &Connection, id: &str) -> AppResult<Option<Note>> {
    Ok(c.query_row(
        &format!("SELECT {COLS} FROM notes WHERE id = ?1"),
        [id],
        row,
    )
    .optional()?)
}

fn clean_title(t: &str) -> String {
    let t = t.trim();
    if t.is_empty() {
        "Untitled".into()
    } else {
        t.chars().take(200).collect()
    }
}

/// Inserts or updates the note row only. Returns the stored note.
pub fn save_row(c: &Connection, n: &Note) -> AppResult<Note> {
    let now = now_ms();
    let title = clean_title(&n.title);
    match get(c, &n.id)? {
        Some(cur) if !n.id.is_empty() => {
            c.execute(
                "UPDATE notes SET title=?2, body=?3, use_as_source=?4, updated_at=?5 WHERE id=?1",
                params![
                    cur.id,
                    title,
                    n.body,
                    n.use_as_source as i64,
                    now.max(cur.updated_at + 1)
                ],
            )?;
            Ok(get(c, &cur.id)?.expect("just updated"))
        }
        _ => {
            let id = if n.id.is_empty() {
                new_id()
            } else {
                n.id.clone()
            };
            c.execute(
                &format!("INSERT INTO notes ({COLS}) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?6)"),
                params![id, n.space_id, title, n.body, n.use_as_source as i64, now],
            )?;
            Ok(get(c, &id)?.expect("just inserted"))
        }
    }
}

fn set_source_id(c: &Connection, id: &str, source_id: Option<&str>) -> AppResult<()> {
    c.execute(
        "UPDATE notes SET source_id=?2 WHERE id=?1",
        params![id, source_id],
    )?;
    Ok(())
}

/// Brings the linked source in line with the note.
fn sync_source(c: &Connection, ingest: &Ingest, note: &Note) -> AppResult<()> {
    let want = note.use_as_source && !note.body.trim().is_empty();
    match (&note.source_id, want) {
        (Some(sid), true) => {
            if let Ok(src) = crate::db::models::get_source(c, sid) {
                let stored: Option<String> = c
                    .query_row(
                        "SELECT text FROM source_texts WHERE source_id = ?1",
                        [sid],
                        |r| r.get(0),
                    )
                    .optional()?;
                let unchanged = src.title == note.title
                    && stored.as_deref()
                        == Some(crate::ingest::extract::normalize_newlines(&note.body).as_str());
                if !unchanged {
                    ingest.replace_text(sid, &note.title, &note.body)?;
                }
                return Ok(());
            }
            let src = ingest.import_text(
                &note.space_id,
                &note.title,
                &note.body,
                "markdown",
                Some(&format!("note:{}", note.id)),
            )?;
            set_source_id(c, &note.id, Some(&src.id))
        }
        (None, true) => {
            let src = ingest.import_text(
                &note.space_id,
                &note.title,
                &note.body,
                "markdown",
                Some(&format!("note:{}", note.id)),
            )?;
            set_source_id(c, &note.id, Some(&src.id))
        }
        (Some(sid), false) => {
            crate::db::models::delete_source(c, sid)?;
            set_source_id(c, &note.id, None)
        }
        (None, false) => Ok(()),
    }
}

#[cfg(test)]
pub fn save(c: &Connection, ingest: &Ingest, n: &Note) -> AppResult<Note> {
    save_with(c, ingest, n, true)
}

/// With `sync` false only the note row is written; the linked source catches up on the next synced save.
pub fn save_with(c: &Connection, ingest: &Ingest, n: &Note, sync: bool) -> AppResult<Note> {
    if n.space_id.is_empty() {
        return Err(invalid_key("noteNeedsSpace", "A note needs a space"));
    }
    let saved = save_row(c, n)?;
    if sync {
        // two syncing saves of a new note must not both create a source
        static SYNC: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _guard = SYNC.lock().unwrap_or_else(|e| e.into_inner());
        let fresh = get(c, &saved.id)?.unwrap_or(saved.clone());
        sync_source(c, ingest, &fresh)?;
    }
    Ok(get(c, &saved.id)?.expect("saved"))
}

pub fn delete(c: &Connection, id: &str) -> AppResult<()> {
    if let Some(n) = get(c, id)? {
        if let Some(sid) = n.source_id {
            crate::db::models::delete_source(c, &sid)?;
        }
    }
    c.execute("DELETE FROM notes WHERE id = ?1", [id])?;
    c.execute("DELETE FROM glossaries WHERE subject_id = ?1", [id])?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Glossary {
    pub subject_id: String,
    pub text_hash: String,
    pub entries: serde_json::Value,
    #[serde(default)]
    pub created_at: i64,
}

pub fn glossary_load(c: &Connection, subject_id: &str) -> AppResult<Option<Glossary>> {
    Ok(c.query_row(
        "SELECT subject_id, text_hash, entries, created_at FROM glossaries WHERE subject_id = ?1",
        [subject_id],
        |r| {
            let e: String = r.get(2)?;
            Ok(Glossary {
                subject_id: r.get(0)?,
                text_hash: r.get(1)?,
                entries: serde_json::from_str(&e).unwrap_or(serde_json::Value::Array(vec![])),
                created_at: r.get(3)?,
            })
        },
    )
    .optional()?)
}

pub fn glossary_store(c: &Connection, g: &Glossary) -> AppResult<Glossary> {
    let now = now_ms();
    c.execute(
        "INSERT OR REPLACE INTO glossaries (subject_id, text_hash, entries, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![g.subject_id, g.text_hash, g.entries.to_string(), now],
    )?;
    Ok(Glossary {
        created_at: now,
        ..g.clone()
    })
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Rewrite {
    pub source_id: String,
    pub kind: String,
    pub start: i64,
    pub end: i64,
    pub text_hash: String,
    pub text: String,
}

pub fn rewrites(c: &Connection, source_id: &str, kind: &str) -> AppResult<Vec<Rewrite>> {
    let mut st = c.prepare(
        "SELECT source_id, kind, start_offset, end_offset, text_hash, text FROM passage_rewrites
         WHERE source_id = ?1 AND kind = ?2 ORDER BY start_offset",
    )?;
    let out = st
        .query_map(params![source_id, kind], |r| {
            Ok(Rewrite {
                source_id: r.get(0)?,
                kind: r.get(1)?,
                start: r.get(2)?,
                end: r.get(3)?,
                text_hash: r.get(4)?,
                text: r.get(5)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(out)
}

pub fn rewrite_store(c: &Connection, w: &Rewrite) -> AppResult<()> {
    c.execute(
        "INSERT OR REPLACE INTO passage_rewrites (source_id, kind, start_offset, end_offset, text_hash, text, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![w.source_id, w.kind, w.start, w.end, w.text_hash, w.text, now_ms()],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn notes_list(state: State<'_, AppState>, space_id: String) -> AppResult<Vec<Note>> {
    list(&state.db.conn()?, &space_id)
}

#[tauri::command]
pub async fn note_get(state: State<'_, AppState>, id: String) -> AppResult<Option<Note>> {
    get(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn note_save(
    state: State<'_, AppState>,
    ingest: State<'_, Ingest>,
    note: Note,
    sync: Option<bool>,
) -> AppResult<Note> {
    save_with(&state.db.conn()?, &ingest, &note, sync.unwrap_or(true))
}

#[tauri::command]
pub async fn note_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    delete(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn glossary_get(
    state: State<'_, AppState>,
    subject_id: String,
) -> AppResult<Option<Glossary>> {
    glossary_load(&state.db.conn()?, &subject_id)
}

#[tauri::command]
pub async fn glossary_save(state: State<'_, AppState>, glossary: Glossary) -> AppResult<Glossary> {
    glossary_store(&state.db.conn()?, &glossary)
}

#[tauri::command]
pub async fn rewrites_list(
    state: State<'_, AppState>,
    source_id: String,
    kind: String,
) -> AppResult<Vec<Rewrite>> {
    rewrites(&state.db.conn()?, &source_id, &kind)
}

#[tauri::command]
pub async fn rewrite_save(state: State<'_, AppState>, rewrite: Rewrite) -> AppResult<()> {
    rewrite_store(&state.db.conn()?, &rewrite)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models;
    use crate::ingest::embed::FakeEmbedder;
    use crate::ingest::tests::{setup, wait_status};
    use std::sync::Arc;

    fn note(space: &str, title: &str, body: &str, src: bool) -> Note {
        Note {
            id: String::new(),
            space_id: space.into(),
            title: title.into(),
            body: body.into(),
            use_as_source: src,
            source_id: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn save_list_rename_delete() {
        let (ing, db, _d, _e, space) = setup(None);
        let c = db.conn().unwrap();
        let a = save(&c, &ing, &note(&space, "  ", "hello [[B]]", false)).unwrap();
        assert_eq!(a.title, "Untitled");
        assert!(a.source_id.is_none());
        let renamed = save(
            &c,
            &ing,
            &Note {
                title: "A".into(),
                body: "changed".into(),
                ..a.clone()
            },
        )
        .unwrap();
        assert_eq!(renamed.created_at, a.created_at);
        assert!(renamed.updated_at > a.updated_at);
        assert_eq!(list(&c, &space).unwrap(), vec![renamed.clone()]);
        delete(&c, &a.id).unwrap();
        assert!(list(&c, &space).unwrap().is_empty());
    }

    #[test]
    fn use_as_source_keeps_one_source_in_sync() {
        let (ing, db, _d, _e, space) = setup(Some(Arc::new(FakeEmbedder)));
        let c = db.conn().unwrap();
        let n = save(
            &c,
            &ing,
            &note(&space, "Cells", "Mitochondria make ATP.", true),
        )
        .unwrap();
        let sid = n.source_id.clone().expect("source created");
        wait_status(&db, &sid, "ready");
        assert_eq!(
            models::get_source_text(&c, &sid).unwrap().text,
            "Mitochondria make ATP."
        );

        let n2 = save(
            &c,
            &ing,
            &Note {
                title: "Cells 2".into(),
                body: "The nucleus holds DNA.".into(),
                ..n.clone()
            },
        )
        .unwrap();
        assert_eq!(n2.source_id.as_deref(), Some(sid.as_str()));
        let s = wait_status(&db, &sid, "ready");
        assert_eq!(s.title, "Cells 2");
        assert_eq!(
            models::get_source_text(&c, &sid).unwrap().text,
            "The nucleus holds DNA."
        );
        let chunks: i64 = c
            .query_row(
                "SELECT count(*) FROM chunks WHERE source_id=?1 AND text LIKE '%Mitochondria%'",
                [&sid],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(chunks, 0);

        let draft = save_with(
            &c,
            &ing,
            &Note {
                body: "The nucleus holds DNA and RNA.".into(),
                ..n2.clone()
            },
            false,
        )
        .unwrap();
        assert_eq!(models::get_source(&c, &sid).unwrap().status, "ready");
        assert_eq!(
            models::get_source_text(&c, &sid).unwrap().text,
            "The nucleus holds DNA."
        );
        let synced = save(&c, &ing, &draft).unwrap();
        wait_status(&db, &sid, "ready");
        assert_eq!(
            models::get_source_text(&c, &sid).unwrap().text,
            "The nucleus holds DNA and RNA."
        );
        c.execute("UPDATE sources SET summary='kept' WHERE id=?1", [&sid])
            .unwrap();
        save(&c, &ing, &synced).unwrap();
        assert_eq!(
            models::get_source(&c, &sid).unwrap().summary.as_deref(),
            Some("kept")
        );

        let off = save(
            &c,
            &ing,
            &Note {
                use_as_source: false,
                ..synced.clone()
            },
        )
        .unwrap();
        assert!(off.source_id.is_none());
        assert!(models::get_source(&c, &sid).is_err());

        let on = save(
            &c,
            &ing,
            &Note {
                use_as_source: true,
                ..off
            },
        )
        .unwrap();
        let sid2 = on.source_id.clone().unwrap();
        assert_ne!(sid2, sid);
        delete(&c, &on.id).unwrap();
        assert!(models::get_source(&c, &sid2).is_err());
    }

    #[test]
    fn empty_body_drops_the_source() {
        let (ing, db, _d, _e, space) = setup(None);
        let c = db.conn().unwrap();
        let n = save(&c, &ing, &note(&space, "T", "text", true)).unwrap();
        assert!(n.source_id.is_some());
        let e = save(
            &c,
            &ing,
            &Note {
                body: "  ".into(),
                ..n
            },
        )
        .unwrap();
        assert!(e.source_id.is_none() && e.use_as_source);
    }

    #[test]
    fn glossary_and_rewrite_caches() {
        let (ing, db, _d, _e, space) = setup(None);
        let c = db.conn().unwrap();
        assert!(glossary_load(&c, "x").unwrap().is_none());
        let g = Glossary {
            subject_id: "x".into(),
            text_hash: "h1".into(),
            entries: serde_json::json!([{"term": "ATP", "definition": "Energy carrier."}]),
            created_at: 0,
        };
        glossary_store(&c, &g).unwrap();
        glossary_store(
            &c,
            &Glossary {
                text_hash: "h2".into(),
                ..g.clone()
            },
        )
        .unwrap();
        let back = glossary_load(&c, "x").unwrap().unwrap();
        assert_eq!(back.text_hash, "h2");
        assert_eq!(back.entries[0]["term"], "ATP");

        let src = ing
            .import_text(&space, "S", "Some text here.", "text", None)
            .unwrap();
        let w = Rewrite {
            source_id: src.id.clone(),
            kind: "level:simpler".into(),
            start: 0,
            end: 15,
            text_hash: "a".into(),
            text: "Easy.".into(),
        };
        rewrite_store(&c, &w).unwrap();
        rewrite_store(
            &c,
            &Rewrite {
                text: "Easier.".into(),
                ..w.clone()
            },
        )
        .unwrap();
        rewrite_store(
            &c,
            &Rewrite {
                kind: "lang:German".into(),
                text: "Einfach.".into(),
                ..w.clone()
            },
        )
        .unwrap();
        let got = rewrites(&c, &src.id, "level:simpler").unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].text, "Easier.");
        assert_eq!(
            rewrites(&c, &src.id, "lang:German").unwrap()[0].text,
            "Einfach."
        );
    }
}
