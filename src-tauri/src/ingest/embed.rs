//! Sentence embeddings: local BERT-style models via candle (384 dims), or any embedding model on
//! OpenRouter (its own size). Also the model lifecycle.

use super::Emit;
use crate::error::{AppError, AppResult};
use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokenizers::{Tokenizer, TruncationParams};

/// Size of the local models' vectors.
pub const DIMS: usize = 384;

/// A downloadable local embedding model. Both output 384-dim vectors.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSpec {
    pub id: &'static str,
    #[serde(skip)]
    pub url: &'static str,
    /// (file, approximate size for progress weighting)
    #[serde(skip)]
    pub files: &'static [(&'static str, u64)],
    #[serde(skip)]
    pub query_prefix: &'static str,
    #[serde(skip)]
    pub passage_prefix: &'static str,
    pub size_mb: u32,
    pub multilingual: bool,
    /// Linear map from this model's cosine to the all-MiniLM-L6-v2 scale the coverage thresholds
    /// use (see real_model_coverage_calibration): (scale, offset).
    #[serde(skip)]
    pub sim_map: (f64, f64),
}

/// Maps a model's cosine to the all-MiniLM-L6-v2 scale with a (scale, offset) map.
pub fn calibrated(map: (f64, f64), sim: f64) -> f64 {
    sim * map.0 + map.1
}

pub const MODELS: &[ModelSpec] = &[
    ModelSpec {
        id: "all-MiniLM-L6-v2",
        url: "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main",
        files: &[
            ("config.json", 612),
            ("tokenizer.json", 466_247),
            ("model.safetensors", 90_868_376),
        ],
        query_prefix: "",
        passage_prefix: "",
        size_mb: 91,
        multilingual: false,
        sim_map: (1.0, 0.0),
    },
    ModelSpec {
        id: "multilingual-e5-small",
        url: "https://huggingface.co/intfloat/multilingual-e5-small/resolve/main",
        files: &[
            ("config.json", 655),
            ("tokenizer.json", 17_082_730),
            ("model.safetensors", 470_641_600),
        ],
        query_prefix: "query: ",
        passage_prefix: "passage: ",
        size_mb: 488,
        multilingual: true,
        // related-but-off-topic ≈ 0.80 → 0.15, on-topic ≈ 0.885 → 0.62
        sim_map: (5.53, -4.274),
    },
];

/// Model ids for OpenRouter models are this prefix plus the OpenRouter id.
pub const REMOTE_PREFIX: &str = "openrouter:";
const OPENROUTER_EMBEDDINGS: &str = "https://openrouter.ai/api/v1/embeddings";
/// Texts per remote request, and requests sent at once per batch.
const REMOTE_BATCH: usize = 64;
const REMOTE_PARALLEL: usize = 4;
const REMOTE_TRIES: u32 = 4;
/// Vector size asked of models that can shorten their vectors: keeps the index small and KNN fast.
const REMOTE_DIMS: usize = 768;

pub fn remote_model(id: &str) -> Option<&str> {
    id.strip_prefix(REMOTE_PREFIX)
        .map(str::trim)
        .filter(|m| !m.is_empty())
}

pub fn is_known_model(id: &str) -> bool {
    MODELS.iter().any(|m| m.id == id) || remote_model(id).is_some()
}

/// Families trained to be cut short (Matryoshka); others keep their own size.
fn shortenable(model: &str) -> bool {
    [
        "openai/text-embedding-3",
        "qwen/qwen3-embedding",
        "google/gemini-embedding",
        "voyageai/",
        "mistralai/codestral-embed",
        "perplexity/pplx-embed",
    ]
    .iter()
    .any(|p| model.starts_with(p))
}

/// (query, passage) prefixes the model family was trained with.
fn remote_prefixes(model: &str) -> (&'static str, &'static str) {
    if model.starts_with("qwen/qwen3-embedding") {
        ("Instruct: Given a question or topic, retrieve passages from study material that cover it\nQuery: ", "")
    } else if model.contains("/e5-") || model.contains("multilingual-e5") {
        ("query: ", "passage: ")
    } else if model.starts_with("baai/bge-") && model.ends_with("en-v1.5") {
        (
            "Represent this sentence for searching relevant passages: ",
            "",
        )
    } else {
        ("", "")
    }
}

/// Texts for calibrating a model's similarities to the all-MiniLM-L6-v2 scale the coverage
/// thresholds use. ON pairs are (topic, chunk) indexes that belong together.
const CAL_TOPICS: [&str; 3] = [
    "Percents: percent of a number, percent change, interest, discounts",
    "Life science: cells, human body systems, health, genetics and heredity, evolution, ecosystems",
    "Datenbanken und SQL: ER-Modell, Normalisierung, SELECT, JOIN, GROUP BY, Transaktionen",
];
const CAL_CHUNKS: [(&str, &str); 6] = [
    ("percents on-topic", "To find a percent of a number, change the percent to a decimal and multiply. For example, 15% of 80 is 0.15 x 80 = 12. Percent change compares the change to the original amount: if a price rises from $40 to $50, the increase is 10/40 = 25%. A store discount of 20% on a $60 jacket saves $12."),
    ("geometry same-subject", "The area of a rectangle is length times width. The circumference of a circle is 2 pi r and its area is pi r squared. In a right triangle, the Pythagorean theorem says a squared plus b squared equals c squared."),
    ("cells on-topic", "All living things are made of cells. The nucleus holds DNA, which carries the genes passed from parents to offspring. Organs such as the heart and lungs work together in body systems, and natural selection explains how populations evolve over generations."),
    ("physics off-topic", "A force is a push or a pull. Newton's second law says force equals mass times acceleration. Kinetic energy depends on mass and speed, and energy is conserved in a closed system."),
    ("sql on-topic", "Eine relationale Datenbank speichert Daten in Tabellen. Mit SELECT werden Spalten abgefragt, JOIN verknüpft Tabellen über Fremdschlüssel, und GROUP BY fasst Zeilen für Aggregatfunktionen zusammen. Die Normalisierung vermeidet Redundanzen."),
    ("cooking unrelated", "Preheat the oven, whisk the eggs with sugar until fluffy, fold in the flour and bake the cake for thirty minutes until golden."),
];
const CAL_ON: [(usize, usize); 3] = [(0, 0), (1, 2), (2, 4)];
/// all-MiniLM-L6-v2's mean cosine for the ON pairs and for all other pairs.
const CAL_TARGET: (f64, f64) = (0.638, 0.026);

