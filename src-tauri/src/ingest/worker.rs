use super::chunk::{chunk_text, utf16_len};
use super::embed::{Embedder, EmbedderService};
use super::extract::{self, Extracted};
use super::Emit;
use crate::db::{models, now_ms, Db};
use crate::error::AppResult;
use crate::retrieval::vec_blob;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const EMBED_BATCH: usize = 16;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Debug, Clone)]
pub enum Input {
    File(PathBuf, String),
    #[cfg(test)]
    Text(String),
    /// source_texts if present, else the origin file
    Stored,
}

#[derive(Debug)]
pub enum Job {
    Ingest { source_id: String, input: Input },
    /// load the model if its files exist, then embed chunks that have no vectors yet
    Warmup,
    /// the embedding model changed: drop all vectors, then embed everything with the new model
    Reembed,
}

enum Outcome {
    Done,
    Gone,
}

pub struct Worker {
    db: Db,
    embedder: Arc<EmbedderService>,
    emit: Emit,
    needs_backfill: bool,
    last_progress: Option<Instant>,
}

impl Worker {
    pub fn new(db: Db, embedder: Arc<EmbedderService>, emit: Emit) -> Self {
        Self { db, embedder, emit, needs_backfill: true, last_progress: None }
    }

    pub fn run(mut self, rx: Receiver<Job>) {
        for job in rx {
            if catch_unwind(AssertUnwindSafe(|| self.handle(job))).is_err() {
                log::error!("ingest job panicked");
            }
        }
    }

    pub fn handle(&mut self, job: Job) {
        match job {
            Job::Ingest { source_id, input } => self.process(&source_id, input),
            Job::Warmup => {
                if let Some(e) = self.embedder.ensure_loaded() {
                    self.backfill(e.as_ref());
                }
            }
            Job::Reembed => {
                if let Err(e) = self.clear_vectors() {
                    log::warn!("couldn't clear vectors for the new embedding model: {e}");
                    return;
                }
                self.needs_backfill = true;
                if let Some(e) = self.embedder.ensure_loaded() {
                    self.backfill(e.as_ref());
                }
            }
        }
    }

    pub fn process(&mut self, source_id: &str, input: Input) {
        let res = catch_unwind(AssertUnwindSafe(|| self.pipeline(source_id, input)));
        let err = match res {
            Ok(Ok(_)) => return,
            Ok(Err(e)) => e,
            Err(_) => "Something went wrong while reading this source.".to_string(),
        };
        let Ok(c) = self.db.conn() else { return };
        if models::get_source(&c, source_id).is_err() {
            return;
        }
        log::warn!("ingest failed for {source_id}: {err}");
        let _ = models::set_source_status(&c, source_id, "error", Some(&err), 0.0);
        self.emit_source(&c, source_id);
    }

    fn emit_source(&self, c: &Connection, id: &str) {
        if let Ok(s) = models::get_source(c, id) {
            (self.emit)("source://updated", serde_json::to_value(s).unwrap_or_default());
        }
    }

    fn progress(&mut self, c: &Connection, id: &str, p: f64) {
        if self.last_progress.map(|t| t.elapsed() < PROGRESS_INTERVAL).unwrap_or(false) {
            return;
        }
        self.last_progress = Some(Instant::now());
        let _ = c.execute("UPDATE sources SET progress=?2, updated_at=?3 WHERE id=?1", params![id, p, now_ms()]);
        self.emit_source(c, id);
    }

    fn load_input(&self, c: &Connection, src: &models::Source, input: Input) -> Result<Extracted, String> {
        match input {
            Input::File(path, kind) => extract::extract_file(&path, &kind),
            #[cfg(test)]
            Input::Text(t) => Ok(Extracted { text: extract::normalize_newlines(&t), pages: None }),
            Input::Stored => {
                let stored: Option<(String, Option<String>)> = c
                    .query_row("SELECT text, pages FROM source_texts WHERE source_id=?1", [&src.id], |r| {
                        Ok((r.get(0)?, r.get(1)?))
                    })
                    .optional()
                    .map_err(db_err)?;
                if let Some((text, pages)) = stored {
                    let pages = pages.and_then(|p| serde_json::from_str::<Vec<(i64, i64)>>(&p).ok());
                    return Ok(Extracted { text, pages });
                }
                match (&src.origin, src.kind.as_str()) {
                    (Some(path), "pdf" | "epub" | "docx" | "markdown" | "text") => {
                        extract::extract_file(&PathBuf::from(path), &src.kind)
                    }
                    _ => Err("The original text of this source is missing. Import it again.".into()),
                }
            }
        }
    }

