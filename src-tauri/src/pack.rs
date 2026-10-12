//! Study packs (`.ponderpack`): one space with its sources, notes, cards and Studio outputs as a zip.
//! Rows are stored as JSON objects keyed by column name. Import always creates a new space with new ids;
//! the ingest queue then rebuilds chunks and embeddings from each source's text.
use crate::db::{models, new_id, now_ms};
use crate::error::{invalid, AppError, AppResult};
use crate::ingest::Ingest;
use crate::AppState;
use rusqlite::types::{Value as Sql, ValueRef};
use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

pub const EXTENSION: &str = "ponderpack";
const FORMAT: i64 = 1;
const MANIFEST: &str = "manifest.json";
const MAX_JSON_BYTES: u64 = 128 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 200 * 1024 * 1024;
const FILE_KINDS: [&str; 5] = ["pdf", "epub", "docx", "markdown", "text"];

type Row = Map<String, Value>;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PackCounts {
    pub sources: usize,
    pub chunks: usize,
    pub notes: usize,
    pub cards: usize,
    pub outputs: usize,
    pub files: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format: i64,
    app: String,
    app_version: String,
    schema_version: i64,
    created_at: i64,
    space_name: String,
    counts: PackCounts,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PackExport {
    pub path: String,
    pub counts: PackCounts,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PackImport {
    pub space_id: String,
    pub name: String,
    pub counts: PackCounts,
    pub source_ids: Vec<String>,
}

fn zip_err(e: zip::result::ZipError) -> AppError {
    AppError::Other(format!("zip error: {e}"))
}

fn dump(c: &Connection, sql: &str, id: &str) -> AppResult<Vec<Row>> {
    let mut st = c.prepare(sql)?;
    let names: Vec<String> = st.column_names().into_iter().map(String::from).collect();
    let mut rows = st.query([id])?;
    let mut out = vec![];
    while let Some(r) = rows.next()? {
        let mut m = Row::new();
        for (i, n) in names.iter().enumerate() {
            let v = match r.get_ref(i)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => Value::from(n),
                ValueRef::Real(f) => Value::from(f),
                ValueRef::Text(t) => Value::from(String::from_utf8_lossy(t).into_owned()),
                ValueRef::Blob(_) => return Err(AppError::Other(format!("Column {n} holds binary data."))),
            };
            m.insert(n.clone(), v);
        }
        out.push(m);
    }
    Ok(out)
}

fn str_of<'a>(r: &'a Row, k: &str) -> Option<&'a str> {
    r.get(k).and_then(Value::as_str)
}

fn safe_file_name(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_alphanumeric() || " .-_()".contains(c) { c } else { '-' }).collect();
    let s = s.trim().trim_start_matches('.').to_string();
    if s.is_empty() {
        "file".into()
    } else {
        s.chars().take(120).collect()
    }
}

/// Retrying a source re-reads a local `origin`, so a pack must not bring its own paths.
fn local_path_like(o: &str) -> bool {
    let b = o.as_bytes();
    o.starts_with('/') || o.starts_with('~') || o.starts_with('\\') || o.starts_with("file:") || (b.len() > 2 && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/'))
}

fn plain_name(n: &str) -> bool {
    !n.is_empty() && !n.contains(['/', '\\']) && !n.contains("..")
}

fn put_json(zip: &mut zip::ZipWriter<File>, name: &str, v: &impl Serialize) -> AppResult<()> {
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
    zip.start_file(name, opts).map_err(zip_err)?;
    zip.write_all(&serde_json::to_vec(v)?)?;
    Ok(())
}

fn put_file(zip: &mut zip::ZipWriter<File>, name: &str, path: &Path) -> AppResult<()> {
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored).large_file(true);
    zip.start_file(name, opts).map_err(zip_err)?;
    std::io::copy(&mut File::open(path)?, zip)?;
    Ok(())
}

/// The file a source was read from, if it is still on disk and small enough.
fn source_file(src: &Row) -> Option<PathBuf> {
    let kind = str_of(src, "kind")?;
    let local = str_of(src, "local_path").map(PathBuf::from);
    let origin = str_of(src, "origin").map(PathBuf::from).filter(|p| FILE_KINDS.contains(&kind) && p.is_absolute());
    local
        .into_iter()
        .chain(origin)
        .find(|p| fs::metadata(p).map(|m| m.is_file() && m.len() <= MAX_FILE_BYTES).unwrap_or(false))
}

