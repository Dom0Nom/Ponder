//! Hybrid search: FTS5 bm25 + sqlite-vec KNN, fused with Reciprocal Rank Fusion.

use crate::error::{AppError, AppResult};
use rusqlite::OptionalExtension;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const CANDIDATES: usize = 40;
const RRF_K: f64 = 60.0;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub chunk_id: i64,
    pub source_id: String,
    pub source_title: String,
    pub text: String,
    pub start: i64,
    pub end: i64,
    pub page: Option<i64>,
    pub score: f64,
}

/// Word tokens, each quoted, joined with OR. None when there are no tokens.
pub fn fts_query(q: &str) -> Option<String> {
    let toks: Vec<String> = q
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .take(32)
        .map(|t| format!("\"{t}\""))
        .collect();
    if toks.is_empty() {
        None
    } else {
        Some(toks.join(" OR "))
    }
}

pub fn vec_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|f| f.to_le_bytes()).collect()
}

/// Size of the vectors the index holds; it follows the embedding model.
pub fn vec_dims(c: &Connection) -> AppResult<usize> {
    let sql: String = c.query_row(
        "SELECT sql FROM sqlite_master WHERE name = 'vec_chunks'",
        [],
        |r| r.get(0),
    )?;
    sql.split("float[")
        .nth(1)
        .and_then(|r| r.split(']').next())
        .and_then(|n| n.trim().parse().ok())
        .ok_or_else(|| AppError::Other("The vector index has an unexpected layout.".into()))
}

/// Replaces the vector index with an empty one for vectors of `dims` numbers.
pub fn reset_vec_table(c: &Connection, dims: usize) -> AppResult<()> {
    let tx = c.unchecked_transaction()?;
    tx.execute_batch(&format!(
        "DROP TABLE vec_chunks;
         CREATE VIRTUAL TABLE vec_chunks USING vec0(
           chunk_id INTEGER PRIMARY KEY,
           space_id TEXT PARTITION KEY,
           embedding float[{dims}] distance_metric=cosine
         );"
    ))?;
    tx.commit()?;
    Ok(())
}

fn source_filter_json(source_ids: Option<&[String]>) -> Option<String> {
    source_ids.map(|ids| serde_json::to_string(ids).unwrap_or_else(|_| "[]".into()))
}