/// The (scale, offset) that moves this model's ON / other means onto CAL_TARGET.
fn calibration_map(topics: &[Vec<f32>], chunks: &[Vec<f32>]) -> (f64, f64) {
    let (mut on, mut off) = (vec![], vec![]);
    for (i, t) in topics.iter().enumerate() {
        for (j, c) in chunks.iter().enumerate() {
            let sim = t.iter().zip(c).map(|(a, b)| (a * b) as f64).sum::<f64>();
            if CAL_ON.contains(&(i, j)) {
                on.push(sim)
            } else {
                off.push(sim)
            }
        }
    }
    let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len().max(1) as f64;
    let (on, off) = (mean(&on), mean(&off));
    if on - off < 0.05 {
        return (1.0, 0.0);
    }
    let scale = (CAL_TARGET.0 - CAL_TARGET.1) / (on - off);
    (scale, CAL_TARGET.0 - scale * on)
}

/// Returns the OpenRouter API key for remote models.
pub type RemoteKey = Arc<dyn Fn() -> AppResult<String> + Send + Sync>;

pub const DEFAULT_MODEL: &str = "all-MiniLM-L6-v2";
/// Settings key for the chosen model.
pub const SETTING_MODEL: &str = "embeddingModel";
/// Settings key for the model the stored vectors were made with.
pub const SETTING_INDEX_MODEL: &str = "embeddingIndexModel";

pub fn spec(id: &str) -> &'static ModelSpec {
    MODELS.iter().find(|m| m.id == id).unwrap_or(&MODELS[0])
}

pub trait Embedder: Send + Sync {
    /// Embeds passages (chunks).
    fn embed(&self, texts: &[String]) -> AppResult<Vec<Vec<f32>>>;
    /// Embeds search queries; models trained with prefixes treat them differently from passages.
    fn embed_queries(&self, texts: &[String]) -> AppResult<Vec<Vec<f32>>> {
        self.embed(texts)
    }
    /// Texts the worker hands over per call.
    fn batch_size(&self) -> usize {
        16
    }
    fn dims(&self) -> usize {
        DIMS
    }
    /// Calibration measured at load time; None means the model spec's.
    fn sim_map(&self) -> Option<(f64, f64)> {
        None
    }
}

fn other<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Other(e.to_string())
}

/// Texts per forward pass. One at a time carries no padding and, run on several threads, keeps
/// every core busy; larger batches were slower on CPU.
const GROUP: usize = 1;
/// Texts the worker hands over per call, so the threads stay fed.
const LOCAL_BATCH: usize = 32;

pub struct BertEmbedder {
    model: BertModel,
    tokenizer: Tokenizer,
    device: Device,
    pad_id: u32,
    group: usize,
    threads: usize,
    query_prefix: &'static str,
    passage_prefix: &'static str,
}

impl BertEmbedder {
    pub fn load(dir: &Path, spec: &ModelSpec) -> AppResult<Self> {
        let device = Device::Cpu;
        let cfg: Config = serde_json::from_str(&std::fs::read_to_string(dir.join("config.json"))?)?;
        let mut tokenizer = Tokenizer::from_file(dir.join("tokenizer.json")).map_err(other)?;
        let pad_id = ["[PAD]", "<pad>"]
            .iter()
            .find_map(|t| tokenizer.token_to_id(t))
            .unwrap_or(0);
        tokenizer
            .with_truncation(Some(TruncationParams {
                max_length: 256,
                ..Default::default()
            }))
            .map_err(other)?;
        // SAFETY: the file is only replaced via atomic rename, never mutated in place.
        let vb = unsafe {
            VarBuilder::from_mmaped_safetensors(
                &[dir.join("model.safetensors")],
                DType::F32,
                &device,
            )
            .map_err(other)?
        };
        let model = BertModel::load(vb, &cfg).map_err(other)?;
        let cpus = std::thread::available_parallelism().map_or(2, |n| n.get());
        Ok(Self {
            model,
            tokenizer,
            device,
            pad_id,
            group: GROUP,
            threads: cpus.saturating_sub(1).clamp(2, 8),
            query_prefix: spec.query_prefix,
            passage_prefix: spec.passage_prefix,
        })
    }

