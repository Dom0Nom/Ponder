//! Source ingestion: extract → chunk → embed → index, on one dedicated worker thread.
//!
//! Commands only insert the source row (status `processing`), emit `source://updated` and enqueue
//! a job; the worker does all CPU work. Sources still `processing` at startup are re-enqueued.
//!
//! Embedding model: downloaded (and loaded) by the worker right before the first embedding.
//! If that fails, the source is still marked `ready` (FTS works) and the error is exposed via
//! `embedder_status` / `embedder://status`. Download is retried on a later job (at most every
//! 30 s); once the model loads, chunks without vectors are backfilled. Search falls back to
//! FTS-only while the model isn't ready.
pub mod chunk;
pub mod commands;
pub mod embed;
pub mod extract;
pub mod worker;

use crate::db::{models, Db};
use crate::error::{invalid, AppError, AppResult};
use crate::retrieval::{self, SearchHit};
use embed::EmbedderService;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use worker::{Input, Job, Worker};

pub type Emit = Arc<dyn Fn(&str, serde_json::Value) + Send + Sync>;

const TEXT_KINDS: &[&str] = &["pdf", "epub", "docx", "markdown", "text", "url", "youtube"];

#[derive(Clone)]
pub struct Ingest {
    db: Db,
    tx: Sender<Job>,
    pub embedder: Arc<EmbedderService>,
    emit: Emit,
}

impl Ingest {
    pub fn spawn(db: Db, embedder: Arc<EmbedderService>, emit: Emit) -> AppResult<Self> {
        let (tx, rx) = channel();
        let pending: Vec<String> = {
            let c = db.conn()?;
            let mut st = c.prepare("SELECT id FROM sources WHERE status='processing' ORDER BY created_at")?;
            let rows = st.query_map([], |r| r.get(0))?;
            rows.collect::<Result<_, _>>()?
        };
        for id in pending {
            let _ = tx.send(Job::Ingest { source_id: id, input: Input::Stored });
        }
        let (index_model, has_chunks) = {
            let c = db.conn()?;
            let index_model = models::get_setting(&c, embed::SETTING_INDEX_MODEL)?
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_else(|| embed::DEFAULT_MODEL.to_string());
            let has_chunks: bool = c.query_row("SELECT EXISTS (SELECT 1 FROM chunks)", [], |r| r.get(0))?;
            (index_model, has_chunks)
        };
        if has_chunks && index_model != embedder.model_id() {
            // a switch that didn't finish before the app quit
            let _ = tx.send(Job::Reembed);
        } else if embedder.files_present() || has_chunks {
            let _ = tx.send(Job::Warmup);
        }
        let w = Worker::new(db.clone(), embedder.clone(), emit.clone());
        std::thread::Builder::new()
            .name("ingest".into())
            .spawn(move || w.run(rx))
            .map_err(AppError::Io)?;
        Ok(Self { db, tx, embedder, emit })
    }

    fn enqueue(&self, source_id: &str, input: Input) -> AppResult<()> {
        self.tx
            .send(Job::Ingest { source_id: source_id.into(), input })
            .map_err(|_| AppError::Other("The import worker stopped. Restart the app.".into()))
    }

    fn emit_source(&self, s: &models::Source) {
        (self.emit)("source://updated", serde_json::to_value(s).unwrap_or_default());
    }