fn fts_ranked(
    c: &Connection,
    space_id: &str,
    q: &str,
    filter: &Option<String>,
) -> AppResult<Vec<i64>> {
    let Some(m) = fts_query(q) else {
        return Ok(vec![]);
    };
    let mut st = c.prepare_cached(
        "SELECT c.id FROM chunks_fts f
         JOIN chunks c ON c.id = f.rowid
         JOIN sources s ON s.id = c.source_id
         WHERE chunks_fts MATCH ?1 AND c.space_id = ?2 AND s.use_in_chat = 1
           AND (?3 IS NULL OR c.source_id IN (SELECT value FROM json_each(?3)))
         ORDER BY bm25(chunks_fts) LIMIT ?4",
    )?;
    let rows = st.query_map(params![m, space_id, filter, CANDIDATES as i64], |r| {
        r.get(0)
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn vec_ranked(
    c: &Connection,
    space_id: &str,
    qv: &[f32],
    filter: &Option<String>,
) -> AppResult<Vec<i64>> {
    // over-fetch because use_in_chat / source filters are applied after the KNN
    let k = if filter.is_some() {
        CANDIDATES * 5
    } else {
        CANDIDATES * 2
    };
    let mut st = c.prepare_cached(
        "SELECT v.chunk_id FROM (
            SELECT chunk_id, distance FROM vec_chunks
            WHERE embedding MATCH ?1 AND k = ?2 AND space_id = ?3
         ) v
         JOIN chunks c ON c.id = v.chunk_id
         JOIN sources s ON s.id = c.source_id
         WHERE s.use_in_chat = 1
           AND (?4 IS NULL OR c.source_id IN (SELECT value FROM json_each(?4)))
         ORDER BY v.distance LIMIT ?5",
    )?;
    let rows = st.query_map(
        params![vec_blob(qv), k as i64, space_id, filter, CANDIDATES as i64],
        |r| r.get(0),
    )?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn rrf(lists: &[Vec<i64>]) -> Vec<(i64, f64)> {
    let mut scores: HashMap<i64, f64> = HashMap::new();
    for list in lists {
        for (rank, id) in list.iter().enumerate() {
            *scores.entry(*id).or_default() += 1.0 / (RRF_K + rank as f64 + 1.0);
        }
    }
    let mut out: Vec<(i64, f64)> = scores.into_iter().collect();
    out.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    out
}

/// `source_ids`: None = all sources in the space; Some(empty) = nothing.
pub fn search(
    c: &Connection,
    space_id: &str,
    query: &str,
    query_vec: Option<&[f32]>,
    limit: usize,
    source_ids: Option<&[String]>,
) -> AppResult<Vec<SearchHit>> {
    if limit == 0 || source_ids.map(|s| s.is_empty()).unwrap_or(false) {
        return Ok(vec![]);
    }
    let filter = source_filter_json(source_ids);
    let mut lists = vec![fts_ranked(c, space_id, query, &filter)?];
    if let Some(qv) = query_vec {
        lists.push(vec_ranked(c, space_id, qv, &filter)?);
    }
    let fused = rrf(&lists);
    let mut st = c.prepare_cached(
        "SELECT c.source_id, s.title, c.text, c.start_offset, c.end_offset, c.page
         FROM chunks c JOIN sources s ON s.id = c.source_id WHERE c.id = ?1",
    )?;
    let mut hits = Vec::new();
    for (id, score) in fused.into_iter().take(limit) {
        let hit = st.query_row([id], |r| {
            Ok(SearchHit {
                chunk_id: id,
                source_id: r.get(0)?,
                source_title: r.get(1)?,
                text: r.get(2)?,
                start: r.get(3)?,
                end: r.get(4)?,
                page: r.get(5)?,
                score,
            })
        });
        match hit {
            Ok(h) => hits.push(h),
            Err(rusqlite::Error::QueryReturnedNoRows) => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(hits)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TopicInput {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TopicCoverage {
    pub topic_id: String,
    /// cosine similarity of the closest chunk (None without embeddings)
    pub similarity: Option<f64>,
    /// chunks containing every significant word of the topic
    pub keyword_hits: i64,
    pub best: Option<SearchHit>,
}

/// Every word token quoted and AND-ed, for "does the space mention all of these" counts.
fn fts_all_words(q: &str) -> Option<String> {
    let toks: Vec<String> = q
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.chars().count() >= 4)
        .take(8)
        .map(|t| format!("\"{t}\""))
        .collect();
    (!toks.is_empty()).then(|| toks.join(" AND "))
}

/// How well each topic is covered by the space's ready sources, regardless of "use in chat".
pub fn coverage(
    c: &Connection,
    space_id: &str,
    topics: &[TopicInput],
    vectors: Option<&[Vec<f32>]>,
) -> AppResult<Vec<TopicCoverage>> {
    let mut knn = c.prepare_cached(
        "SELECT chunk_id, distance FROM vec_chunks WHERE embedding MATCH ?1 AND k = 1 AND space_id = ?2",
    )?;
    let mut count = c.prepare_cached(
        "SELECT count(*) FROM chunks_fts f JOIN chunks c ON c.id = f.rowid WHERE chunks_fts MATCH ?1 AND c.space_id = ?2",
    )?;
    let mut chunk = c.prepare_cached(
        "SELECT c.source_id, s.title, c.text, c.start_offset, c.end_offset, c.page
         FROM chunks c JOIN sources s ON s.id = c.source_id WHERE c.id = ?1",
    )?;
    let mut out = Vec::with_capacity(topics.len());
    for (i, t) in topics.iter().enumerate() {
        let keyword_hits: i64 = match fts_all_words(&t.text) {
            Some(q) => count
                .query_row(params![q, space_id], |r| r.get(0))
                .unwrap_or(0),
            None => 0,
        };
        let mut similarity = None;
        let mut best = None;
        if let Some(v) = vectors.and_then(|vs| vs.get(i)) {
            let hit: Option<(i64, f64)> = knn
                .query_row(params![vec_blob(v), space_id], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })
                .optional()?;
            if let Some((id, dist)) = hit {
                similarity = Some(1.0 - dist);
                best = chunk
                    .query_row([id], |r| {
                        Ok(SearchHit {
                            chunk_id: id,
                            source_id: r.get(0)?,
                            source_title: r.get(1)?,
                            text: r.get(2)?,
                            start: r.get(3)?,
                            end: r.get(4)?,
                            page: r.get(5)?,
                            score: 1.0 - dist,
                        })
                    })
                    .optional()?;
            }
        }
        out.push(TopicCoverage {
            topic_id: t.id.clone(),
            similarity,
            keyword_hits,
            best,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{models, test_db, Db};
    use crate::ingest::embed::{fake_vector, EmbedderService, FakeEmbedder};
    use crate::ingest::worker::{Input, Worker};
    use std::sync::Arc;

    fn setup() -> (Db, tempfile::TempDir, Worker) {
        let (db, dir) = test_db();
        let emb = Arc::new(EmbedderService::ready(
            Arc::new(FakeEmbedder),
            Arc::new(|_, _| {}),
        ));
        let w = Worker::new(db.clone(), emb, Arc::new(|_, _| {}), Default::default());
        (db, dir, w)
    }

    fn space(db: &Db, name: &str) -> String {
        models::create_space(
            &db.conn().unwrap(),
            models::SpacePatch {
                name: Some(name.into()),
                ..Default::default()
            },
        )
        .unwrap()
        .id
    }

    fn add(db: &Db, w: &mut Worker, space: &str, title: &str, text: &str) -> String {
        let c = db.conn().unwrap();
        let s = models::insert_source(&c, space, title, "text", None).unwrap();
        w.process(&s.id, Input::Text(text.into()));
        assert_eq!(models::get_source(&c, &s.id).unwrap().status, "ready");
        s.id
    }

    fn count(c: &Connection, sql: &str, p: impl rusqlite::Params) -> i64 {
        c.query_row(sql, p, |r| r.get(0)).unwrap()
    }

    struct Small;
    impl crate::ingest::embed::Embedder for Small {
        fn embed(&self, texts: &[String]) -> AppResult<Vec<Vec<f32>>> {
            Ok(texts.iter().map(|t| fake_vector(t)[..8].to_vec()).collect())
        }
        fn dims(&self) -> usize {
            8
        }
    }

    #[test]
    fn the_index_follows_the_model_vector_size() {
        let (db, _d, mut w) = setup();
        let sp = space(&db, "S");
        add(&db, &mut w, &sp, "A", "Zellen und Licht im Blatt.");
        let c = db.conn().unwrap();
        assert_eq!(vec_dims(&c).unwrap(), 384);
        let emb = Arc::new(EmbedderService::ready(Arc::new(Small), Arc::new(|_, _| {})));
        let mut w = Worker::new(db.clone(), emb, Arc::new(|_, _| {}), Default::default());
        add(&db, &mut w, &sp, "B", "Kräfte und Energie.");
        assert_eq!(vec_dims(&c).unwrap(), 8);
        // A's vectors went with the old table and were made again with the new model
        assert_eq!(
            count(&c, "SELECT count(*) FROM vec_chunks", []),
            count(&c, "SELECT count(*) FROM chunks", [])
        );
        assert!(!search(
            &c,
            &sp,
            "Energie",
            Some(&fake_vector("Energie")[..8]),
            4,
            None
        )
        .unwrap()
        .is_empty());
        // the chunk delete trigger still works against the new table
        c.execute("DELETE FROM sources", []).unwrap();
        assert_eq!(count(&c, "SELECT count(*) FROM vec_chunks", []), 0);
    }

    #[test]
    fn sanitizes_fts_queries() {
        assert_eq!(fts_query("  "), None);
        assert_eq!(fts_query("\"*()"), None);
        assert_eq!(
            fts_query("what's NEAR(x) Grüße?").unwrap(),
            "\"what\" OR \"s\" OR \"NEAR\" OR \"x\" OR \"Grüße\""
        );
    }

    #[test]
    fn rrf_prefers_items_in_both_lists() {
        let fused = rrf(&[vec![1, 2, 3], vec![3, 4]]);
        assert_eq!(fused[0].0, 3);
        assert_eq!(fused.len(), 4);
    }

    #[test]
    fn vec_partition_key_is_respected() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let ins = "INSERT INTO vec_chunks(chunk_id, space_id, embedding) VALUES (?1, ?2, ?3)";
        c.execute(ins, params![1, "space-a", vec_blob(&fake_vector("apple"))])
            .unwrap();
        c.execute(ins, params![2, "space-b", vec_blob(&fake_vector("apple"))])
            .unwrap();
        c.execute(
            ins,
            params![3, "space-a", vec_blob(&fake_vector("tax law"))],
        )
        .unwrap();
        let mut st = c
            .prepare("SELECT chunk_id FROM vec_chunks WHERE embedding MATCH ?1 AND k = 10 AND space_id = ?2 ORDER BY distance")
            .unwrap();
        let ids: Vec<i64> = st
            .query_map(params![vec_blob(&fake_vector("apple")), "space-a"], |r| {
                r.get(0)
            })
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(ids, vec![1, 3]);
    }

    #[test]
    fn hybrid_search_ranks_filters_and_isolates_spaces() {
        let (db, _d, mut w) = setup();
        let a = space(&db, "Bio");
        let b = space(&db, "Other");
        let bio = add(
            &db,
            &mut w,
            &a,
            "Plants",
            "Chlorophyll absorbs light in the chloroplasts of leaves.",
        );
        let tax = add(
            &db,
            &mut w,
            &a,
            "Taxes",
            "Capital gains are taxed at a reduced rate after one year.",
        );
        let _other = add(
            &db,
            &mut w,
            &b,
            "Elsewhere",
            "Chlorophyll chlorophyll chlorophyll everywhere.",
        );
        let c = db.conn().unwrap();
        let qv = fake_vector("chlorophyll");

        let hits = search(&c, &a, "chlorophyll?", Some(&qv), 8, None).unwrap();
        assert_eq!(hits[0].source_id, bio);
        assert_eq!(hits[0].source_title, "Plants");
        assert!(hits
            .iter()
            .all(|h| h.source_id == bio || h.source_id == tax));
        assert!(hits[0].score > 0.0);

        // FTS only
        let hits = search(&c, &a, "chlorophyll", None, 8, None).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].source_id, bio);

        // vector only (no word tokens)
        let hits = search(
            &c,
            &a,
            "",
            Some(&fake_vector("capital gains taxed")),
            1,
            None,
        )
        .unwrap();
        assert_eq!(hits[0].source_id, tax);

        // source filter
        let only_tax = vec![tax.clone()];
        let hits = search(&c, &a, "chlorophyll", Some(&qv), 8, Some(&only_tax)).unwrap();
        assert!(hits.iter().all(|h| h.source_id == tax));
        assert!(search(&c, &a, "chlorophyll", Some(&qv), 8, Some(&[]))
            .unwrap()
            .is_empty());

        // disabled sources are excluded
        models::update_source(
            &c,
            &bio,
            models::SourcePatch {
                use_in_chat: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
        let hits = search(&c, &a, "chlorophyll", Some(&qv), 8, None).unwrap();
        assert!(hits.iter().all(|h| h.source_id != bio));
    }

    #[test]
    fn deleting_a_source_removes_chunks_fts_and_vectors() {
        let (db, _d, mut w) = setup();
        let a = space(&db, "Bio");
        let bio = add(
            &db,
            &mut w,
            &a,
            "Plants",
            "Chlorophyll absorbs light.\n\nMitochondria make energy.",
        );
        let c = db.conn().unwrap();
        let ids: Vec<i64> = c
            .prepare("SELECT id FROM chunks WHERE source_id = ?1")
            .unwrap()
            .query_map([&bio], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert!(!ids.is_empty());
        assert_eq!(
            count(
                &c,
                "SELECT count(*) FROM vec_chunks WHERE chunk_id = ?1",
                [ids[0]]
            ),
            1
        );
        assert_eq!(
            count(
                &c,
                "SELECT count(*) FROM chunks_fts WHERE chunks_fts MATCH 'chlorophyll'",
                []
            ),
            1
        );

        models::delete_source(&c, &bio).unwrap();
        assert_eq!(
            count(
                &c,
                "SELECT count(*) FROM chunks WHERE source_id = ?1",
                [&bio]
            ),
            0
        );
        assert_eq!(
            count(
                &c,
                "SELECT count(*) FROM chunks_fts WHERE chunks_fts MATCH 'chlorophyll'",
                []
            ),
            0
        );
        assert_eq!(count(&c, "SELECT count(*) FROM vec_chunks", []), 0);
        assert!(search(
            &c,
            &a,
            "chlorophyll",
            Some(&fake_vector("chlorophyll")),
            8,
            None
        )
        .unwrap()
        .is_empty());
    }

    #[test]
    fn coverage_scores_topics_against_the_space() {
        let (db, _d, mut w) = setup();
        let sp = space(&db, "Bio");
        let other = space(&db, "Other");
        add(&db, &mut w, &sp, "Notes", "Photosynthesis converts light energy in chloroplasts.\n\nGlycolysis splits glucose in the cytoplasm.");
        add(
            &db,
            &mut w,
            &other,
            "Tax",
            "Income tax brackets and deductions.",
        );
        let topics = vec![
            TopicInput {
                id: "photo".into(),
                text: "photosynthesis chloroplasts light".into(),
            },
            TopicInput {
                id: "tax".into(),
                text: "income tax deductions".into(),
            },
        ];
        let vecs: Vec<Vec<f32>> = topics.iter().map(|t| fake_vector(&t.text)).collect();
        let c = db.conn().unwrap();
        let cov = coverage(&c, &sp, &topics, Some(&vecs)).unwrap();
        assert_eq!(cov[0].topic_id, "photo");
        assert!(cov[0].keyword_hits >= 1);
        assert!(cov[0].similarity.unwrap() > cov[1].similarity.unwrap_or(0.0));
        assert_eq!(cov[0].best.as_ref().unwrap().source_title, "Notes");
        assert_eq!(
            cov[1].keyword_hits, 0,
            "other space's chunks must not count"
        );
        let no_vec = coverage(&c, &sp, &topics, None).unwrap();
        assert!(no_vec[0].similarity.is_none() && no_vec[0].keyword_hits >= 1);
    }
}
