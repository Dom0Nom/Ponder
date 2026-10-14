//! What the model reads: several searches in one call, exact source ranges (by chunk or page),
//! outlines per source, and per-thread conversation summaries.
use crate::db::{models, now_ms, Db};
use crate::error::{invalid, AppError, AppResult};
use crate::ingest::Ingest;
use crate::retrieval::{self, SearchHit};
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::State;

/// Longest text one `read_ranges` passage returns; the caller asks again for more.
const MAX_RANGE_CHARS: usize = 400_000;

// ---------- search ----------

/// Runs several searches with the query vectors embedded in one batch.
pub fn search_many(
    ingest: &Ingest,
    c: &Connection,
    space_id: &str,
    queries: &[String],
    limit: usize,
    source_ids: Option<&[String]>,
) -> AppResult<Vec<Vec<SearchHit>>> {
    let queries: Vec<String> = queries
        .iter()
        .map(|q| q.trim().to_string())
        .filter(|q| !q.is_empty())
        .take(8)
        .collect();
    if queries.is_empty() {
        return Ok(vec![]);
    }
    let vecs = match ingest.embedder.current() {
        Some(m) => match m.embed_queries(&queries) {
            Ok(v) => Some(v),
            Err(e) => {
                log::warn!("query embedding failed, using FTS only: {e}");
                None
            }
        },
        None => None,
    };
    let dims = retrieval::vec_dims(c).ok();
    let candidates = (limit * 3).max(retrieval::CANDIDATES);
    queries
        .iter()
        .enumerate()
        .map(|(i, q)| {
            let qv = vecs
                .as_ref()
                .and_then(|v| v.get(i))
                .filter(|v| Some(v.len()) == dims);
            retrieval::search_with(
                c,
                space_id,
                q,
                qv.map(|v| v.as_slice()),
                limit,
                candidates,
                source_ids,
            )
        })
        .collect()
}