    pub fn import_file(&self, space_id: &str, path: &str) -> AppResult<models::Source> {
        let p = Path::new(path);
        extract::kind_for_path(p).ok_or_else(|| match p.extension().and_then(|e| e.to_str()) {
            Some(ext) => invalid(format!("Unsupported file type: .{}", ext.to_lowercase())),
            None => invalid(format!(
                "Unsupported file type: {}",
                p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
            )),
        })?;
        let title = p
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "Untitled".into());
        self.import_file_as(space_id, path, &title, path)
    }

    /// Imports a local file but records a different title and origin (e.g. a downloaded cloud file).
    pub fn import_file_as(&self, space_id: &str, path: &str, title: &str, origin: &str) -> AppResult<models::Source> {
        let p = Path::new(path);
        let kind = extract::kind_for_path(p).ok_or_else(|| invalid("Unsupported file type"))?;
        let title = if title.trim().is_empty() { "Untitled" } else { title.trim() };
        let c = self.db.conn()?;
        models::get_space(&c, space_id)?;
        let src = models::insert_source(&c, space_id, title, kind, Some(origin))?;
        if origin != path {
            // the origin isn't a readable file (e.g. a cloud id): keep the downloaded copy for a retry after restart
            c.execute("UPDATE sources SET local_path=?2 WHERE id=?1", rusqlite::params![src.id, path])?;
        }
        self.emit_source(&src);
        self.enqueue(&src.id, Input::File(PathBuf::from(path), kind.into()))?;
        Ok(src)
    }

    pub fn import_text(
        &self,
        space_id: &str,
        title: &str,
        text: &str,
        kind: &str,
        origin: Option<&str>,
    ) -> AppResult<models::Source> {
        if text.trim().is_empty() {
            return Err(invalid("The source is empty"));
        }
        if !TEXT_KINDS.contains(&kind) {
            return Err(invalid(format!("Unknown source type: {kind}")));
        }
        let title = if title.trim().is_empty() { "Untitled" } else { title.trim() };
        let text = extract::normalize_newlines(text);
        let mut c = self.db.conn()?;
        models::get_space(&c, space_id)?;
        let tx = c.transaction()?;
        let src = models::insert_source(&tx, space_id, title, kind, origin)?;
        tx.execute(
            "INSERT INTO source_texts (source_id, text, pages) VALUES (?1, ?2, NULL)",
            rusqlite::params![src.id, text],
        )?;
        tx.commit()?;
        self.emit_source(&src);
        self.enqueue(&src.id, Input::Stored)?;
        Ok(src)
    }

    /// Switches the local embedding model and re-embeds every chunk with it in the background.
    pub fn set_embedding_model(&self, model_id: &str) -> AppResult<()> {
        if !embed::MODELS.iter().any(|m| m.id == model_id) {
            return Err(invalid(format!("Unknown embedding model: {model_id}")));
        }
        models::set_setting(&self.db.conn()?, embed::SETTING_MODEL, &serde_json::json!(model_id))?;
        if self.embedder.switch(model_id) {
            self.tx
                .send(Job::Reembed)
                .map_err(|_| AppError::Other("The import worker stopped. Restart the app.".into()))?;
        }
        Ok(())
    }

    pub fn reindex(&self, id: &str) -> AppResult<models::Source> {
        let c = self.db.conn()?;
        models::get_source(&c, id)?;
        models::set_source_status(&c, id, "processing", None, 0.0)?;
        let src = models::get_source(&c, id)?;
        self.emit_source(&src);
        self.enqueue(id, Input::Stored)?;
        Ok(src)
    }

    /// Re-reads the file from disk into an existing source (its text, chunks and vectors are replaced).
    pub fn reimport_file(&self, id: &str, path: &Path) -> AppResult<models::Source> {
        let kind = extract::kind_for_path(path).ok_or_else(|| invalid("Unsupported file type"))?;
        let c = self.db.conn()?;
        models::get_source(&c, id)?;
        models::set_source_status(&c, id, "processing", None, 0.0)?;
        let src = models::get_source(&c, id)?;
        self.emit_source(&src);
        self.enqueue(id, Input::File(path.to_path_buf(), kind.into()))?;
        Ok(src)
    }

    /// Blocking: embeds the query with the shared model when it's ready. Call via spawn_blocking.
    pub fn search(
        &self,
        space_id: &str,
        query: &str,
        limit: usize,
        source_ids: Option<&[String]>,
    ) -> AppResult<Vec<SearchHit>> {
        let qv = match self.embedder.current() {
            Some(m) if !query.trim().is_empty() => match m.embed_queries(&[query.to_string()]) {
                Ok(mut v) => v.pop(),
                Err(e) => {
                    log::warn!("query embedding failed, using FTS only: {e}");
                    None
                }
            },
            _ => None,
        };
        let c = self.db.conn()?;
        retrieval::search(&c, space_id, query, qv.as_deref(), limit, source_ids)
    }
}