    fn embed_prefixed(&self, prefix: &str, texts: &[String]) -> AppResult<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(vec![]);
        }
        let texts: Vec<String> = if prefix.is_empty() {
            texts.to_vec()
        } else {
            texts.iter().map(|t| format!("{prefix}{t}")).collect()
        };
        self.embed_sorted(texts).map_err(other)
    }

    /// Tokenizes once, groups texts of similar length so batches carry little padding, and runs
    /// the groups on `threads` workers. Output order matches the input.
    fn embed_sorted(&self, texts: Vec<String>) -> candle_core::Result<Vec<Vec<f32>>> {
        let n = texts.len();
        let enc = self
            .tokenizer
            .encode_batch(texts, true)
            .map_err(|e| candle_core::Error::Msg(e.to_string()))?;
        let mut order: Vec<usize> = (0..n).collect();
        order.sort_by_key(|&i| enc[i].get_ids().len());
        let groups: Vec<&[usize]> = order.chunks(self.group).collect();
        let next = AtomicUsize::new(0);
        let results: Mutex<Vec<(usize, Vec<Vec<f32>>)>> = Mutex::new(Vec::new());
        let failure: Mutex<Option<candle_core::Error>> = Mutex::new(None);
        std::thread::scope(|s| {
            for _ in 0..self.threads.min(groups.len()) {
                s.spawn(|| loop {
                    let g = next.fetch_add(1, Ordering::Relaxed);
                    let Some(group) = groups.get(g) else { break };
                    match self.forward_group(&enc, group) {
                        Ok(v) => results.lock().unwrap().push((g, v)),
                        Err(e) => {
                            *failure.lock().unwrap() = Some(e);
                            break;
                        }
                    }
                });
            }
        });
        if let Some(e) = failure.into_inner().unwrap() {
            return Err(e);
        }
        let mut out = vec![Vec::new(); n];
        for (g, vecs) in results.into_inner().unwrap() {
            for (&i, v) in groups[g].iter().zip(vecs) {
                out[i] = v;
            }
        }
        Ok(out)
    }

    fn forward_group(
        &self,
        enc: &[tokenizers::Encoding],
        group: &[usize],
    ) -> candle_core::Result<Vec<Vec<f32>>> {
        let len = group
            .iter()
            .map(|&i| enc[i].get_ids().len())
            .max()
            .unwrap_or(0);
        let mut ids = Vec::with_capacity(group.len() * len);
        let mut mask = Vec::with_capacity(group.len() * len);
        for &i in group {
            let e = &enc[i];
            ids.extend_from_slice(e.get_ids());
            mask.extend_from_slice(e.get_attention_mask());
            let pad = len - e.get_ids().len();
            ids.resize(ids.len() + pad, self.pad_id);
            mask.resize(mask.len() + pad, 0);
        }
        let shape = (group.len(), len);
        let ids = Tensor::from_vec(ids, shape, &self.device)?;
        let mask = Tensor::from_vec(mask, shape, &self.device)?;
        let token_types = ids.zeros_like()?;
        let out = self.model.forward(&ids, &token_types, Some(&mask))?;
        let m = mask.to_dtype(DType::F32)?.unsqueeze(2)?;
        let pooled = out.broadcast_mul(&m)?.sum(1)?.broadcast_div(&m.sum(1)?)?;
        let norm = pooled
            .sqr()?
            .sum_keepdim(1)?
            .sqrt()?
            .clamp(1e-12, f32::MAX)?;
        pooled.broadcast_div(&norm)?.to_vec2::<f32>()
    }
}

impl Embedder for BertEmbedder {
    fn embed(&self, texts: &[String]) -> AppResult<Vec<Vec<f32>>> {
        self.embed_prefixed(self.passage_prefix, texts)
    }
    fn embed_queries(&self, texts: &[String]) -> AppResult<Vec<Vec<f32>>> {
        self.embed_prefixed(self.query_prefix, texts)
    }
    fn batch_size(&self) -> usize {
        LOCAL_BATCH
    }
}

pub struct RemoteEmbedder {
    model: String,
    key: String,
    query_prefix: &'static str,
    passage_prefix: &'static str,
    url: String,
    /// Vector size: learned from the calibration request.
    dims: usize,
    sim_map: (f64, f64),
}

impl RemoteEmbedder {
    fn new(model: &str, key: String, url: &str) -> Self {
        let (query_prefix, passage_prefix) = remote_prefixes(model);
        Self {
            model: model.into(),
            key,
            query_prefix,
            passage_prefix,
            url: url.into(),
            dims: 0,
            sim_map: (1.0, 0.0),
        }
    }

    /// Checks the key and model with one small request that also measures and calibrates the model.
    pub fn connect(model: &str, key: String) -> AppResult<Self> {
        Self::connect_to(model, key, OPENROUTER_EMBEDDINGS)
    }

    fn connect_to(model: &str, key: String, url: &str) -> AppResult<Self> {
        let mut m = Self::new(model, key, url);
        let topics: Vec<String> = CAL_TOPICS
            .iter()
            .map(|t| format!("{}{t}", m.query_prefix))
            .collect();
        let chunks: Vec<String> = CAL_CHUNKS
            .iter()
            .map(|c| format!("{}{}", m.passage_prefix, c.1))
            .collect();
        let v = m.run(&[topics, chunks].concat())?;
        m.dims = v[0].len();
        m.sim_map = calibration_map(&v[..CAL_TOPICS.len()], &v[CAL_TOPICS.len()..]);
        log::info!(
            "embedding model {model}: {} dims, similarity map {:?}",
            m.dims,
            m.sim_map
        );
        Ok(m)
    }