#[tauri::command]
pub async fn search_many_chunks(
    ingest: State<'_, Ingest>,
    state: State<'_, AppState>,
    space_id: String,
    queries: Vec<String>,
    limit: Option<usize>,
    source_ids: Option<Vec<String>>,
) -> AppResult<Vec<Vec<SearchHit>>> {
    let ingest = ingest.inner().clone();
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let c = db.conn()?;
        search_many(
            &ingest,
            &c,
            &space_id,
            &queries,
            limit.unwrap_or(20).min(200),
            source_ids.as_deref(),
        )
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

// ---------- reading ranges ----------

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RangeRequest {
    pub source_id: String,
    /// "chunk" (ord numbers), "page" (page numbers) or "all"
    pub unit: String,
    #[serde(default)]
    pub from: i64,
    #[serde(default)]
    pub to: i64,
    pub max_chars: Option<usize>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceRange {
    pub source_id: String,
    pub source_title: String,
    /// chunk the range starts in, for citation links
    pub chunk_id: Option<i64>,
    pub ord_from: i64,
    pub ord_to: i64,
    /// UTF-16 offsets into the source text
    pub start: i64,
    pub end: i64,
    pub page_from: Option<i64>,
    pub page_to: Option<i64>,
    pub heading: Option<String>,
    pub text: String,
    pub truncated: bool,
    pub total_chunks: i64,
    pub total_pages: Option<i64>,
    /// (page, UTF-16 offset) of each page that starts inside the range
    pub page_starts: Vec<(i64, i64)>,
    /// (chunk id, UTF-16 start offset) of each chunk inside the range, in order
    pub chunk_starts: Vec<(i64, i64)>,
}

struct ChunkRow {
    id: i64,
    ord: i64,
    start: i64,
    end: i64,
    page: Option<i64>,
    heading: Option<String>,
}

fn chunk_rows(c: &Connection, source_id: &str) -> AppResult<Vec<ChunkRow>> {
    let mut st = c.prepare_cached(
        "SELECT id, ord, start_offset, end_offset, page, heading FROM chunks WHERE source_id = ?1 ORDER BY ord",
    )?;
    let rows = st.query_map([source_id], |r| {
        Ok(ChunkRow {
            id: r.get(0)?,
            ord: r.get(1)?,
            start: r.get(2)?,
            end: r.get(3)?,
            page: r.get(4)?,
            heading: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Byte positions of every 4096th UTF-16 unit, so slicing by UTF-16 offsets doesn't rescan the text.
struct Utf16Index {
    marks: Vec<(usize, usize)>,
}

const MARK: usize = 4096;

impl Utf16Index {
    fn new(text: &str) -> Self {
        let mut marks = vec![(0, 0)];
        let mut u = 0usize;
        for (b, ch) in text.char_indices() {
            if u >= marks.len() * MARK {
                marks.push((u, b));
            }
            u += ch.len_utf16();
        }
        Self { marks }
    }

    /// Byte offset of UTF-16 offset `pos` (clamped to the text; inside a surrogate pair rounds up).
    fn byte(&self, text: &str, pos: usize) -> usize {
        let (mut u, b0) = self.marks[(pos / MARK).min(self.marks.len() - 1)];
        for (b, ch) in text[b0..].char_indices() {
            if u >= pos {
                return b0 + b;
            }
            u += ch.len_utf16();
        }
        text.len()
    }
}

/// `text[start..end]` with UTF-16 offsets, plus whether it was cut at `max` chars.
fn slice_indexed(text: &str, idx: &Utf16Index, start: usize, end: usize, max: usize) -> (String, bool) {
    let a = idx.byte(text, start);
    let b = idx.byte(text, end.max(start));
    let s = &text[a..b];
    match s.char_indices().nth(max) {
        Some((cut, _)) => (s[..cut].to_string(), true),
        None => (s.to_string(), false),
    }
}

/// Everything a range read needs from one source, loaded once per batch.
struct Loaded {
    src: models::Source,
    text: String,
    index: Utf16Index,
    pages: Vec<(i64, i64)>,
    chunks: Vec<ChunkRow>,
    text_len: i64,
}

fn load(c: &Connection, source_id: &str) -> AppResult<Loaded> {
    let src = models::get_source(c, source_id)?;
    let (text, pages): (String, Option<String>) = c
        .query_row(
            "SELECT text, pages FROM source_texts WHERE source_id = ?1",
            [source_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound("source text".into()))?;
    let pages: Vec<(i64, i64)> = pages
        .and_then(|p| serde_json::from_str(&p).ok())
        .unwrap_or_default();
    let chunks = chunk_rows(c, source_id)?;
    let text_len = crate::ingest::chunk::utf16_len(&text) as i64;
    let index = Utf16Index::new(&text);
    Ok(Loaded {
        src,
        text,
        index,
        pages,
        chunks,
        text_len,
    })
}

pub fn read_range(c: &Connection, req: &RangeRequest) -> AppResult<SourceRange> {
    read_loaded(&load(c, &req.source_id)?, req)
}

fn read_loaded(l: &Loaded, req: &RangeRequest) -> AppResult<SourceRange> {
    let (pages, chunks, text_len) = (&l.pages, &l.chunks, l.text_len);
    let (start, end) = match req.unit.as_str() {
        "all" => (0, text_len),
        "chunk" => {
            let (a, b) = (req.from.min(req.to), req.from.max(req.to));
            let first = chunks.iter().find(|k| k.ord >= a);
            let last = chunks.iter().rev().find(|k| k.ord <= b);
            match (first, last) {
                (Some(f), Some(l)) if f.ord <= l.ord => (f.start, l.end),
                _ => return Err(invalid("No chunks in that range.")),
            }
        }
        "page" => {
            if pages.is_empty() {
                return Err(invalid("This source has no page numbers."));
            }
            let (a, b) = (req.from.min(req.to), req.from.max(req.to));
            let start = pages
                .iter()
                .find(|(p, _)| *p >= a)
                .map(|(_, o)| *o)
                .ok_or_else(|| invalid("That page is past the end of the source."))?;
            let end = pages
                .iter()
                .find(|(p, _)| *p > b)
                .map(|(_, o)| *o)
                .unwrap_or(text_len);
            (start, end.max(start))
        }
        _ => return Err(invalid("unit must be chunk, page or all")),
    };
    let max = req.max_chars.unwrap_or(MAX_RANGE_CHARS).min(MAX_RANGE_CHARS);
    let (slice, truncated) = slice_indexed(&l.text, &l.index, start as usize, end as usize, max);
    let inside: Vec<&ChunkRow> = chunks
        .iter()
        .filter(|k| k.end > start && k.start < end)
        .collect();
    let page_at = |off: i64| {
        pages
            .iter()
            .take_while(|(_, o)| *o <= off)
            .last()
            .map(|(p, _)| *p)
    };
    let shown_end = if truncated {
        start + crate::ingest::chunk::utf16_len(&slice) as i64
    } else {
        end
    };
    Ok(SourceRange {
        source_id: l.src.id.clone(),
        source_title: l.src.title.clone(),
        chunk_id: inside.first().map(|k| k.id),
        ord_from: inside.first().map(|k| k.ord).unwrap_or(0),
        ord_to: inside
            .iter()
            .take_while(|k| k.start < shown_end)
            .last()
            .map(|k| k.ord)
            .unwrap_or(0),
        start,
        end: shown_end,
        page_from: page_at(start).or_else(|| inside.first().and_then(|k| k.page)),
        page_to: page_at((shown_end - 1).max(start))
            .or_else(|| inside.last().and_then(|k| k.page)),
        heading: inside.first().and_then(|k| k.heading.clone()),
        text: slice,
        truncated,
        total_chunks: chunks.len() as i64,
        total_pages: pages.last().map(|(p, _)| *p),
        page_starts: pages
            .iter()
            .filter(|(_, o)| *o > start && *o < shown_end)
            .copied()
            .collect(),
        chunk_starts: inside
            .iter()
            .filter(|k| k.start < shown_end)
            .map(|k| (k.id, k.start.max(start)))
            .collect(),
    })
}

pub fn read_ranges(c: &Connection, reqs: &[RangeRequest]) -> Vec<Result<SourceRange, String>> {
    let mut cache: std::collections::HashMap<String, Result<std::rc::Rc<Loaded>, String>> =
        Default::default();
    reqs.iter()
        .map(|r| {
            let l = cache
                .entry(r.source_id.clone())
                .or_insert_with(|| load(c, &r.source_id).map(std::rc::Rc::new).map_err(|e| e.to_string()))
                .clone()?;
            read_loaded(&l, r).map_err(|e| e.to_string())
        })
        .collect()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeResult {
    pub range: Option<SourceRange>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn read_source_ranges(
    state: State<'_, AppState>,
    ranges: Vec<RangeRequest>,
) -> AppResult<Vec<RangeResult>> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let c = db.conn()?;
        Ok(read_ranges(&c, &ranges)
            .into_iter()
            .map(|r| match r {
                Ok(range) => RangeResult {
                    range: Some(range),
                    error: None,
                },
                Err(e) => RangeResult {
                    range: None,
                    error: Some(e),
                },
            })
            .collect())
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

// ---------- outlines ----------

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OutlineEntry {
    pub title: String,
    pub level: u8,
    pub ord_from: i64,
    pub ord_to: i64,
    pub page_from: Option<i64>,
    pub page_to: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SourceOutline {
    pub source_id: String,
    pub method: String,
    pub entries: Vec<OutlineEntry>,
}

/// Heading number of a line like "5.2 Title", "Chapter 5: Title", "Kapitel 5 Titel", "# Title".
fn heading_key(line: &str) -> Option<((u32, u32), String)> {
    let t = line.trim();
    if t.len() < 3 || t.chars().count() > 120 {
        return None;
    }
    for word in [
        "Chapter", "CHAPTER", "Kapitel", "KAPITEL", "Unit", "UNIT", "Part", "Teil", "Lesson",
        "Module",
    ] {
        if let Some(rest) = t.strip_prefix(word) {
            let rest = rest.trim_start();
            let num: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if num.is_empty() {
                continue;
            }
            let n: u32 = num.parse().ok()?;
            let title = rest[num.len()..]
                .trim_start_matches([':', '.', ' ', '-', '–'])
                .trim();
            let title = if title.is_empty() {
                format!("{word} {n}")
            } else {
                format!("{word} {n}: {title}")
            };
            return Some(((n, 0), title));
        }
    }
    let num: String = t
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let parts: Vec<&str> = num.trim_end_matches('.').split('.').collect();
    if parts.len() == 2 && parts.iter().all(|p| !p.is_empty() && p.len() <= 3) {
        let rest = t[num.len()..].trim();
        let first = rest.chars().next()?;
        if !first.is_uppercase() || rest.chars().count() < 3 {
            return None;
        }
        // a table-of-contents line lists several sections
        if rest.split_whitespace().any(|w| {
            let w = w.trim_end_matches('.');
            w.contains('.') && w.split('.').all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
        }) {
            return None;
        }
        let title = rest
            .trim_end_matches("Learning Objectives")
            .trim_end_matches("Lernziele")
            .trim()
            .to_string();
        return Some(((parts[0].parse().ok()?, parts[1].parse().ok()?), format!("{} {title}", parts.join("."))));
    }
    None
}

/// Indices of the longest strictly increasing run of keys (drops prefaces and repeated headings).
fn longest_increasing(keys: &[(u32, u32)]) -> Vec<usize> {
    let mut tails: Vec<usize> = vec![];
    let mut prev: Vec<Option<usize>> = vec![None; keys.len()];
    for i in 0..keys.len() {
        let pos = tails.partition_point(|&t| keys[t] < keys[i]);
        if pos > 0 {
            prev[i] = Some(tails[pos - 1]);
        }
        if pos == tails.len() {
            tails.push(i);
        } else {
            tails[pos] = i;
        }
    }
    let mut out = vec![];
    let mut cur = tails.last().copied();
    while let Some(i) = cur {
        out.push(i);
        cur = prev[i];
    }
    out.reverse();
    out
}

fn ord_at(chunks: &[ChunkRow], off: i64) -> i64 {
    chunks
        .iter()
        .take_while(|k| k.start <= off)
        .last()
        .or(chunks.first())
        .map(|k| k.ord)
        .unwrap_or(0)
}

fn close_ranges(entries: &mut [OutlineEntry], chunks: &[ChunkRow]) {
    let last_ord = chunks.last().map(|k| k.ord).unwrap_or(0);
    let n = entries.len();
    for i in 0..n {
        let level = entries[i].level;
        let next = entries[i + 1..]
            .iter()
            .find(|e| e.level <= level)
            .map(|e| e.ord_from);
        entries[i].ord_to = next.map(|o| (o - 1).max(entries[i].ord_from)).unwrap_or(last_ord);
        let (a, b) = (entries[i].ord_from, entries[i].ord_to);
        let pages: Vec<i64> = chunks
            .iter()
            .filter(|k| k.ord >= a && k.ord <= b)
            .filter_map(|k| k.page)
            .collect();
        if entries[i].page_from.is_none() {
            entries[i].page_from = pages.first().copied();
        }
        entries[i].page_to = pages.last().copied().or(entries[i].page_from);
    }
}

fn outline_from_text(text: &str, chunks: &[ChunkRow]) -> Vec<OutlineEntry> {
    let mut found: Vec<((u32, u32), String, i64)> = vec![];
    let mut off = 0i64;
    for line in text.split('\n') {
        if let Some((k, title)) = heading_key(line) {
            found.push((k, title, off));
        }
        off += crate::ingest::chunk::utf16_len(line) as i64 + 1;
    }
    let keys: Vec<(u32, u32)> = found.iter().map(|f| f.0).collect();
    let keep = longest_increasing(&keys);
    if keep.len() < 3 {
        return vec![];
    }
    let mut entries: Vec<OutlineEntry> = keep
        .into_iter()
        .map(|i| {
            let (k, title, off) = &found[i];
            OutlineEntry {
                title: title.clone(),
                level: if k.1 == 0 { 1 } else { 2 },
                ord_from: ord_at(chunks, *off),
                ord_to: 0,
                page_from: None,
                page_to: None,
            }
        })
        .collect();
    close_ranges(&mut entries, chunks);
    entries
}

fn outline_from_headings(chunks: &[ChunkRow]) -> Vec<OutlineEntry> {
    let mut entries: Vec<OutlineEntry> = vec![];
    for k in chunks {
        let Some(h) = k.heading.as_deref().map(str::trim).filter(|h| !h.is_empty()) else {
            continue;
        };
        if entries.last().is_some_and(|e| e.title == h) {
            continue;
        }
        if entries.iter().any(|e| e.title == h) && entries.len() > 200 {
            continue;
        }
        entries.push(OutlineEntry {
            title: h.chars().take(120).collect(),
            level: 1,
            ord_from: k.ord,
            ord_to: k.ord,
            page_from: k.page,
            page_to: None,
        });
    }
    if entries.len() < 2 {
        return vec![];
    }
    close_ranges(&mut entries, chunks);
    entries
}

fn outline_from_pdf(path: &std::path::Path, chunks: &[ChunkRow]) -> Option<Vec<OutlineEntry>> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.len() > 300 << 20 {
        return None;
    }
    let doc = lopdf::Document::load(path).ok()?;
    let toc = doc.get_toc().ok()?;
    let mut entries: Vec<OutlineEntry> = toc
        .toc
        .into_iter()
        .filter(|t| t.level <= 3 && !t.title.trim().is_empty())
        .map(|t| {
            let page = t.page as i64;
            let ord = chunks
                .iter()
                .find(|k| k.page.is_some_and(|p| p >= page))
                .map(|k| k.ord)
                .unwrap_or(0);
            OutlineEntry {
                title: t.title.trim().chars().take(120).collect(),
                level: t.level.clamp(1, 3) as u8,
                ord_from: ord,
                ord_to: ord,
                page_from: Some(page),
                page_to: None,
            }
        })
        .collect();
    if entries.len() < 2 {
        return None;
    }
    entries.sort_by_key(|e| (e.ord_from, e.page_from));
    close_ranges(&mut entries, chunks);
    Some(entries)
}

fn store_outline(c: &Connection, source_id: &str, method: &str, entries: &[OutlineEntry]) -> AppResult<()> {
    c.execute(
        "INSERT INTO source_outlines (source_id, method, outline, created_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(source_id) DO UPDATE SET method = excluded.method, outline = excluded.outline, created_at = excluded.created_at",
        params![source_id, method, serde_json::to_string(entries)?, now_ms()],
    )?;
    Ok(())
}

/// Outline from what ingest already stored (chunk headings, heading-like lines); no file reads.
pub fn build_outline(c: &Connection, source_id: &str) -> AppResult<SourceOutline> {
    let o = compute_outline(c, source_id)?;
    store_outline(c, source_id, &o.method, &o.entries)?;
    Ok(o)
}

/// The stored outline, else one computed now without writing (read-only connections).
pub fn outline_readonly(c: &Connection, source_id: &str) -> AppResult<SourceOutline> {
    match stored_outline(c, source_id)? {
        Some(o) => Ok(o),
        None => compute_outline(c, source_id),
    }
}

fn compute_outline(c: &Connection, source_id: &str) -> AppResult<SourceOutline> {
    let chunks = chunk_rows(c, source_id)?;
    let mut entries = outline_from_headings(&chunks);
    let mut method = "headings";
    if entries.len() < 3 {
        let text: Option<String> = c
            .query_row(
                "SELECT text FROM source_texts WHERE source_id = ?1",
                [source_id],
                |r| r.get(0),
            )
            .optional()?;
        let from_text = text.map(|t| outline_from_text(&t, &chunks)).unwrap_or_default();
        if from_text.len() > entries.len() {
            entries = from_text;
            method = "text";
        }
    }
    if entries.is_empty() {
        method = "none";
    }
    Ok(SourceOutline {
        source_id: source_id.into(),
        method: method.into(),
        entries,
    })
}

fn stored_outline(c: &Connection, source_id: &str) -> AppResult<Option<SourceOutline>> {
    let row: Option<(String, String)> = c
        .query_row(
            "SELECT method, outline FROM source_outlines WHERE source_id = ?1",
            [source_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    Ok(row.map(|(method, json)| SourceOutline {
        source_id: source_id.into(),
        method,
        entries: serde_json::from_str(&json).unwrap_or_default(),
    }))
}

/// PDFs whose bookmarks haven't been read yet, with their files.
fn pdfs_without_toc(c: &Connection, space_id: &str) -> AppResult<Vec<(String, std::path::PathBuf)>> {
    let mut st = c.prepare(
        "SELECT s.id, coalesce(s.local_path, s.origin) FROM sources s
         LEFT JOIN source_outlines o ON o.source_id = s.id
         WHERE s.space_id = ?1 AND s.kind = 'pdf' AND s.status = 'ready'
           AND (o.method IS NULL OR o.method NOT LIKE '%toc%')",
    )?;
    let rows = st.query_map([space_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))?;
    let mut out = vec![];
    for r in rows {
        let (id, path) = r?;
        if let Some(p) = path.map(std::path::PathBuf::from).filter(|p| p.is_file()) {
            out.push((id, p));
        }
    }
    Ok(out)
}

/// Reads PDF bookmarks one file at a time on a background thread; better outlines replace the
/// heading-based ones as they arrive.
pub struct TocReader {
    queued: Mutex<HashSet<String>>,
}

impl TocReader {
    pub fn new() -> Self {
        Self {
            queued: Mutex::new(HashSet::new()),
        }
    }

    fn queue(&'static self, db: Db, items: Vec<(String, std::path::PathBuf)>) {
        let fresh: Vec<_> = {
            let mut q = self.queued.lock().unwrap();
            items.into_iter().filter(|(id, _)| q.insert(id.clone())).collect()
        };
        if fresh.is_empty() {
            return;
        }
        let spawned = std::thread::Builder::new()
            .name("pdf-toc".into())
            .stack_size(256 << 20)
            .spawn(move || {
                for (id, path) in fresh {
                    let Ok(c) = db.conn() else { return };
                    let Ok(chunks) = chunk_rows(&c, &id) else { continue };
                    let found = std::panic::catch_unwind(|| outline_from_pdf(&path, &chunks))
                        .ok()
                        .flatten();
                    let res = match found {
                        Some(entries) => store_outline(&c, &id, "toc", &entries),
                        None => stored_outline(&c, &id).and_then(|o| {
                            let o = match o {
                                Some(o) => o,
                                None => build_outline(&c, &id)?,
                            };
                            store_outline(&c, &id, &format!("{};toc-none", o.method), &o.entries)
                        }),
                    };
                    if let Err(e) = res {
                        log::warn!("pdf outline for {id}: {e}");
                    }
                }
            });
        if let Err(e) = spawned {
            log::error!("pdf outline reader not started: {e}");
        }
    }
}

static TOC: std::sync::OnceLock<TocReader> = std::sync::OnceLock::new();

pub fn space_outlines(db: &Db, space_id: &str) -> AppResult<Vec<SourceOutline>> {
    let c = db.conn()?;
    let ids: Vec<String> = {
        let mut st = c.prepare("SELECT id FROM sources WHERE space_id = ?1 AND status = 'ready'")?;
        let rows = st.query_map([space_id], |r| r.get(0))?;
        rows.collect::<Result<_, _>>()?
    };
    let mut out = vec![];
    for id in ids {
        out.push(match stored_outline(&c, &id)? {
            Some(o) => o,
            None => build_outline(&c, &id)?,
        });
    }
    let pending = pdfs_without_toc(&c, space_id)?;
    if !pending.is_empty() {
        TOC.get_or_init(TocReader::new).queue(db.clone(), pending);
    }
    Ok(out)
}

#[tauri::command]
pub async fn source_outlines(
    state: State<'_, AppState>,
    space_id: String,
) -> AppResult<Vec<SourceOutline>> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || space_outlines(&db, &space_id))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

// ---------- per-source mode, thread summaries ----------

pub const CONTEXT_MODES: [&str; 3] = ["auto", "summary", "full"];

#[tauri::command]
pub async fn set_source_context_mode(
    state: State<'_, AppState>,
    id: String,
    mode: String,
) -> AppResult<models::Source> {
    if !CONTEXT_MODES.contains(&mode.as_str()) {
        return Err(invalid("Unknown context mode."));
    }
    let c = state.db.conn()?;
    c.execute(
        "UPDATE sources SET context_mode = ?2 WHERE id = ?1",
        params![id, mode],
    )?;
    models::get_source(&c, &id)
}

/// Stores a compaction summary covering messages up to `until` (created_at), or clears it.
pub fn set_thread_summary(
    c: &Connection,
    thread_id: &str,
    summary: Option<&str>,
    until: Option<i64>,
) -> AppResult<models::Thread> {
    c.execute(
        "UPDATE threads SET summary = ?2, summary_until = ?3 WHERE id = ?1",
        params![thread_id, summary, until],
    )?;
    models::get_thread(c, thread_id)
}

#[tauri::command]
pub async fn save_thread_summary(
    state: State<'_, AppState>,
    thread_id: String,
    summary: Option<String>,
    until: Option<i64>,
) -> AppResult<models::Thread> {
    set_thread_summary(&state.db.conn()?, &thread_id, summary.as_deref(), until)
}

#[tauri::command]
pub async fn get_thread(state: State<'_, AppState>, id: String) -> AppResult<models::Thread> {
    models::get_thread(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn set_thread_auto_compact(
    state: State<'_, AppState>,
    thread_id: String,
    on: bool,
) -> AppResult<models::Thread> {
    let c = state.db.conn()?;
    c.execute(
        "UPDATE threads SET auto_compact = ?2 WHERE id = ?1",
        params![thread_id, on as i64],
    )?;
    models::get_thread(&c, &thread_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (Db, tempfile::TempDir, String) {
        let (db, d) = crate::db::test_db();
        let c = db.conn().unwrap();
        c.execute_batch(
            "INSERT INTO spaces (id,name,created_at,updated_at) VALUES ('sp','S',1,1);
             INSERT INTO sources (id,space_id,title,kind,status,created_at,updated_at) VALUES ('s1','sp','Book','pdf','ready',1,1);",
        )
        .unwrap();
        // "ä" and "😀" make UTF-16 offsets differ from char and byte offsets
        let paras = [
            "Chapter 1: Basics",
            "Intro text ä.",
            "1.1 Numbers Learning Objectives",
            "Count 😀 things.",
            "1.2 Fractions",
            "Halves and thirds.",
            "Chapter 2: Algebra",
            "2.1 Variables",
            "x is a number.",
        ];
        let text = paras.join("\n");
        let mut off = 0i64;
        let mut page_starts = vec![];
        for (i, p) in paras.iter().enumerate() {
            let len = crate::ingest::chunk::utf16_len(p) as i64;
            c.execute(
                "INSERT INTO chunks (source_id, space_id, ord, text, start_offset, end_offset, page) VALUES ('s1','sp',?1,?2,?3,?4,?5)",
                params![i as i64, p, off, off + len, (i / 3) as i64 + 1],
            )
            .unwrap();
            if i % 3 == 0 {
                page_starts.push(((i / 3) as i64 + 1, off));
            }
            off += len + 1;
        }
        c.execute(
            "INSERT INTO source_texts (source_id, text, pages) VALUES ('s1', ?1, ?2)",
            params![text, serde_json::to_string(&page_starts).unwrap()],
        )
        .unwrap();
        (db, d, "s1".into())
    }

    fn req(unit: &str, from: i64, to: i64) -> RangeRequest {
        RangeRequest {
            source_id: "s1".into(),
            unit: unit.into(),
            from,
            to,
            max_chars: None,
        }
    }

    #[test]
    fn utf16_index_finds_byte_offsets_past_its_marks() {
        let text = format!("{}😀é{}", "a".repeat(5000), "b".repeat(9000));
        let idx = Utf16Index::new(&text);
        assert_eq!(idx.byte(&text, 5000), 5000);
        assert_eq!(idx.byte(&text, 5002), 5004);
        assert_eq!(idx.byte(&text, 5003), 5006);
        assert_eq!(idx.byte(&text, 99_999), text.len());
        assert_eq!(slice_indexed(&text, &idx, 4999, 5004, 99), ("a😀éb".into(), false));
        assert_eq!(slice_indexed(&text, &idx, 4999, 5004, 2), ("a😀".into(), true));
    }

    #[test]
    fn reads_chunk_and_page_ranges_with_utf16_offsets() {
        let (db, _d, _) = setup();
        let c = db.conn().unwrap();
        let r = read_range(&c, &req("chunk", 3, 4)).unwrap();
        assert_eq!(r.text, "Count 😀 things.\n1.2 Fractions");
        assert_eq!((r.ord_from, r.ord_to), (3, 4));
        assert_eq!((r.page_from, r.page_to), (Some(2), Some(2)));
        let p = read_range(&c, &req("page", 2, 2)).unwrap();
        assert!(p.text.starts_with("Count 😀"));
        assert!(p.text.ends_with("Halves and thirds.\n"));
        let all = read_range(&c, &req("all", 0, 0)).unwrap();
        assert_eq!(all.total_chunks, 9);
        assert_eq!(all.total_pages, Some(3));
        let cut = read_range(
            &c,
            &RangeRequest {
                max_chars: Some(5),
                ..req("all", 0, 0)
            },
        )
        .unwrap();
        assert_eq!((cut.text.as_str(), cut.truncated), ("Chapt", true));
        assert!(read_range(&c, &req("page", 9, 9)).is_err());
        assert!(read_range(&c, &req("chunk", 50, 60)).is_err());
    }

    #[test]
    fn outline_from_numbered_lines_skips_toc_lines_and_prefaces() {
        assert_eq!(heading_key("1.1 Numbers 1.2 Fractions 1.3 Decimals"), None);
        assert_eq!(heading_key("3.10 percent of the class"), None);
        assert_eq!(
            heading_key("Chapter 10: Quadratic Equations").map(|k| k.0),
            Some((10, 0))
        );
        assert_eq!(
            heading_key("2.4 Use a General Strategy Learning Objectives").map(|k| k.1),
            Some("2.4 Use a General Strategy".into())
        );
        assert_eq!(longest_increasing(&[(10, 0), (1, 1), (1, 2), (1, 1), (2, 0), (2, 1)]), vec![1, 2, 4, 5]);

        let (db, _d, id) = setup();
        let c = db.conn().unwrap();
        let o = build_outline(&c, &id).unwrap();
        assert_eq!(o.method, "text");
        let titles: Vec<_> = o.entries.iter().map(|e| e.title.as_str()).collect();
        assert_eq!(
            titles,
            ["Chapter 1: Basics", "1.1 Numbers", "1.2 Fractions", "Chapter 2: Algebra", "2.1 Variables"]
        );
        assert_eq!((o.entries[0].ord_from, o.entries[0].ord_to), (0, 5));
        assert_eq!((o.entries[1].ord_from, o.entries[1].ord_to), (2, 3));
        assert_eq!((o.entries[4].page_from, o.entries[4].page_to), (Some(3), Some(3)));
        assert!(stored_outline(&c, &id).unwrap().is_some());
    }

    #[test]
    fn thread_summary_and_auto_compact_round_trip() {
        let (db, _d, _) = setup();
        let c = db.conn().unwrap();
        let t = models::create_thread(&c, "sp", None).unwrap();
        assert!(t.auto_compact && t.summary.is_none());
        let t = set_thread_summary(&c, &t.id, Some("sum"), Some(42)).unwrap();
        assert_eq!((t.summary.as_deref(), t.summary_until), (Some("sum"), Some(42)));
        let t = set_thread_summary(&c, &t.id, None, None).unwrap();
        assert!(t.summary.is_none());
    }
}

#[cfg(test)]
mod real_tests {
    use super::*;

    /// `CONTEXT_DB=<copy of app.db> cargo test --release real_outlines -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_outlines() {
        let path = std::env::var("CONTEXT_DB").expect("CONTEXT_DB");
        let db = Db::open(std::path::PathBuf::from(path)).unwrap();
        let c = db.conn().unwrap();
        let spaces: Vec<(String, String)> = {
            let mut st = c.prepare("SELECT id, name FROM spaces").unwrap();
            let rows = st.query_map([], |r| Ok((r.get(0).unwrap(), r.get(1).unwrap()))).unwrap();
            rows.map(|r| r.unwrap()).collect()
        };
        for (id, name) in spaces {
            let t = std::time::Instant::now();
            c.execute("DELETE FROM source_outlines WHERE source_id IN (SELECT id FROM sources WHERE space_id = ?1)", [&id]).unwrap();
            let ids: Vec<String> = {
                let mut st = c.prepare("SELECT id FROM sources WHERE space_id = ?1").unwrap();
                let rows = st.query_map([&id], |r| r.get(0)).unwrap();
                rows.map(|r| r.unwrap()).collect()
            };
            let outs: Vec<SourceOutline> = ids.iter().map(|s| build_outline(&c, s).unwrap()).collect();
            let with = outs.iter().filter(|o| !o.entries.is_empty()).count();
            let entries: usize = outs.iter().map(|o| o.entries.len()).sum();
            println!("{name}: {} sources, {with} with outline, {entries} entries, {:?}", outs.len(), t.elapsed());
        }
        let pdfs: Vec<(String, String, String)> = {
            let mut st = c.prepare("SELECT id, title, coalesce(local_path, origin) FROM sources WHERE kind='pdf' ORDER BY char_count DESC LIMIT 3").unwrap();
            let rows = st.query_map([], |r| Ok((r.get(0).unwrap(), r.get(1).unwrap(), r.get(2).unwrap()))).unwrap();
            rows.map(|r| r.unwrap()).collect()
        };
        for (id, title, path) in pdfs {
            let t = std::time::Instant::now();
            let chunks = chunk_rows(&c, &id).unwrap();
            let o = outline_from_pdf(std::path::Path::new(&path), &chunks);
            println!("{title}: toc {:?} entries in {:?}; first {:?}", o.as_ref().map(|e| e.len()), t.elapsed(), o.as_ref().and_then(|e| e.get(3)));
        }
    }
}