impl Ingest {
    /// Blocking: embeds all topics in one batch when the model is ready. Call via spawn_blocking.
    pub fn coverage(&self, space_id: &str, topics: &[retrieval::TopicInput]) -> AppResult<Vec<retrieval::TopicCoverage>> {
        let vecs = match self.embedder.current() {
            Some(m) if !topics.is_empty() => {
                let texts: Vec<String> = topics.iter().map(|t| t.text.clone()).collect();
                m.embed_queries(&texts).map_err(|e| log::warn!("topic embedding failed, keyword coverage only: {e}")).ok()
            }
            _ => None,
        };
        let c = self.db.conn()?;
        let spec = embed::spec(&self.embedder.model_id());
        let mut out = retrieval::coverage(&c, space_id, topics, vecs.as_deref())?;
        for t in &mut out {
            t.similarity = t.similarity.map(|s| spec.calibrated(s));
        }
        Ok(out)
    }
}

pub fn start(app: &AppHandle, db: Db, data_dir: PathBuf) {
    let handle = app.clone();
    let emit: Emit = Arc::new(move |event: &str, payload: serde_json::Value| {
        let _ = handle.emit(event, payload);
    });
    let model_id = db
        .conn()
        .ok()
        .and_then(|c| models::get_setting(&c, embed::SETTING_MODEL).ok().flatten())
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| embed::DEFAULT_MODEL.to_string());
    let embedder = Arc::new(EmbedderService::new(data_dir.join("models"), &model_id, emit.clone()));
    match Ingest::spawn(db, embedder, emit) {
        Ok(ingest) => {
            app.manage(ingest);
        }
        Err(e) => log::error!("couldn't start the ingest worker: {e}"),
    }
}

#[cfg(test)]
pub mod tests {
    use super::embed::FakeEmbedder;
    use super::*;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    pub type Events = Arc<Mutex<Vec<(String, serde_json::Value)>>>;

    pub fn setup(embedder: Option<Arc<dyn embed::Embedder>>) -> (Ingest, Db, tempfile::TempDir, Events, String) {
        let (db, dir) = crate::db::test_db();
        let events: Events = Arc::new(Mutex::new(Vec::new()));
        let ev = events.clone();
        let emit: Emit = Arc::new(move |e: &str, p| ev.lock().unwrap().push((e.to_string(), p)));
        let svc = Arc::new(match embedder {
            Some(m) => EmbedderService::ready(m, emit.clone()),
            None => EmbedderService::unavailable(emit.clone()),
        });
        let space = models::create_space(
            &db.conn().unwrap(),
            models::SpacePatch { name: Some("S".into()), ..Default::default() },
        )
        .unwrap()
        .id;
        let ing = Ingest::spawn(db.clone(), svc, emit).unwrap();
        (ing, db, dir, events, space)
    }