    fn pipeline(&mut self, source_id: &str, input: Input) -> Result<Outcome, String> {
        let mut c = self.db.conn().map_err(db_err)?;
        let Ok(src) = models::get_source(&c, source_id) else { return Ok(Outcome::Gone) };
        self.last_progress = None;
        let ex = self.load_input(&c, &src, input)?;
        if ex.text.trim().is_empty() {
            return Err("No text found in this source.".into());
        }
        self.progress(&c, source_id, 0.1);

        let chunks = chunk_text(&ex.text, ex.pages.as_deref());
        let mut ids = Vec::with_capacity(chunks.len());
        {
            let tx = c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db_err)?;
            if models::get_source(&tx, source_id).is_err() {
                return Ok(Outcome::Gone);
            }
            let pages = ex.pages.as_ref().map(|p| serde_json::to_string(p).unwrap_or_default());
            tx.execute(
                "INSERT OR REPLACE INTO source_texts (source_id, text, pages) VALUES (?1, ?2, ?3)",
                params![source_id, ex.text, pages],
            )
            .map_err(db_err)?;
            tx.execute("DELETE FROM chunks WHERE source_id=?1", [source_id]).map_err(db_err)?;
            {
                let mut st = tx
                    .prepare(
                        "INSERT INTO chunks (source_id, space_id, ord, text, start_offset, end_offset, page, heading)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    )
                    .map_err(db_err)?;
                for (i, ch) in chunks.iter().enumerate() {
                    st.execute(params![
                        source_id,
                        src.space_id,
                        i as i64,
                        ch.text,
                        ch.start,
                        ch.end,
                        ch.page,
                        ch.heading
                    ])
                    .map_err(db_err)?;
                    ids.push(tx.last_insert_rowid());
                }
            }
            tx.commit().map_err(db_err)?;
        }
        self.progress(&c, source_id, 0.15);

        if let Some(emb) = self.embedder.ensure_loaded() {
            if self.needs_backfill {
                self.backfill(emb.as_ref());
            }
            let total = chunks.len().max(1);
            for (bi, batch) in chunks.chunks(EMBED_BATCH).enumerate() {
                let texts: Vec<String> = batch.iter().map(|ch| ch.text.clone()).collect();
                let vecs = match emb.embed(&texts) {
                    Ok(v) => v,
                    Err(e) => {
                        log::warn!("embedding failed, source stays FTS-only: {e}");
                        self.needs_backfill = true;
                        break;
                    }
                };
                let batch_ids = &ids[bi * EMBED_BATCH..bi * EMBED_BATCH + batch.len()];
                insert_vectors(&mut c, batch_ids, &src.space_id, &vecs).map_err(db_err)?;
                if models::get_source(&c, source_id).is_err() {
                    return Ok(Outcome::Gone);
                }
                let done = (bi * EMBED_BATCH + batch.len()) as f64 / total as f64;
                self.progress(&c, source_id, 0.15 + 0.84 * done);
            }
        }

        let n = c
            .execute(
                "UPDATE sources SET status='ready', error=NULL, progress=1, chunk_count=?2, char_count=?3, updated_at=?4 WHERE id=?1",
                params![source_id, chunks.len() as i64, utf16_len(&ex.text) as i64, now_ms()],
            )
            .map_err(db_err)?;
        if n == 0 {
            return Ok(Outcome::Gone);
        }
        self.emit_source(&c, source_id);
        Ok(Outcome::Done)
    }

    fn clear_vectors(&self) -> AppResult<()> {
        let c = self.db.conn()?;
        let model = self.embedder.model_id();
        c.execute("DELETE FROM vec_chunks", [])?;
        models::set_setting(&c, super::embed::SETTING_INDEX_MODEL, &serde_json::json!(model))?;
        log::info!("vectors cleared; re-embedding with {model}");
        Ok(())
    }

    /// Embeds chunks of ready sources that have no vector yet (model became available later).
    fn backfill(&mut self, emb: &dyn Embedder) {
        let res = (|| -> AppResult<()> {
            let mut c = self.db.conn()?;
            let missing: Vec<(i64, String, String)> = {
                let mut st = c.prepare(
                    "SELECT c.id, c.space_id, c.text FROM chunks c JOIN sources s ON s.id = c.source_id
                     WHERE s.status = 'ready' AND c.id NOT IN (SELECT chunk_id FROM vec_chunks) ORDER BY c.id",
                )?;
                let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
                rows.collect::<Result<_, _>>()?
            };
            if !missing.is_empty() {
                log::info!("embedding {} chunks that have no vectors yet", missing.len());
            }
            let total = missing.len();
            for (i, batch) in missing.chunks(EMBED_BATCH).enumerate() {
                if total > EMBED_BATCH {
                    self.embedder.report_indexing(Some((i * EMBED_BATCH) as f64 / total as f64));
                }
                let texts: Vec<String> = batch.iter().map(|m| m.2.clone()).collect();
                let vecs = emb.embed(&texts)?;
                let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
                for (m, v) in batch.iter().zip(&vecs) {
                    insert_vector(&tx, m.0, &m.1, v)?;
                }
                tx.commit()?;
            }
            if total > EMBED_BATCH {
                self.embedder.report_indexing(None);
            }
            Ok(())
        })();
        match res {
            Ok(()) => self.needs_backfill = false,
            Err(e) => {
                log::warn!("vector backfill failed: {e}");
                self.embedder.report_indexing(None);
            }
        }
    }
}

fn insert_vector(c: &Connection, chunk_id: i64, space_id: &str, v: &[f32]) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO vec_chunks (chunk_id, space_id, embedding)
         SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM chunks WHERE id = ?1)",
        params![chunk_id, space_id, vec_blob(v)],
    )?;
    Ok(())
}

fn insert_vectors(c: &mut Connection, ids: &[i64], space_id: &str, vecs: &[Vec<f32>]) -> rusqlite::Result<()> {
    let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
    for (id, v) in ids.iter().zip(vecs) {
        insert_vector(&tx, *id, space_id, v)?;
    }
    tx.commit()
}

fn db_err<E: std::fmt::Display>(e: E) -> String {
    format!("Something went wrong while saving this source: {e}")
}