fn image_names(cards: &[Row]) -> Vec<String> {
    let mut seen = HashSet::new();
    cards
        .iter()
        .filter_map(|c| str_of(c, "data"))
        .filter_map(|d| serde_json::from_str::<Value>(d).ok())
        .filter_map(|v| v.get("image").and_then(Value::as_str).map(String::from))
        .filter(|n| plain_name(n) && seen.insert(n.clone()))
        .collect()
}

/// Writes `dest` (a `.ponderpack` file) for one space. Written under a temp name and renamed when complete.
pub fn export_pack(c: &Connection, data_dir: &Path, space_id: &str, dest: &Path, app_version: &str) -> AppResult<PackCounts> {
    let space = dump(c, "SELECT * FROM spaces WHERE id=?1", space_id)?.pop().ok_or_else(|| AppError::NotFound("Space".into()))?;
    let sources = dump(c, "SELECT * FROM sources WHERE space_id=?1 ORDER BY created_at, id", space_id)?;
    let texts = dump(c, "SELECT t.* FROM source_texts t JOIN sources s ON s.id=t.source_id WHERE s.space_id=?1 ORDER BY t.source_id", space_id)?;
    let chunks = dump(c, "SELECT * FROM chunks WHERE space_id=?1 ORDER BY source_id, ord", space_id)?;
    let notes = dump(c, "SELECT * FROM notes WHERE space_id=?1 ORDER BY created_at, id", space_id)?;
    let cards = dump(c, "SELECT * FROM cards WHERE space_id=?1 ORDER BY created_at, id", space_id)?;
    let outputs = dump(c, "SELECT * FROM studio_outputs WHERE space_id=?1 ORDER BY created_at, id", space_id)?;
    let schema_version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;

    let tmp = dest.with_extension(format!("{EXTENSION}.tmp"));
    let result = (|| -> AppResult<PackCounts> {
        let mut zip = zip::ZipWriter::new(File::create(&tmp)?);
        let mut files = 0;
        for s in &sources {
            let (Some(id), Some(path)) = (str_of(s, "id"), source_file(s)) else { continue };
            let name = safe_file_name(&path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
            put_file(&mut zip, &format!("files/sources/{id}/{name}"), &path)?;
            files += 1;
        }
        for name in image_names(&cards) {
            let p = data_dir.join("images").join(&name);
            if p.is_file() {
                put_file(&mut zip, &format!("files/images/{name}"), &p)?;
                files += 1;
            }
        }
        let counts = PackCounts {
            sources: sources.len(),
            chunks: chunks.len(),
            notes: notes.len(),
            cards: cards.len(),
            outputs: outputs.len(),
            files,
        };
        let manifest = Manifest {
            format: FORMAT,
            app: "ponder".into(),
            app_version: app_version.into(),
            schema_version,
            created_at: now_ms(),
            space_name: str_of(&space, "name").unwrap_or("").into(),
            counts: counts.clone(),
        };
        put_json(&mut zip, MANIFEST, &manifest)?;
        put_json(&mut zip, "data/space.json", &space)?;
        put_json(&mut zip, "data/sources.json", &sources)?;
        put_json(&mut zip, "data/source_texts.json", &texts)?;
        put_json(&mut zip, "data/chunks.json", &chunks)?;
        put_json(&mut zip, "data/notes.json", &notes)?;
        put_json(&mut zip, "data/cards.json", &cards)?;
        put_json(&mut zip, "data/studio_outputs.json", &outputs)?;
        zip.finish().map_err(zip_err)?;
        fs::rename(&tmp, dest)?;
        Ok(counts)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn read_limited(r: &mut impl Read, limit: u64, what: &str) -> AppResult<Vec<u8>> {
    let mut buf = vec![];
    r.take(limit + 1).read_to_end(&mut buf)?;
    if buf.len() as u64 > limit {
        return Err(invalid(format!("{what} is too large.")));
    }
    Ok(buf)
}

fn read_rows(zip: &mut zip::ZipArchive<File>, name: &str) -> AppResult<Vec<Row>> {
    let mut f = zip.by_name(name).map_err(|_| invalid(format!("This isn't a valid study pack ({name} is missing).")))?;
    let bytes = read_limited(&mut f, MAX_JSON_BYTES, name)?;
    serde_json::from_slice(&bytes).map_err(|e| invalid(format!("This study pack is damaged ({name}: {e}).")))
}

fn table_columns(c: &Connection, table: &str) -> AppResult<HashSet<String>> {
    let mut st = c.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = st.query_map([], |r| r.get::<_, String>(1))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn sql_value(v: &Value) -> Option<Sql> {
    Some(match v {
        Value::Null => Sql::Null,
        Value::Bool(b) => Sql::Integer(*b as i64),
        Value::Number(n) => n.as_i64().map(Sql::Integer).or_else(|| n.as_f64().map(Sql::Real))?,
        Value::String(s) => Sql::Text(s.clone()),
        _ => return None,
    })
}

/// Inserts a row, keeping only the columns this database has for the table.
fn insert_row(tx: &Transaction, table: &str, cols: &HashSet<String>, row: &Row) -> AppResult<()> {
    let mut names = vec![];
    let mut values = vec![];
    for (k, v) in row {
        if !cols.contains(k) {
            continue;
        }
        let sv = sql_value(v).ok_or_else(|| invalid(format!("This study pack is damaged ({table}.{k}).")))?;
        names.push(k.as_str());
        values.push(sv);
    }
    let marks = (1..=names.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(",");
    tx.execute(
        &format!("INSERT INTO {table} ({}) VALUES ({marks})", names.join(",")),
        rusqlite::params_from_iter(values),
    )?;
    Ok(())
}

fn set(row: &mut Row, k: &str, v: impl Into<Value>) {
    row.insert(k.into(), v.into());
}

fn unique_name(c: &Connection, base: &str) -> AppResult<String> {
    let taken: HashSet<String> = models::list_spaces(c)?.into_iter().map(|s| s.name.to_lowercase()).collect();
    let base = if base.trim().is_empty() { "Study pack" } else { base.trim() };
    if !taken.contains(&base.to_lowercase()) {
        return Ok(base.to_string());
    }
    let first = format!("{base} (imported)");
    if !taken.contains(&first.to_lowercase()) {
        return Ok(first);
    }
    Ok((2..).map(|n| format!("{base} (imported {n})")).find(|n| !taken.contains(&n.to_lowercase())).unwrap_or(first))
}

/// Creates a new space from the pack. Sources come in as `processing`; the caller enqueues them for indexing.
pub fn import_pack(c: &mut Connection, data_dir: &Path, pack: &Path) -> AppResult<PackImport> {
    let mut zip = zip::ZipArchive::new(File::open(pack)?).map_err(|_| invalid("This isn't a Ponder study pack."))?;
    let manifest: Manifest = {
        let mut f = zip.by_name(MANIFEST).map_err(|_| invalid("This isn't a Ponder study pack."))?;
        serde_json::from_slice(&read_limited(&mut f, 1 << 20, "The manifest")?)
            .map_err(|_| invalid("This isn't a Ponder study pack."))?
    };
    if manifest.app != "ponder" {
        return Err(invalid("This isn't a Ponder study pack."));
    }
    if manifest.format > FORMAT {
        return Err(invalid("This study pack was made by a newer version of Ponder. Update the app to open it."));
    }
    let mut space: Row = {
        let mut f = zip.by_name("data/space.json").map_err(|_| invalid("This isn't a valid study pack (data/space.json is missing)."))?;
        serde_json::from_slice(&read_limited(&mut f, MAX_JSON_BYTES, "data/space.json")?)
            .map_err(|_| invalid("This study pack is damaged (data/space.json)."))?
    };
    let sources = read_rows(&mut zip, "data/sources.json")?;
    let texts = read_rows(&mut zip, "data/source_texts.json")?;
    let chunks = read_rows(&mut zip, "data/chunks.json")?;
    let notes = read_rows(&mut zip, "data/notes.json")?;
    let cards = read_rows(&mut zip, "data/cards.json")?;
    let outputs = read_rows(&mut zip, "data/studio_outputs.json")?;

    let new_space = new_id();
    let now = now_ms();
    let name = unique_name(c, str_of(&space, "name").unwrap_or(""))?;
    set(&mut space, "id", new_space.clone());
    set(&mut space, "name", name.clone());
    set(&mut space, "last_opened_at", Value::Null);
    set(&mut space, "created_at", now);
    set(&mut space, "updated_at", now);

    let mut source_map: HashMap<String, String> = HashMap::new();
    for s in &sources {
        if let Some(old) = str_of(s, "id") {
            source_map.insert(old.to_string(), new_id());
        }
    }

    let mut written: Vec<PathBuf> = vec![];
    let result = (|| -> AppResult<PackCounts> {
        let tx = c.transaction()?;
        let cols = |t: &str| table_columns(&tx, t);
        let (c_space, c_src, c_txt, c_chunk, c_note, c_card, c_out) =
            (cols("spaces")?, cols("sources")?, cols("source_texts")?, cols("chunks")?, cols("notes")?, cols("cards")?, cols("studio_outputs")?);
        insert_row(&tx, "spaces", &c_space, &space)?;

        let mut counts = PackCounts::default();
        let mut have_text: HashSet<String> = HashSet::new();
        for t in &texts {
            if let Some(new) = str_of(t, "source_id").and_then(|o| source_map.get(o)) {
                have_text.insert(new.clone());
            }
        }
        let mut file_plan: Vec<(String, String, String, PathBuf)> = vec![];
        for s in &sources {
            let Some(old) = str_of(s, "id") else { continue };
            let new = source_map[old].clone();
            let prefix = format!("files/sources/{old}/");
            let entry = zip.file_names().find(|n| n.starts_with(&prefix) && plain_name(&n[prefix.len()..])).map(String::from);
            let mut s = s.clone();
            set(&mut s, "id", new.clone());
            set(&mut s, "space_id", new_space.clone());
            set(&mut s, "progress", 0.0);
            s.remove("local_path");
            if str_of(&s, "origin").is_some_and(local_path_like) {
                set(&mut s, "origin", Value::Null);
            }
            if let Some(e) = &entry {
                let file = e[prefix.len()..].to_string();
                let dest = data_dir.join("imports").join(&new).join(&file);
                file_plan.push((e.clone(), file, new.clone(), dest));
            }
            if have_text.contains(&new) || entry.is_some() {
                set(&mut s, "status", "processing");
                set(&mut s, "error", Value::Null);
            } else {
                set(&mut s, "status", "error");
                set(&mut s, "error", "The original text of this source is missing from the study pack.");
            }
            insert_row(&tx, "sources", &c_src, &s)?;
            counts.sources += 1;
        }
        for t in &texts {
            let Some(new) = str_of(t, "source_id").and_then(|o| source_map.get(o)) else { continue };
            let mut t = t.clone();
            set(&mut t, "source_id", new.clone());
            insert_row(&tx, "source_texts", &c_txt, &t)?;
        }
        for (entry, file, new, dest) in file_plan {
            fs::create_dir_all(dest.parent().unwrap_or(data_dir))?;
            let mut f = zip.by_name(&entry).map_err(zip_err)?;
            let bytes = read_limited(&mut f, MAX_FILE_BYTES, &file)?;
            fs::write(&dest, bytes)?;
            written.push(dest.clone());
            tx.execute("UPDATE sources SET local_path=?2 WHERE id=?1", params![new, dest.to_string_lossy()])?;
            counts.files += 1;
        }
        for ch in &chunks {
            let Some(new) = str_of(ch, "source_id").and_then(|o| source_map.get(o)) else { continue };
            let mut ch = ch.clone();
            ch.remove("id");
            set(&mut ch, "source_id", new.clone());
            set(&mut ch, "space_id", new_space.clone());
            insert_row(&tx, "chunks", &c_chunk, &ch)?;
            counts.chunks += 1;
        }
        let remap_source = |r: &mut Row| {
            let mapped = str_of(r, "source_id").and_then(|o| source_map.get(o)).cloned();
            set(r, "source_id", mapped.map(Value::from).unwrap_or(Value::Null));
        };
        for n in &notes {
            let mut n = n.clone();
            set(&mut n, "id", new_id());
            set(&mut n, "space_id", new_space.clone());
            remap_source(&mut n);
            insert_row(&tx, "notes", &c_note, &n)?;
            counts.notes += 1;
        }
        for card in &cards {
            let mut card = card.clone();
            let id = new_id();
            set(&mut card, "id", id.clone());
            set(&mut card, "space_id", new_space.clone());
            remap_source(&mut card);
            insert_row(&tx, "cards", &c_card, &card)?;
            tx.execute("INSERT INTO card_state (card_id, due, state) VALUES (?1, ?2, 0)", params![id, now])?;
            counts.cards += 1;
        }
        for o in &outputs {
            let mut o = o.clone();
            set(&mut o, "id", new_id());
            set(&mut o, "space_id", new_space.clone());
            insert_row(&tx, "studio_outputs", &c_out, &o)?;
            counts.outputs += 1;
        }
        for name in image_names(&cards) {
            let dest = data_dir.join("images").join(&name);
            if dest.exists() {
                continue;
            }
            let Ok(mut f) = zip.by_name(&format!("files/images/{name}")) else { continue };
            let bytes = read_limited(&mut f, MAX_FILE_BYTES, &name)?;
            fs::create_dir_all(data_dir.join("images"))?;
            fs::write(&dest, bytes)?;
            written.push(dest);
            counts.files += 1;
        }
        tx.commit()?;
        Ok(counts)
    })();
    match result {
        Ok(counts) => {
            let mut source_ids: Vec<String> = source_map.into_values().collect();
            source_ids.sort();
            Ok(PackImport { space_id: new_space, name, counts, source_ids })
        }
        Err(e) => {
            for p in written {
                let _ = fs::remove_file(&p);
                if let Some(dir) = p.parent().filter(|d| d.parent() == Some(data_dir.join("imports").as_path())) {
                    let _ = fs::remove_dir(dir);
                }
            }
            Err(match e {
                AppError::Db(db) => invalid(format!("This study pack couldn't be imported: {db}")),
                e => e,
            })
        }
    }
}

fn file_stem(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_alphanumeric() || " .-_()".contains(c) { c } else { '-' }).collect();
    let s = s.trim().trim_start_matches('.').to_string();
    if s.is_empty() {
        "study-pack".into()
    } else {
        s.chars().take(100).collect()
    }
}

/// Asks where to save, then writes the pack. The path never comes from the webview. None when cancelled.
#[tauri::command]
pub async fn pack_export(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    space_id: String,
) -> AppResult<Option<PackExport>> {
    let name = models::get_space(&state.db.conn()?, &space_id)?.name;
    let picked = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_file_name(format!("{}.{EXTENSION}", file_stem(&name)))
        .add_filter("Ponder study pack", &[EXTENSION])
        .blocking_save_file();
    let Some(path) = picked else { return Ok(None) };
    let mut path = path.into_path().map_err(|e| AppError::Other(e.to_string()))?;
    if path.extension().and_then(|e| e.to_str()) != Some(EXTENSION) {
        path.set_extension(EXTENSION);
    }
    let (db, dir, version, dest) = (state.db.clone(), state.data_dir.clone(), app.package_info().version.to_string(), path.clone());
    let counts = tauri::async_runtime::spawn_blocking(move || export_pack(&db.conn()?, &dir, &space_id, &dest, &version))
        .await
        .map_err(|e| AppError::Other(e.to_string()))??;
    Ok(Some(PackExport { path: path.to_string_lossy().into_owned(), counts }))
}

/// Asks which pack to open, creates a new space from it and queues its sources for indexing. None when cancelled.
#[tauri::command]
pub async fn pack_import(window: WebviewWindow, state: State<'_, AppState>, ingest: State<'_, Ingest>) -> AppResult<Option<PackImport>> {
    let picked = window
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("Ponder study pack", &[EXTENSION])
        .blocking_pick_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| AppError::Other(e.to_string()))?;
    let (db, dir) = (state.db.clone(), state.data_dir.clone());
    let res = tauri::async_runtime::spawn_blocking(move || import_pack(&mut db.conn()?, &dir, &path))
        .await
        .map_err(|e| AppError::Other(e.to_string()))??;
    for id in &res.source_ids {
        let c = state.db.conn()?;
        let status: String = c.query_row("SELECT status FROM sources WHERE id=?1", [id], |r| r.get(0))?;
        if status == "processing" {
            ingest.reindex(id)?;
        }
    }
    Ok(Some(res))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;

    #[test]
    fn local_origins_are_recognised() {
        for o in ["/Users/x/.ssh/id_rsa", "~/notes.txt", "C:\\Users\\x\\a.pdf", "c:/a.pdf", "file:///etc/passwd", "\\\\server\\share"] {
            assert!(local_path_like(o), "{o}");
        }
        for o in ["https://example.com/a", "note:abc", "screen-snip", "paste", ""] {
            assert!(!local_path_like(o), "{o}");
        }
    }

    fn count(c: &Connection, sql: &str) -> i64 {
        c.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn seed(c: &Connection, data: &Path) -> String {
        let sp = models::create_space(c, models::SpacePatch { name: Some("Biology".into()), ..Default::default() }).unwrap();
        let id = sp.id;
        c.execute("INSERT INTO sources (id,space_id,title,kind,origin,status,summary,char_count,chunk_count,created_at,updated_at) VALUES ('s1',?1,'Cells','text','paste','ready','About cells',20,2,1,1)", [&id]).unwrap();
        c.execute("INSERT INTO sources (id,space_id,title,kind,origin,status,created_at,updated_at) VALUES ('s2',?1,'Paper','pdf',?2,'ready',2,2)", params![id, data.join("paper.pdf").to_string_lossy()]).unwrap();
        c.execute("INSERT INTO sources (id,space_id,title,kind,status,created_at,updated_at) VALUES ('s3',?1,'Lost','pdf','error',3,3)", [&id]).unwrap();
        c.execute("INSERT INTO source_texts (source_id,text,pages) VALUES ('s1','Cells divide. Mitochondria make energy.','[[1,0]]')", []).unwrap();
        c.execute("INSERT INTO source_texts (source_id,text) VALUES ('s2','Paper text about enzymes')", []).unwrap();
        for (i, t) in ["Cells divide.", "Mitochondria make energy."].iter().enumerate() {
            c.execute("INSERT INTO chunks (source_id,space_id,ord,text,start_offset,end_offset,page) VALUES ('s1',?1,?2,?3,0,5,1)", params![id, i as i64, t]).unwrap();
        }
        c.execute("INSERT INTO notes (id,space_id,title,body,use_as_source,source_id,created_at,updated_at) VALUES ('n1',?1,'Osmosis','Water moves.',1,'s1',1,1)", [&id]).unwrap();
        c.execute("INSERT INTO cards (id,space_id,kind,front,back,data,source_id,created_at,updated_at) VALUES ('c1',?1,'basic','Q','A',NULL,'s1',1,1)", [&id]).unwrap();
        c.execute("INSERT INTO cards (id,space_id,kind,front,back,data,created_at,updated_at) VALUES ('c2',?1,'occlusion','img','',?2,1,1)", params![id, r#"{"image":"pic.png","masks":[]}"#]).unwrap();
        c.execute("INSERT INTO card_state (card_id,due,state,fsrs) VALUES ('c1',999,2,'{\"s\":1}')", []).unwrap();
        c.execute("INSERT INTO studio_outputs (id,space_id,kind,title,data,created_at,updated_at) VALUES ('o1',?1,'timeline','Cells','{\"events\":[]}',1,1)", [&id]).unwrap();
        c.execute("INSERT INTO study_plans (space_id,goal,exam_date,weekly_minutes,study_days,created_at,updated_at) VALUES (?1,'pass','2030-01-01',60,'[1]',1,1)", [&id]).unwrap();
        fs::create_dir_all(data.join("images")).unwrap();
        fs::write(data.join("images/pic.png"), b"png").unwrap();
        fs::write(data.join("paper.pdf"), b"%PDF-fake").unwrap();
        id
    }

    #[test]
    fn round_trip_makes_a_new_space_with_the_same_content() {
        let (db, _d) = test_db();
        let src_dir = tempfile::tempdir().unwrap();
        let id = {
            let c = db.conn().unwrap();
            seed(&c, src_dir.path())
        };
        let out = tempfile::tempdir().unwrap();
        let pack = out.path().join("bio.ponderpack");
        let counts = export_pack(&db.conn().unwrap(), src_dir.path(), &id, &pack, "9.9.9").unwrap();
        assert_eq!(counts, PackCounts { sources: 3, chunks: 2, notes: 1, cards: 2, outputs: 1, files: 2 });
        assert!(!out.path().join("bio.ponderpack.tmp").exists());

        let target = tempfile::tempdir().unwrap();
        let mut c = db.conn().unwrap();
        let res = import_pack(&mut c, target.path(), &pack).unwrap();
        assert_ne!(res.space_id, id);
        assert_eq!(res.name, "Biology (imported)");
        assert_eq!(res.counts, PackCounts { sources: 3, chunks: 2, notes: 1, cards: 2, outputs: 1, files: 2 });
        assert_eq!(res.source_ids.len(), 3);

        let sp = &res.space_id;
        assert_eq!(count(&c, &format!("SELECT count(*) FROM sources WHERE space_id='{sp}'")), 3);
        assert_eq!(count(&c, &format!("SELECT count(*) FROM chunks WHERE space_id='{sp}'")), 2);
        assert_eq!(count(&c, &format!("SELECT count(*) FROM notes WHERE space_id='{sp}'")), 1);
        assert_eq!(count(&c, &format!("SELECT count(*) FROM cards WHERE space_id='{sp}'")), 2);
        assert_eq!(count(&c, &format!("SELECT count(*) FROM studio_outputs WHERE space_id='{sp}'")), 1);
        assert_eq!(count(&c, &format!("SELECT count(*) FROM study_plans WHERE space_id='{sp}'")), 0);
        assert_eq!(count(&c, "SELECT count(*) FROM spaces"), 2);
        assert_eq!(count(&c, "SELECT count(*) FROM sources"), 6);
        assert_eq!(count(&c, &format!("SELECT count(*) FROM chunks_fts WHERE chunks_fts MATCH 'mitochondria' AND rowid IN (SELECT id FROM chunks WHERE space_id='{sp}')")), 1);

        let text: String = c.query_row(&format!("SELECT t.text FROM source_texts t JOIN sources s ON s.id=t.source_id WHERE s.space_id='{sp}' AND s.title='Cells'"), [], |r| r.get(0)).unwrap();
        assert_eq!(text, "Cells divide. Mitochondria make energy.");
        let pages: String = c.query_row(&format!("SELECT t.pages FROM source_texts t JOIN sources s ON s.id=t.source_id WHERE s.space_id='{sp}' AND s.title='Cells'"), [], |r| r.get(0)).unwrap();
        assert_eq!(pages, "[[1,0]]");

        let old: Vec<String> = ["s1", "s2", "s3", "n1", "c1", "c2", "o1"].iter().map(|s| s.to_string()).collect();
        for table in ["sources", "notes", "cards", "studio_outputs"] {
            let mut st = c.prepare(&format!("SELECT id FROM {table} WHERE space_id='{sp}'")).unwrap();
            let ids: Vec<String> = st.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
            assert!(ids.iter().all(|i| !old.contains(i)), "{table} kept an old id");
        }

        let (note_src, src_space): (String, String) = c.query_row(&format!("SELECT n.source_id, s.space_id FROM notes n JOIN sources s ON s.id=n.source_id WHERE n.space_id='{sp}'"), [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(src_space, *sp);
        assert!(res.source_ids.contains(&note_src));
        let basic_src: Option<String> = c.query_row(&format!("SELECT source_id FROM cards WHERE space_id='{sp}' AND kind='basic'"), [], |r| r.get(0)).unwrap();
        assert!(res.source_ids.contains(&basic_src.unwrap()));

        let (due, state, fsrs): (i64, i64, Option<String>) = c.query_row(&format!("SELECT st.due, st.state, st.fsrs FROM card_state st JOIN cards c ON c.id=st.card_id WHERE c.space_id='{sp}' AND c.kind='basic'"), [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert!(due > 999 && state == 0 && fsrs.is_none());

        let statuses: Vec<(String, String)> = {
            let mut st = c.prepare(&format!("SELECT title, status FROM sources WHERE space_id='{sp}' ORDER BY title")).unwrap();
            st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(|r| r.unwrap()).collect()
        };
        assert_eq!(statuses, [("Cells".into(), "processing".into()), ("Lost".into(), "error".into()), ("Paper".into(), "processing".into())]);

        let local: String = c.query_row(&format!("SELECT local_path FROM sources WHERE space_id='{sp}' AND title='Paper'"), [], |r| r.get(0)).unwrap();
        assert!(local.starts_with(target.path().join("imports").to_string_lossy().as_ref()));
        assert_eq!(fs::read(&local).unwrap(), b"%PDF-fake");
        assert_eq!(fs::read(target.path().join("images/pic.png")).unwrap(), b"png");

        let again = import_pack(&mut c, target.path(), &pack).unwrap();
        assert_eq!(again.name, "Biology (imported 2)");
        assert_eq!(count(&c, "SELECT count(*) FROM spaces"), 3);
        assert_eq!(count(&c, &format!("SELECT count(*) FROM sources WHERE space_id='{id}'")), 3);
    }

    #[test]
    fn rejects_bad_packs_and_changes_nothing() {
        let (db, _d) = test_db();
        let dir = tempfile::tempdir().unwrap();
        let mut c = db.conn().unwrap();

        let junk = dir.path().join("junk.ponderpack");
        fs::write(&junk, b"not a zip").unwrap();
        assert!(import_pack(&mut c, dir.path(), &junk).unwrap_err().to_string().contains("isn't a Ponder study pack"));

        let make = |name: &str, manifest: &str, data: bool, space: &str| {
            let p = dir.path().join(name);
            let mut zip = zip::ZipWriter::new(File::create(&p).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            zip.start_file(MANIFEST, o).unwrap();
            zip.write_all(manifest.as_bytes()).unwrap();
            if data {
                zip.start_file("data/space.json", o).unwrap();
                zip.write_all(space.as_bytes()).unwrap();
                for t in ["sources", "source_texts", "chunks", "notes", "cards", "studio_outputs"] {
                    zip.start_file(format!("data/{t}.json"), o).unwrap();
                    zip.write_all(b"[]").unwrap();
                }
            }
            zip.finish().unwrap();
            p
        };
        let head = |format: i64, app: &str| format!(r#"{{"format":{format},"app":"{app}","appVersion":"1","schemaVersion":1,"createdAt":1,"spaceName":"X","counts":{{"sources":0,"chunks":0,"notes":0,"cards":0,"outputs":0,"files":0}}}}"#);
        let newer = make("newer.ponderpack", &head(2, "ponder"), true, "{}");
        assert!(import_pack(&mut c, dir.path(), &newer).unwrap_err().to_string().contains("newer version"));
        let other = make("other.ponderpack", &head(1, "other"), true, "{}");
        assert!(import_pack(&mut c, dir.path(), &other).is_err());
        let nodata = make("nodata.ponderpack", &head(1, "ponder"), false, "{}");
        assert!(import_pack(&mut c, dir.path(), &nodata).unwrap_err().to_string().contains("missing"));
        assert_eq!(count(&c, "SELECT count(*) FROM spaces"), 0);

        let damaged = make("damaged.ponderpack", &head(1, "ponder"), true, r#"{"name":"X","icon":[1]}"#);
        assert!(import_pack(&mut c, dir.path(), &damaged).unwrap_err().to_string().contains("damaged"));
        assert_eq!(count(&c, "SELECT count(*) FROM spaces"), 0);
        let ok = make("ok.ponderpack", &head(1, "ponder"), true, r#"{"name":"X"}"#);
        assert_eq!(import_pack(&mut c, dir.path(), &ok).unwrap().name, "X");
        assert_eq!(count(&c, "SELECT count(*) FROM spaces"), 1);
    }

    #[test]
    fn exporting_a_missing_space_fails() {
        let (db, _d) = test_db();
        let dir = tempfile::tempdir().unwrap();
        let r = export_pack(&db.conn().unwrap(), dir.path(), "nope", &dir.path().join("x.ponderpack"), "1");
        assert!(r.is_err());
        assert!(!dir.path().join("x.ponderpack").exists());
    }
}