    pub fn wait_status(db: &Db, id: &str, status: &str) -> models::Source {
        let t = Instant::now();
        loop {
            let s = models::get_source(&db.conn().unwrap(), id).unwrap();
            if s.status == status {
                return s;
            }
            assert!(t.elapsed() < Duration::from_secs(20), "timed out, source is {s:?}");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn vec_count(db: &Db, source_id: &str) -> i64 {
        db.conn()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM vec_chunks WHERE chunk_id IN (SELECT id FROM chunks WHERE source_id = ?1)",
                [source_id],
                |r| r.get(0),
            )
            .unwrap()
    }

    #[test]
    fn switching_the_embedding_model_drops_old_vectors() {
        let (ing, db, _d, events, space) = setup(Some(Arc::new(FakeEmbedder)));
        let src = ing.import_text(&space, "Notes", "Photosynthese im Blatt.\n\nLicht wird zu Zucker.", "text", None).unwrap();
        let done = wait_status(&db, &src.id, "ready");
        assert_eq!(vec_count(&db, &src.id), done.chunk_count);
        assert!(ing.set_embedding_model("nope").is_err());
        ing.set_embedding_model("multilingual-e5-small").unwrap();
        assert_eq!(ing.embedder.model_id(), "multilingual-e5-small");
        let t = Instant::now();
        while vec_count(&db, &src.id) > 0 {
            assert!(t.elapsed() < Duration::from_secs(10), "old vectors kept");
            std::thread::sleep(Duration::from_millis(20));
        }
        let c = db.conn().unwrap();
        assert_eq!(models::get_setting(&c, embed::SETTING_MODEL).unwrap(), Some(serde_json::json!("multilingual-e5-small")));
        assert_eq!(models::get_setting(&c, embed::SETTING_INDEX_MODEL).unwrap(), Some(serde_json::json!("multilingual-e5-small")));
        assert_eq!(ing.embedder.status().model, "multilingual-e5-small");
        // no model available in tests: search falls back to keywords instead of failing
        assert!(ing.search(&space, "Photosynthese", 4, None).unwrap()[0].text.contains("Photosynthese"));
        assert!(events.lock().unwrap().iter().any(|(e, p)| e == "embedder://status" && p["model"] == "multilingual-e5-small"));
    }

    #[test]
    fn import_text_end_to_end() {
        let (ing, db, _d, events, space) = setup(Some(Arc::new(FakeEmbedder)));
        let mut text = String::from("# Zellen\n\nChlorophyll absorbiert Licht 🌿.\n\n");
        for i in 0..60 {
            text.push_str(&format!("Absatz {i} über Photosynthese und Grüße aus dem Blatt.\r\n\r\n"));
        }
        let src = ing.import_text(&space, "Bio notes", &text, "text", Some("paste")).unwrap();
        assert_eq!(src.status, "processing");
        let done = wait_status(&db, &src.id, "ready");
        assert!(done.chunk_count >= 3);
        assert_eq!(done.progress, 1.0);
        let stored = models::get_source_text(&db.conn().unwrap(), &src.id).unwrap();
        assert!(!stored.text.contains('\r'));
        assert_eq!(done.char_count as usize, chunk::utf16_len(&stored.text));
        assert_eq!(vec_count(&db, &src.id), done.chunk_count);

        let c = db.conn().unwrap();
        let mut st = c.prepare("SELECT text, start_offset, end_offset, heading FROM chunks WHERE source_id=?1").unwrap();
        let rows: Vec<(String, i64, i64, Option<String>)> = st
            .query_map([&src.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        for (t, s, e, h) in rows {
            assert_eq!(chunk::utf16_slice(&stored.text, s as usize, e as usize), t);
            assert_eq!(h.as_deref(), Some("Zellen"));
        }

        let hits = ing.search(&space, "chlorophyll", 8, None).unwrap();
        assert!(hits[0].text.contains("Chlorophyll"));

        let ev = events.lock().unwrap();
        let updates: Vec<&serde_json::Value> =
            ev.iter().filter(|(e, _)| e == "source://updated").map(|(_, p)| p).collect();
        assert_eq!(updates.first().unwrap()["status"], "processing");
        assert_eq!(updates.last().unwrap()["status"], "ready");
        assert_eq!(updates.last().unwrap()["spaceId"], space.as_str());
        drop(ev);

        // reindex replaces chunks instead of duplicating them
        ing.reindex(&src.id).unwrap();
        let again = wait_status(&db, &src.id, "ready");
        assert_eq!(again.chunk_count, done.chunk_count);
        let n: i64 = c.query_row("SELECT count(*) FROM chunks WHERE source_id=?1", [&src.id], |r| r.get(0)).unwrap();
        assert_eq!(n, done.chunk_count);
        assert_eq!(vec_count(&db, &src.id), done.chunk_count);
    }

    #[test]
    fn import_file_kinds_errors_and_retry() {
        let (ing, db, dir, _events, space) = setup(Some(Arc::new(FakeEmbedder)));
        let e = ing.import_file(&space, "/tmp/x.xyz").unwrap_err();
        assert_eq!(e.to_string(), "Unsupported file type: .xyz");
        assert!(ing.import_text(&space, "t", "   ", "text", None).is_err());
        assert!(ing.import_text("nope", "t", "x", "text", None).is_err());

        let docx = dir.path().join("Plant Biology.docx");
        std::fs::write(&docx, extract::tests::sample_docx()).unwrap();
        let s = ing.import_file(&space, docx.to_str().unwrap()).unwrap();
        assert_eq!((s.title.as_str(), s.kind.as_str()), ("Plant Biology", "docx"));
        let s = wait_status(&db, &s.id, "ready");
        assert!(s.chunk_count >= 1);

        let pdf = dir.path().join("paper.pdf");
        std::fs::write(&pdf, extract::tests::sample_pdf()).unwrap();
        let s = ing.import_file(&space, pdf.to_str().unwrap()).unwrap();
        wait_status(&db, &s.id, "ready");
        let pages: Vec<Option<i64>> = db
            .conn()
            .unwrap()
            .prepare("SELECT page FROM chunks WHERE source_id=?1")
            .unwrap()
            .query_map([&s.id], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(pages, vec![Some(1)]);
        let st = models::get_source_text(&db.conn().unwrap(), &s.id).unwrap();
        assert_eq!(st.pages.unwrap()[2][0], 3);

        let broken = dir.path().join("broken.epub");
        std::fs::write(&broken, b"nope").unwrap();
        let s = ing.import_file(&space, broken.to_str().unwrap()).unwrap();
        let s = wait_status(&db, &s.id, "error");
        assert!(s.error.unwrap().starts_with("Couldn't read this EPUB"));

        // retry after fixing the file
        std::fs::write(&broken, extract::tests::sample_epub()).unwrap();
        ing.reindex(&s.id).unwrap();
        let s = wait_status(&db, &s.id, "ready");
        assert!(s.error.is_none());
    }

    #[test]
    fn without_model_sources_are_ready_and_fts_works() {
        let (ing, db, _d, _events, space) = setup(None);
        let src = ing.import_text(&space, "t", "Mitochondria are the powerhouse.", "markdown", None).unwrap();
        let s = wait_status(&db, &src.id, "ready");
        assert_eq!(vec_count(&db, &src.id), 0);
        assert_eq!(s.chunk_count, 1);
        let hits = ing.search(&space, "powerhouse", 8, None).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(ing.embedder.status().state, "missing");
    }

    #[test]
    fn processing_sources_resume_on_startup() {
        let (db, _d) = crate::db::test_db();
        let c = db.conn().unwrap();
        let space =
            models::create_space(&c, models::SpacePatch { name: Some("S".into()), ..Default::default() }).unwrap().id;
        let src = models::insert_source(&c, &space, "Half done", "text", None).unwrap();
        c.execute("INSERT INTO source_texts (source_id, text) VALUES (?1, 'Resumed text body.')", [&src.id]).unwrap();
        let orphan = models::insert_source(&c, &space, "No text", "url", Some("https://x")).unwrap();
        let emit: Emit = Arc::new(|_, _| {});
        let svc = Arc::new(EmbedderService::ready(Arc::new(FakeEmbedder), emit.clone()));
        let _ing = Ingest::spawn(db.clone(), svc, emit).unwrap();
        assert_eq!(wait_status(&db, &src.id, "ready").chunk_count, 1);
        let o = wait_status(&db, &orphan.id, "error");
        assert!(o.error.unwrap().contains("missing"));
    }

    #[test]
    fn cloud_import_still_processing_resumes_from_the_downloaded_copy() {
        let (db, dir) = crate::db::test_db();
        let file = dir.path().join("notes.md");
        std::fs::write(&file, "# Cells\n\nMitochondria make ATP.").unwrap();
        let space = {
            let c = db.conn().unwrap();
            models::create_space(&c, models::SpacePatch { name: Some("S".into()), ..Default::default() }).unwrap().id
        };
        let emit: Emit = Arc::new(|_, _| {});
        // a worker that never runs stands in for the app quitting before the job started
        let (tx, _rx) = channel();
        let svc = Arc::new(EmbedderService::ready(Arc::new(FakeEmbedder), emit.clone()));
        let dead = Ingest { db: db.clone(), tx, embedder: svc.clone(), emit: emit.clone() };
        let src = dead.import_file_as(&space, &file.to_string_lossy(), "Cells", "gdrive://abc").unwrap();
        assert_eq!(models::get_source(&db.conn().unwrap(), &src.id).unwrap().status, "processing");

        let _ing = Ingest::spawn(db.clone(), svc, emit).unwrap();
        let s = wait_status(&db, &src.id, "ready");
        assert_eq!(s.origin.as_deref(), Some("gdrive://abc"));
        assert!(s.chunk_count >= 1);
    }
}