    fn embed_prefixed(&self, prefix: &str, texts: &[String]) -> AppResult<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(vec![]);
        }
        let texts: Vec<String> = texts.iter().map(|t| format!("{prefix}{t}")).collect();
        let v = self.run(&texts)?;
        if v.iter().any(|e| e.len() != self.dims) {
            return Err(AppError::Other(
                "The embedding service changed its vector size.".into(),
            ));
        }
        Ok(v)
    }

    fn run(&self, texts: &[String]) -> AppResult<Vec<Vec<f32>>> {
        // own thread and runtime: callers may already run inside Tokio (search, coverage)
        std::thread::scope(|s| s.spawn(|| self.request(texts)).join())
            .map_err(|_| AppError::Other("The embedding request crashed.".into()))?
    }

    fn request(&self, texts: &[String]) -> AppResult<Vec<Vec<f32>>> {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(other)?;
        rt.block_on(async {
            let client = reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(20))
                .timeout(Duration::from_secs(120))
                .build()
                .map_err(other)?;
            let parts = futures_util::future::join_all(
                texts.chunks(REMOTE_BATCH).map(|p| self.post(&client, p)),
            )
            .await;
            let mut out = Vec::with_capacity(texts.len());
            for p in parts {
                out.extend(p?);
            }
            Ok(out)
        })
    }

    async fn post(&self, client: &reqwest::Client, texts: &[String]) -> AppResult<Vec<Vec<f32>>> {
        let mut body =
            serde_json::json!({ "model": self.model, "input": texts, "encoding_format": "float" });
        if shortenable(&self.model) {
            body["dimensions"] = REMOTE_DIMS.into();
        }
        let mut wait = Duration::from_secs(1);
        let mut tries = 0;
        loop {
            tries += 1;
            let res = client
                .post(&self.url)
                .bearer_auth(&self.key)
                .json(&body)
                .send()
                .await;
            let retry = match res {
                Ok(r) if r.status().is_success() => {
                    return parse_embeddings(r.json().await.map_err(other)?, texts.len());
                }
                Ok(r) => {
                    let status = r.status();
                    let msg = r.text().await.unwrap_or_default();
                    let msg = format!(
                        "The embedding service answered {status}: {}",
                        msg.chars().take(300).collect::<String>()
                    );
                    if status.as_u16() != 429 && !status.is_server_error() {
                        return Err(AppError::Other(msg));
                    }
                    msg
                }
                Err(e) => format!("Couldn't reach the embedding service: {e}"),
            };
            if tries >= REMOTE_TRIES {
                return Err(AppError::Other(retry));
            }
            log::warn!("embedding request failed, retrying: {retry}");
            tokio::time::sleep(wait).await;
            wait *= 2;
        }
    }
}

fn parse_embeddings(v: serde_json::Value, n: usize) -> AppResult<Vec<Vec<f32>>> {
    let Some(data) = v.get("data").and_then(|d| d.as_array()) else {
        let msg = v
            .pointer("/error/message")
            .and_then(|m| m.as_str())
            .unwrap_or("no embeddings in the answer");
        return Err(AppError::Other(format!(
            "The embedding service failed: {msg}"
        )));
    };
    let mut rows: Vec<(u64, Vec<f32>)> = Vec::with_capacity(data.len());
    for (i, d) in data.iter().enumerate() {
        let idx = d.get("index").and_then(|x| x.as_u64()).unwrap_or(i as u64);
        let mut e: Vec<f32> = d
            .get("embedding")
            .and_then(|e| e.as_array())
            .map(|a| a.iter().map(|x| x.as_f64().unwrap_or(0.0) as f32).collect())
            .unwrap_or_default();
        if e.is_empty()
            || rows
                .first()
                .is_some_and(|r: &(u64, Vec<f32>)| r.1.len() != e.len())
        {
            return Err(AppError::Other(
                "The embedding service returned vectors of different sizes.".into(),
            ));
        }
        let norm = e.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-12);
        e.iter_mut().for_each(|x| *x /= norm);
        rows.push((idx, e));
    }
    if rows.len() != n {
        return Err(AppError::Other(format!(
            "The embedding service returned {} vectors for {n} texts.",
            rows.len()
        )));
    }
    rows.sort_by_key(|r| r.0);
    Ok(rows.into_iter().map(|r| r.1).collect())
}

impl Embedder for RemoteEmbedder {
    fn embed(&self, texts: &[String]) -> AppResult<Vec<Vec<f32>>> {
        self.embed_prefixed(self.passage_prefix, texts)
    }
    fn embed_queries(&self, texts: &[String]) -> AppResult<Vec<Vec<f32>>> {
        self.embed_prefixed(self.query_prefix, texts)
    }
    fn batch_size(&self) -> usize {
        REMOTE_BATCH * REMOTE_PARALLEL
    }
    fn dims(&self) -> usize {
        self.dims
    }
    fn sim_map(&self) -> Option<(f64, f64)> {
        Some(self.sim_map)
    }
}

/// Deterministic bag-of-words hashing embedder for tests.
#[cfg(test)]
pub struct FakeEmbedder;

#[cfg(test)]
impl Embedder for FakeEmbedder {
    fn embed(&self, texts: &[String]) -> AppResult<Vec<Vec<f32>>> {
        Ok(texts.iter().map(|t| fake_vector(t)).collect())
    }
}

#[cfg(test)]
pub fn fake_vector(text: &str) -> Vec<f32> {
    let mut v = vec![0f32; DIMS];
    for w in text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
    {
        let mut h: u64 = 0xcbf29ce484222325;
        for b in w.to_lowercase().bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        v[(h % DIMS as u64) as usize] += 1.0;
    }
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if n == 0.0 {
        v[0] = 1.0;
    } else {
        v.iter_mut().for_each(|x| *x /= n);
    }
    v
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EmbedderStatus {
    /// missing | downloading | loading | indexing | ready | error
    pub state: String,
    pub model: String,
    pub progress: f64,
    pub error: Option<String>,
}

struct Inner {
    /// A local model id (see MODELS) or REMOTE_PREFIX + an OpenRouter id.
    id: String,
    status: EmbedderStatus,
    model: Option<Arc<dyn Embedder>>,
    last_failure: Option<Instant>,
    last_emit: Option<Instant>,
}

/// Owns the model lifecycle: download on first use, load, expose to the worker and to search.
pub struct EmbedderService {
    /// Folder holding one sub-folder per local model.
    root: Option<PathBuf>,
    inner: Mutex<Inner>,
    emit: Emit,
    remote_key: Option<RemoteKey>,
}

const RETRY_AFTER: Duration = Duration::from_secs(30);

impl EmbedderService {
    pub fn new(root: PathBuf, model_id: &str, emit: Emit, remote_key: RemoteKey) -> Self {
        let id = if is_known_model(model_id) {
            model_id
        } else {
            DEFAULT_MODEL
        };
        let mut s = Self::with(Some(root), id, "missing", None, emit);
        s.remote_key = Some(remote_key);
        if s.files_present() {
            s.inner.get_mut().unwrap().status.state = "loading".into();
        }
        s
    }

    #[cfg(test)]
    pub fn ready(model: Arc<dyn Embedder>, emit: Emit) -> Self {
        Self::with(None, DEFAULT_MODEL, "ready", Some(model), emit)
    }

    #[cfg(test)]
    pub fn unavailable(emit: Emit) -> Self {
        Self::with(None, DEFAULT_MODEL, "missing", None, emit)
    }

    fn with(
        root: Option<PathBuf>,
        id: &str,
        state: &str,
        model: Option<Arc<dyn Embedder>>,
        emit: Emit,
    ) -> Self {
        let progress = if model.is_some() { 1.0 } else { 0.0 };
        Self {
            root,
            inner: Mutex::new(Inner {
                id: id.into(),
                status: EmbedderStatus {
                    state: state.into(),
                    model: id.into(),
                    progress,
                    error: None,
                },
                model,
                last_failure: None,
                last_emit: None,
            }),
            emit,
            remote_key: None,
        }
    }

    pub fn model_id(&self) -> String {
        self.inner.lock().unwrap().id.clone()
    }

    fn is_remote(&self) -> bool {
        remote_model(&self.inner.lock().unwrap().id).is_some()
    }

    fn local_dir(&self, id: &str) -> Option<(PathBuf, &'static ModelSpec)> {
        let spec = MODELS.iter().find(|m| m.id == id)?;
        self.root.as_ref().map(|r| (r.join(spec.id), spec))
    }

    /// Whether the model can load without a download (always true for remote models).
    pub fn files_present(&self) -> bool {
        let id = self.model_id();
        remote_model(&id).is_some()
            || self
                .local_dir(&id)
                .is_some_and(|(d, spec)| files_present(&d, spec))
    }

    /// Switches to another model. The old one is dropped at once; search runs FTS-only until the
    /// new one is downloaded and loaded by the worker. Returns false when it was already active.
    pub fn switch(&self, model_id: &str) -> bool {
        {
            let mut g = self.inner.lock().unwrap();
            if g.id == model_id && (g.model.is_some() || g.status.state != "error") {
                return false;
            }
            g.id = model_id.into();
            g.model = None;
            g.last_failure = None;
        }
        self.set(
            if self.files_present() {
                "loading"
            } else {
                "missing"
            },
            0.0,
            None,
            true,
        );
        true
    }

    pub fn status(&self) -> EmbedderStatus {
        self.inner.lock().unwrap().status.clone()
    }

    /// The loaded model, if ready. Never blocks on loading.
    pub fn current(&self) -> Option<Arc<dyn Embedder>> {
        self.inner.lock().unwrap().model.clone()
    }

    fn set(&self, state: &str, progress: f64, error: Option<String>, force: bool) {
        let mut g = self.inner.lock().unwrap();
        let changed = g.status.state != state;
        if !force
            && !changed
            && g.last_emit
                .map(|t| t.elapsed() < Duration::from_millis(250))
                .unwrap_or(false)
        {
            g.status.progress = progress;
            return;
        }
        g.status = EmbedderStatus {
            state: state.into(),
            model: g.id.clone(),
            progress,
            error,
        };
        g.last_emit = Some(Instant::now());
        let payload = serde_json::to_value(&g.status).unwrap_or_default();
        drop(g);
        (self.emit)("embedder://status", payload);
    }

    /// A remote model failed while embedding; it stays loaded and is tried again on the next job.
    pub fn report_error(&self, error: &str) {
        if self.is_remote() {
            self.set("error", 0.0, Some(error.to_string()), true);
        }
    }

    /// Clears an error left by report_error once embedding works again.
    pub fn report_ok(&self) {
        if self.inner.lock().unwrap().status.state == "error" {
            self.set("ready", 1.0, None, true);
        }
    }

    /// Progress of embedding chunks that have no vectors yet (after a model switch or on startup).
    pub fn report_indexing(&self, progress: Option<f64>) {
        match progress {
            Some(p) => self.set("indexing", p, None, false),
            None => self.set("ready", 1.0, None, true),
        }
    }

    /// Downloads and loads the model if needed. Blocking; call only from the ingest worker.
    /// Returns None when the model isn't available (the caller indexes FTS-only).
    pub fn ensure_loaded(&self) -> Option<Arc<dyn Embedder>> {
        let id = {
            let g = self.inner.lock().unwrap();
            if let Some(m) = &g.model {
                return Some(m.clone());
            }
            if g.last_failure
                .map(|t| t.elapsed() < RETRY_AFTER)
                .unwrap_or(false)
            {
                return None;
            }
            g.id.clone()
        };
        let loaded = match remote_model(&id) {
            Some(model) => self.load_remote(model),
            None => {
                let (dir, spec) = self.local_dir(&id)?;
                self.download_and_load(&dir, spec)
            }
        };
        match loaded {
            Ok(m) => {
                let mut g = self.inner.lock().unwrap();
                if g.id != id {
                    // switched while this one was loading
                    return None;
                }
                g.model = Some(m.clone());
                drop(g);
                self.set("ready", 1.0, None, true);
                Some(m)
            }
            Err(e) => {
                log::warn!("embedding model unavailable: {e}");
                self.inner.lock().unwrap().last_failure = Some(Instant::now());
                self.set("error", 0.0, Some(e), true);
                None
            }
        }
    }

    fn load_remote(&self, model: &str) -> Result<Arc<dyn Embedder>, String> {
        self.set("loading", 0.0, None, true);
        let key = self
            .remote_key
            .as_ref()
            .ok_or("No OpenRouter key is available.")?;
        let m = RemoteEmbedder::connect(model, key().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        Ok(Arc::new(m))
    }

    fn download_and_load(
        &self,
        dir: &Path,
        spec: &'static ModelSpec,
    ) -> Result<Arc<dyn Embedder>, String> {
        if !files_present(dir, spec) {
            self.set("downloading", 0.0, None, true);
            download(dir, spec, |p| self.set("downloading", p, None, false))
                .map_err(|e| format!("Couldn't download the embedding model: {e}"))?;
        }
        self.set("loading", 1.0, None, true);
        let m = BertEmbedder::load(dir, spec).map_err(|e| {
            for (f, _) in spec.files {
                let _ = std::fs::remove_file(dir.join(f));
            }
            format!("Couldn't load the embedding model (it will be downloaded again): {e}")
        })?;
        Ok(Arc::new(m))
    }
}

fn files_present(dir: &Path, spec: &ModelSpec) -> bool {
    spec.files.iter().all(|(f, _)| dir.join(f).is_file())
}

fn download(dir: &Path, spec: &ModelSpec, progress: impl Fn(f64)) -> Result<(), String> {
    use futures_util::StreamExt;
    use std::io::Write;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    rt.block_on(async {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .read_timeout(Duration::from_secs(60))
            .build()
            .map_err(|e| e.to_string())?;
        let total: u64 = spec.files.iter().map(|(_, s)| s).sum();
        let mut done_before = 0u64;
        for (name, approx) in spec.files {
            let dest = dir.join(name);
            if dest.is_file() {
                done_before += approx;
                continue;
            }
            let resp = client
                .get(format!("{}/{name}", spec.url))
                .send()
                .await
                .and_then(|r| r.error_for_status())
                .map_err(|e| e.to_string())?;
            let len = resp.content_length().unwrap_or(*approx).max(1);
            let part = dir.join(format!("{name}.part"));
            let mut f = std::fs::File::create(&part).map_err(|e| e.to_string())?;
            let mut got = 0u64;
            let mut stream = resp.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| e.to_string())?;
                f.write_all(&chunk).map_err(|e| e.to_string())?;
                got += chunk.len() as u64;
                let cur = (got as f64 / len as f64).min(1.0) * *approx as f64;
                progress(((done_before as f64 + cur) / total as f64).min(0.999));
            }
            f.sync_all().map_err(|e| e.to_string())?;
            drop(f);
            std::fs::rename(&part, &dest).map_err(|e| e.to_string())?;
            done_before += approx;
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cos(a: &[f32], b: &[f32]) -> f32 {
        a.iter().zip(b).map(|(x, y)| x * y).sum()
    }

    /// Model files for the ignored real-model tests: EMBED_MODEL_DIR, else the dev app's download
    /// (`<data dir>/models/<EMBED_MODEL or the default>`). None (test skipped) when missing.
    fn test_model() -> Option<(PathBuf, &'static ModelSpec)> {
        let spec = spec(&std::env::var("EMBED_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.into()));
        let dir = std::env::var("EMBED_MODEL_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                let home = std::env::var("HOME").unwrap_or_default();
                Path::new(&home)
                    .join("Library/Application Support/dev.ponder.app/models")
                    .join(spec.id)
            });
        if !files_present(&dir, spec) {
            eprintln!("no model files in {}; set EMBED_MODEL_DIR", dir.display());
            return None;
        }
        Some((dir, spec))
    }

    #[test]
    fn fake_embedder_is_normalized_and_deterministic() {
        let v = fake_vector("Chlorophyll absorbs light");
        assert_eq!(v.len(), DIMS);
        assert!((cos(&v, &v) - 1.0).abs() < 1e-5);
        assert_eq!(v, fake_vector("chlorophyll ABSORBS light"));
        assert_eq!(fake_vector("").len(), DIMS);
    }

    #[test]
    fn parses_remote_embeddings_in_input_order_and_normalizes() {
        let row = |i: usize, x: f64| serde_json::json!({ "index": i, "embedding": vec![x; DIMS] });
        let v = parse_embeddings(
            serde_json::json!({ "data": [row(1, 2.0), row(0, -1.0)] }),
            2,
        )
        .unwrap();
        assert!(v[0][0] < 0.0 && v[1][0] > 0.0);
        assert!((cos(&v[1], &v[1]) - 1.0).abs() < 1e-5);
        assert!(parse_embeddings(serde_json::json!({ "data": [row(0, 1.0)] }), 2).is_err());
        let mixed = serde_json::json!({ "data": [{ "index": 0, "embedding": [1.0, 0.0] }, { "index": 1, "embedding": [1.0] }] });
        assert!(parse_embeddings(mixed, 2)
            .unwrap_err()
            .to_string()
            .contains("different sizes"));
        let err = parse_embeddings(
            serde_json::json!({ "error": { "message": "No credits" } }),
            1,
        )
        .unwrap_err();
        assert!(err.to_string().contains("No credits"));
    }

    /// Answers request n with status `answers[n]` (200 after the list): 200 returns one vector per
    /// input, with `dims` numbers, and calibration-like similarities for the probe texts.
    fn mock_server(answers: Vec<u16>) -> (String, Arc<Mutex<Vec<serde_json::Value>>>) {
        use std::io::{BufRead, BufReader, Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/embeddings", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        std::thread::spawn(move || {
            for (n, stream) in listener.incoming().enumerate() {
                let mut stream = stream.unwrap();
                let mut r = BufReader::new(stream.try_clone().unwrap());
                let mut len = 0;
                loop {
                    let mut line = String::new();
                    r.read_line(&mut line).unwrap();
                    if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        len = v.trim().parse().unwrap();
                    }
                    if line == "\r\n" {
                        break;
                    }
                }
                let mut body = vec![0; len];
                r.read_exact(&mut body).unwrap();
                let req: serde_json::Value = serde_json::from_slice(&body).unwrap();
                let status = answers.get(n).copied().unwrap_or(200);
                let out = if status == 200 {
                    let inputs = req["input"].as_array().unwrap();
                    let data: Vec<_> = inputs
                        .iter()
                        .enumerate()
                        .map(|(i, t)| serde_json::json!({ "index": i, "embedding": mock_vector(t.as_str().unwrap()) }))
                        .collect();
                    serde_json::json!({ "data": data })
                } else {
                    serde_json::json!({ "error": { "message": "slow down" } })
                };
                log.lock().unwrap().push(req);
                let out = out.to_string();
                write!(stream, "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{out}", out.len()).unwrap();
            }
        });
        (url, seen)
    }

    /// 6-dim vectors: on-topic calibration pairs point the same way, everything else is spread out.
    fn mock_vector(text: &str) -> Vec<f32> {
        let axis = [
            "Percents",
            "percent of a number",
            "Life science",
            "All living things",
            "Datenbanken",
            "Eine relationale",
        ]
        .iter()
        .position(|k| text.contains(k))
        .map(|p| p / 2)
        .unwrap_or(3 + text.len() % 3);
        let mut v = vec![0.1f32; 6];
        v[axis] = 1.0;
        v
    }

    #[test]
    fn remote_embedder_measures_calibrates_batches_and_retries() {
        let (url, seen) = mock_server(vec![200, 429]);
        let m = RemoteEmbedder::connect_to("qwen/qwen3-embedding-8b", "k".into(), &url).unwrap();
        assert_eq!(m.dims(), 6);
        let (scale, offset) = m.sim_map().unwrap();
        assert!(
            scale > 0.5 && calibrated((scale, offset), 1.0) > 0.6,
            "{scale} {offset}"
        );
        assert_eq!(m.batch_size(), 256);
        let texts: Vec<String> = (0..150).map(|i| format!("chunk {i}")).collect();
        assert_eq!(m.embed(&texts).unwrap().len(), 150);
        let reqs = seen.lock().unwrap().clone();
        // the probe, then three requests of ≤64 with one retried after the 429
        assert_eq!(reqs.len(), 5);
        assert!(reqs
            .iter()
            .all(|r| r["model"] == "qwen/qwen3-embedding-8b" && r["dimensions"] == REMOTE_DIMS));
        assert!(reqs[0]["input"][0]
            .as_str()
            .unwrap()
            .starts_with("Instruct: "));
        let sent: usize = reqs[2..]
            .iter()
            .map(|r| r["input"].as_array().unwrap().len())
            .sum();
        assert_eq!(sent, 150);

        m.embed_queries(&["photosynthesis".into()]).unwrap();
        let q = seen.lock().unwrap().last().unwrap()["input"][0]
            .as_str()
            .unwrap()
            .to_string();
        assert!(q.starts_with("Instruct: ") && q.ends_with("Query: photosynthesis"));
    }

    #[test]
    fn remote_models_keep_their_own_size_unless_shortenable() {
        let (url, seen) = mock_server(vec![]);
        RemoteEmbedder::connect_to("baai/bge-m3", "k".into(), &url).unwrap();
        assert!(seen.lock().unwrap()[0].get("dimensions").is_none());
        assert_eq!(
            remote_prefixes("intfloat/e5-large-v2"),
            ("query: ", "passage: ")
        );
        assert!(
            shortenable("openai/text-embedding-3-small")
                && !shortenable("sentence-transformers/all-minilm-l6-v2")
        );
    }

    #[test]
    fn remote_embedder_reports_client_errors_without_retrying() {
        let (url, seen) = mock_server(vec![401]);
        let err = RemoteEmbedder::connect_to("openai/text-embedding-3-small", "bad".into(), &url)
            .err()
            .unwrap()
            .to_string();
        assert!(err.contains("401"), "{err}");
        assert_eq!(seen.lock().unwrap().len(), 1);
    }

    #[test]
    fn remote_model_ids_and_missing_key() {
        assert_eq!(
            remote_model("openrouter:qwen/qwen3-embedding-8b"),
            Some("qwen/qwen3-embedding-8b")
        );
        assert_eq!(remote_model("openrouter: "), None);
        assert!(
            is_known_model("multilingual-e5-small")
                && is_known_model("openrouter:x/y")
                && !is_known_model("nope")
        );
        let dir = tempfile::tempdir().unwrap();
        let key: RemoteKey = Arc::new(|| Err(AppError::Other("Add an OpenRouter key".into())));
        let s = EmbedderService::new(
            dir.path().to_path_buf(),
            "openrouter:qwen/qwen3-embedding-8b",
            Arc::new(|_, _| {}),
            key,
        );
        assert!(s.files_present());
        assert_eq!(s.status().state, "loading");
        assert!(s.ensure_loaded().is_none());
        assert_eq!(s.status().state, "error");
        assert!(s.status().error.unwrap().contains("OpenRouter key"));
        let s = EmbedderService::new(
            dir.path().to_path_buf(),
            "bogus",
            Arc::new(|_, _| {}),
            Arc::new(|| Ok("k".into())),
        );
        assert_eq!(s.model_id(), DEFAULT_MODEL);
    }

    /// Live: OPENROUTER_API_KEY=… cargo test live_openrouter -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_openrouter_qwen() {
        let Ok(key) = std::env::var("OPENROUTER_API_KEY") else {
            return;
        };
        let model = "qwen/qwen3-embedding-8b";
        let m = RemoteEmbedder::connect(model, key).unwrap();
        let q = m
            .embed_queries(&["How does photosynthesis work?".into()])
            .unwrap();
        let p = m
            .embed(&[
                "Chlorophyll in the chloroplasts absorbs sunlight, which leaves use to turn carbon dioxide and water into glucose.".into(),
                "Under the tax code, capital gains on assets held longer than one year are taxed at a reduced rate.".into(),
            ])
            .unwrap();
        let (bio, tax) = (
            calibrated(m.sim_map, cos(&q[0], &p[0]) as f64),
            calibrated(m.sim_map, cos(&q[0], &p[1]) as f64),
        );
        println!(
            "{model}: {} dims, map {:?}, bio {bio:.2}, tax {tax:.2}",
            m.dims, m.sim_map
        );
        assert!(bio > tax + 0.2);
    }

    #[test]
    fn calibration_maps_onto_the_minilm_scale() {
        let one = |i: usize| {
            let mut v = vec![0f32; 4];
            v[i] = 1.0;
            v
        };
        // on-topic pairs identical, others orthogonal
        let topics = vec![one(0), one(1), one(2)];
        let chunks = vec![one(0), one(3), one(1), one(3), one(2), one(3)];
        let map = calibration_map(&topics, &chunks);
        assert!((calibrated(map, 1.0) - CAL_TARGET.0).abs() < 1e-9);
        assert!((calibrated(map, 0.0) - CAL_TARGET.1).abs() < 1e-9);
        assert_eq!(
            calibration_map(&topics, &(0..6).map(|_| one(3)).collect::<Vec<_>>()),
            (1.0, 0.0)
        );
    }

    #[test]
    fn unavailable_service_reports_missing() {
        let s = EmbedderService::unavailable(Arc::new(|_, _| {}));
        assert!(s.ensure_loaded().is_none());
        assert_eq!(s.status().state, "missing");
    }

    /// Needs the real model files: EMBED_MODEL_DIR or the probe dir from setup.
    #[test]
    #[ignore]
    fn real_model_semantic_similarity() {
        let Some((dir, spec)) = test_model() else {
            return;
        };
        let t = Instant::now();
        let m = BertEmbedder::load(&dir, spec).unwrap();
        let load = t.elapsed();
        let texts = vec![
            "photosynthesis in plants".to_string(),
            "Chlorophyll in the chloroplasts absorbs sunlight, which leaves use to turn carbon dioxide and water into glucose.".to_string(),
            "Under the tax code, capital gains on assets held longer than one year are taxed at a reduced rate.".to_string(),
        ];
        let t = Instant::now();
        let v = m.embed(&texts).unwrap();
        let embed = t.elapsed();
        assert_eq!(v[0].len(), DIMS);
        let norm = cos(&v[0], &v[0]);
        assert!((norm - 1.0).abs() < 1e-4, "not normalized: {norm}");
        let bio = cos(&v[0], &v[1]);
        let tax = cos(&v[0], &v[2]);
        println!("load {load:?}, embed 3 in {embed:?}, sim(bio)={bio:.3}, sim(tax)={tax:.3}");
        assert!(
            calibrated(spec.sim_map, bio as f64) > calibrated(spec.sim_map, tax as f64) + 0.1,
            "bio {bio} tax {tax}"
        );
        let batch: Vec<String> = (0..16)
            .map(|i| format!("{i} {}", texts[1]).repeat(5))
            .collect();
        let t = Instant::now();
        m.embed(&batch).unwrap();
        println!("batch of 16 (~150 tokens each) in {:?}", t.elapsed());
    }

    /// German question vs. English passage (and the reverse). Run with EMBED_MODEL=multilingual-e5-small.
    #[test]
    #[ignore]
    fn real_model_cross_lingual() {
        let Some((dir, spec)) = test_model() else {
            return;
        };
        let m = BertEmbedder::load(&dir, spec).unwrap();
        let q = m
            .embed_queries(&[
                "Wie funktioniert die Photosynthese?".to_string(),
                "how do database joins work".to_string(),
            ])
            .unwrap();
        let p = m
            .embed(&[
                "Chlorophyll in the chloroplasts absorbs sunlight, which leaves use to turn carbon dioxide and water into glucose.".to_string(),
                "Under the tax code, capital gains on assets held longer than one year are taxed at a reduced rate.".to_string(),
                "JOIN verknüpft zwei Tabellen über einen Fremdschlüssel, sodass zusammengehörige Zeilen gemeinsam abgefragt werden.".to_string(),
            ])
            .unwrap();
        let (bio, tax, sql) = (cos(&q[0], &p[0]), cos(&q[0], &p[1]), cos(&q[1], &p[2]));
        let sql_off = cos(&q[1], &p[1]);
        println!(
            "{}: de→en bio={bio:.3} tax={tax:.3}; en→de sql={sql:.3} off={sql_off:.3}",
            spec.id
        );
        if spec.multilingual {
            assert!(bio > tax + 0.03, "bio {bio} tax {tax}");
            assert!(sql > sql_off + 0.03, "sql {sql} off {sql_off}");
        }
    }

    /// Prints topic-vs-chunk similarities used to pick the coverage thresholds in the UI.
    #[test]
    #[ignore]
    fn real_model_coverage_calibration() {
        let Some((dir, spec)) = test_model() else {
            return;
        };
        let m = BertEmbedder::load(&dir, spec).unwrap();
        let (topics, chunks) = (CAL_TOPICS, CAL_CHUNKS);
        let tv = m
            .embed(&topics.iter().map(|s| s.to_string()).collect::<Vec<_>>())
            .unwrap();
        let cv = m
            .embed(&chunks.iter().map(|c| c.1.to_string()).collect::<Vec<_>>())
            .unwrap();
        for (i, t) in topics.iter().enumerate() {
            let row: Vec<String> = chunks
                .iter()
                .enumerate()
                .map(|(j, c)| {
                    format!(
                        "{}={:.2}",
                        c.0,
                        calibrated(spec.sim_map, cos(&tv[i], &cv[j]) as f64)
                    )
                })
                .collect();
            println!("{}\n   {}", &t[..t.find(':').unwrap()], row.join("  "));
        }
    }
}
