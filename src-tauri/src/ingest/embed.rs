//! Local sentence embeddings (BERT-style models via candle, 384 dims) and the model lifecycle.

use super::Emit;
use crate::error::{AppError, AppResult};
use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokenizers::{PaddingParams, Tokenizer, TruncationParams};

#[cfg(test)]
pub const DIMS: usize = 384;

/// A downloadable local embedding model. All of them output 384-dim vectors, so switching only
/// needs a re-embed, not a schema change.
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

impl ModelSpec {
    pub fn calibrated(&self, sim: f64) -> f64 {
        sim * self.sim_map.0 + self.sim_map.1
    }
}

pub const MODELS: &[ModelSpec] = &[
    ModelSpec {
        id: "all-MiniLM-L6-v2",
        url: "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main",
        files: &[("config.json", 612), ("tokenizer.json", 466_247), ("model.safetensors", 90_868_376)],
        query_prefix: "",
        passage_prefix: "",
        size_mb: 91,
        multilingual: false,
        sim_map: (1.0, 0.0),
    },
    ModelSpec {
        id: "multilingual-e5-small",
        url: "https://huggingface.co/intfloat/multilingual-e5-small/resolve/main",
        files: &[("config.json", 655), ("tokenizer.json", 17_082_730), ("model.safetensors", 470_641_600)],
        query_prefix: "query: ",
        passage_prefix: "passage: ",
        size_mb: 488,
        multilingual: true,
        // related-but-off-topic ≈ 0.80 → 0.15, on-topic ≈ 0.885 → 0.62
        sim_map: (5.53, -4.274),
    },
];

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
}

fn other<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Other(e.to_string())
}

pub struct BertEmbedder {
    model: BertModel,
    tokenizer: Tokenizer,
    device: Device,
    query_prefix: &'static str,
    passage_prefix: &'static str,
}

impl BertEmbedder {
    pub fn load(dir: &Path, spec: &ModelSpec) -> AppResult<Self> {
        let device = Device::Cpu;
        let cfg: Config = serde_json::from_str(&std::fs::read_to_string(dir.join("config.json"))?)?;
        let mut tokenizer = Tokenizer::from_file(dir.join("tokenizer.json")).map_err(other)?;
        let (pad_id, pad_token) = ["[PAD]", "<pad>"]
            .iter()
            .find_map(|t| tokenizer.token_to_id(t).map(|id| (id, t.to_string())))
            .unwrap_or((0, "[PAD]".into()));
        tokenizer.with_padding(Some(PaddingParams { pad_id, pad_token, ..Default::default() }));
        tokenizer
            .with_truncation(Some(TruncationParams { max_length: 256, ..Default::default() }))
            .map_err(other)?;
        // SAFETY: the file is only replaced via atomic rename, never mutated in place.
        let vb = unsafe {
            VarBuilder::from_mmaped_safetensors(&[dir.join("model.safetensors")], DType::F32, &device).map_err(other)?
        };
        let model = BertModel::load(vb, &cfg).map_err(other)?;
        Ok(Self { model, tokenizer, device, query_prefix: spec.query_prefix, passage_prefix: spec.passage_prefix })
    }

    fn embed_prefixed(&self, prefix: &str, texts: &[String]) -> AppResult<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(vec![]);
        }
        if prefix.is_empty() {
            return self.embed_batch(texts).map_err(other);
        }
        let texts: Vec<String> = texts.iter().map(|t| format!("{prefix}{t}")).collect();
        self.embed_batch(&texts).map_err(other)
    }

    fn embed_batch(&self, texts: &[String]) -> candle_core::Result<Vec<Vec<f32>>> {
        let enc = self
            .tokenizer
            .encode_batch(texts.to_vec(), true)
            .map_err(|e| candle_core::Error::Msg(e.to_string()))?;
        let ids = enc.iter().map(|e| Tensor::new(e.get_ids(), &self.device)).collect::<Result<Vec<_>, _>>()?;
        let mask = enc
            .iter()
            .map(|e| Tensor::new(e.get_attention_mask(), &self.device))
            .collect::<Result<Vec<_>, _>>()?;
        let ids = Tensor::stack(&ids, 0)?;
        let mask = Tensor::stack(&mask, 0)?;
        let token_types = ids.zeros_like()?;
        let out = self.model.forward(&ids, &token_types, Some(&mask))?;
        let m = mask.to_dtype(DType::F32)?.unsqueeze(2)?;
        let pooled = out.broadcast_mul(&m)?.sum(1)?.broadcast_div(&m.sum(1)?)?;
        let norm = pooled.sqr()?.sum_keepdim(1)?.sqrt()?.clamp(1e-12, f32::MAX)?;
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
    for w in text.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()) {
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
    spec: &'static ModelSpec,
    status: EmbedderStatus,
    model: Option<Arc<dyn Embedder>>,
    last_failure: Option<Instant>,
    last_emit: Option<Instant>,
}

/// Owns the model lifecycle: download on first use, load, expose to the worker and to search.
pub struct EmbedderService {
    /// Folder holding one sub-folder per model.
    root: Option<PathBuf>,
    inner: Mutex<Inner>,
    emit: Emit,
}

const RETRY_AFTER: Duration = Duration::from_secs(30);

impl EmbedderService {
    pub fn new(root: PathBuf, model_id: &str, emit: Emit) -> Self {
        let spec = spec(model_id);
        let state = if files_present(&root.join(spec.id), spec) { "loading" } else { "missing" };
        Self::with(Some(root), spec, state, None, emit)
    }

    #[cfg(test)]
    pub fn ready(model: Arc<dyn Embedder>, emit: Emit) -> Self {
        Self::with(None, &MODELS[0], "ready", Some(model), emit)
    }

    #[cfg(test)]
    pub fn unavailable(emit: Emit) -> Self {
        Self::with(None, &MODELS[0], "missing", None, emit)
    }

    fn with(root: Option<PathBuf>, spec: &'static ModelSpec, state: &str, model: Option<Arc<dyn Embedder>>, emit: Emit) -> Self {
        let progress = if model.is_some() { 1.0 } else { 0.0 };
        Self {
            root,
            inner: Mutex::new(Inner {
                spec,
                status: EmbedderStatus { state: state.into(), model: spec.id.into(), progress, error: None },
                model,
                last_failure: None,
                last_emit: None,
            }),
            emit,
        }
    }

    pub fn model_id(&self) -> &'static str {
        self.inner.lock().unwrap().spec.id
    }

    fn dir(&self) -> Option<(PathBuf, &'static ModelSpec)> {
        let spec = self.inner.lock().unwrap().spec;
        self.root.as_ref().map(|r| (r.join(spec.id), spec))
    }

    pub fn files_present(&self) -> bool {
        self.dir().map(|(d, spec)| files_present(&d, spec)).unwrap_or(false)
    }

    /// Switches to another model. The old one is dropped at once; search runs FTS-only until the
    /// new one is downloaded and loaded by the worker. Returns false when it was already active.
    pub fn switch(&self, model_id: &str) -> bool {
        let spec = spec(model_id);
        let present = self.root.as_ref().is_some_and(|r| files_present(&r.join(spec.id), spec));
        {
            let mut g = self.inner.lock().unwrap();
            if g.spec.id == spec.id && (g.model.is_some() || g.status.state != "error") {
                return false;
            }
            g.spec = spec;
            g.model = None;
            g.last_failure = None;
        }
        self.set(if present { "loading" } else { "missing" }, 0.0, None, true);
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
        if !force && !changed && g.last_emit.map(|t| t.elapsed() < Duration::from_millis(250)).unwrap_or(false) {
            g.status.progress = progress;
            return;
        }
        g.status = EmbedderStatus { state: state.into(), model: g.spec.id.into(), progress, error };
        g.last_emit = Some(Instant::now());
        let payload = serde_json::to_value(&g.status).unwrap_or_default();
        drop(g);
        (self.emit)("embedder://status", payload);
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
        {
            let g = self.inner.lock().unwrap();
            if let Some(m) = &g.model {
                return Some(m.clone());
            }
            if g.last_failure.map(|t| t.elapsed() < RETRY_AFTER).unwrap_or(false) {
                return None;
            }
        }
        let (dir, spec) = self.dir()?;
        match self.download_and_load(&dir, spec) {
            Ok(m) => {
                let m: Arc<dyn Embedder> = Arc::new(m);
                let mut g = self.inner.lock().unwrap();
                if g.spec.id != spec.id {
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

    fn download_and_load(&self, dir: &Path, spec: &'static ModelSpec) -> Result<BertEmbedder, String> {
        if !files_present(dir, spec) {
            self.set("downloading", 0.0, None, true);
            download(dir, spec, |p| self.set("downloading", p, None, false))
                .map_err(|e| format!("Couldn't download the embedding model: {e}"))?;
        }
        self.set("loading", 1.0, None, true);
        BertEmbedder::load(dir, spec).map_err(|e| {
            for (f, _) in spec.files {
                let _ = std::fs::remove_file(dir.join(f));
            }
            format!("Couldn't load the embedding model (it will be downloaded again): {e}")
        })
    }
}

fn files_present(dir: &Path, spec: &ModelSpec) -> bool {
    spec.files.iter().all(|(f, _)| dir.join(f).is_file())
}

fn download(dir: &Path, spec: &ModelSpec, progress: impl Fn(f64)) -> Result<(), String> {
    use futures_util::StreamExt;
    use std::io::Write;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|e| e.to_string())?;
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
        let dir = std::env::var("EMBED_MODEL_DIR").map(PathBuf::from).unwrap_or_else(|_| {
            let home = std::env::var("HOME").unwrap_or_default();
            Path::new(&home).join("Library/Application Support/dev.ponder.app/models").join(spec.id)
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
    fn unavailable_service_reports_missing() {
        let s = EmbedderService::unavailable(Arc::new(|_, _| {}));
        assert!(s.ensure_loaded().is_none());
        assert_eq!(s.status().state, "missing");
    }

    /// Needs the real model files: EMBED_MODEL_DIR or the probe dir from setup.
    #[test]
    #[ignore]
    fn real_model_semantic_similarity() {
        let Some((dir, spec)) = test_model() else { return };
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
        assert!(spec.calibrated(bio as f64) > spec.calibrated(tax as f64) + 0.1, "bio {bio} tax {tax}");
        let batch: Vec<String> = (0..16).map(|i| format!("{i} {}", texts[1]).repeat(5)).collect();
        let t = Instant::now();
        m.embed(&batch).unwrap();
        println!("batch of 16 (~150 tokens each) in {:?}", t.elapsed());
    }

    /// German question vs. English passage (and the reverse). Run with EMBED_MODEL=multilingual-e5-small.
    #[test]
    #[ignore]
    fn real_model_cross_lingual() {
        let Some((dir, spec)) = test_model() else { return };
        let m = BertEmbedder::load(&dir, spec).unwrap();
        let q = m.embed_queries(&["Wie funktioniert die Photosynthese?".to_string(), "how do database joins work".to_string()]).unwrap();
        let p = m
            .embed(&[
                "Chlorophyll in the chloroplasts absorbs sunlight, which leaves use to turn carbon dioxide and water into glucose.".to_string(),
                "Under the tax code, capital gains on assets held longer than one year are taxed at a reduced rate.".to_string(),
                "JOIN verknüpft zwei Tabellen über einen Fremdschlüssel, sodass zusammengehörige Zeilen gemeinsam abgefragt werden.".to_string(),
            ])
            .unwrap();
        let (bio, tax, sql) = (cos(&q[0], &p[0]), cos(&q[0], &p[1]), cos(&q[1], &p[2]));
        let sql_off = cos(&q[1], &p[1]);
        println!("{}: de→en bio={bio:.3} tax={tax:.3}; en→de sql={sql:.3} off={sql_off:.3}", spec.id);
        if spec.multilingual {
            assert!(bio > tax + 0.03, "bio {bio} tax {tax}");
            assert!(sql > sql_off + 0.03, "sql {sql} off {sql_off}");
        }
    }

    /// Prints topic-vs-chunk similarities used to pick the coverage thresholds in the UI.
    #[test]
    #[ignore]
    fn real_model_coverage_calibration() {
        let Some((dir, spec)) = test_model() else { return };
        let m = BertEmbedder::load(&dir, spec).unwrap();
        let topics = [
            "Percents: percent of a number, percent change, interest, discounts",
            "Life science: cells, human body systems, health, genetics and heredity, evolution, ecosystems",
            "Datenbanken und SQL: ER-Modell, Normalisierung, SELECT, JOIN, GROUP BY, Transaktionen",
        ];
        let chunks = [
            ("percents on-topic", "To find a percent of a number, change the percent to a decimal and multiply. For example, 15% of 80 is 0.15 x 80 = 12. Percent change compares the change to the original amount: if a price rises from $40 to $50, the increase is 10/40 = 25%. A store discount of 20% on a $60 jacket saves $12."),
            ("geometry same-subject", "The area of a rectangle is length times width. The circumference of a circle is 2 pi r and its area is pi r squared. In a right triangle, the Pythagorean theorem says a squared plus b squared equals c squared."),
            ("cells on-topic", "All living things are made of cells. The nucleus holds DNA, which carries the genes passed from parents to offspring. Organs such as the heart and lungs work together in body systems, and natural selection explains how populations evolve over generations."),
            ("physics off-topic", "A force is a push or a pull. Newton's second law says force equals mass times acceleration. Kinetic energy depends on mass and speed, and energy is conserved in a closed system."),
            ("sql on-topic", "Eine relationale Datenbank speichert Daten in Tabellen. Mit SELECT werden Spalten abgefragt, JOIN verknüpft Tabellen über Fremdschlüssel, und GROUP BY fasst Zeilen für Aggregatfunktionen zusammen. Die Normalisierung vermeidet Redundanzen."),
            ("cooking unrelated", "Preheat the oven, whisk the eggs with sugar until fluffy, fold in the flour and bake the cake for thirty minutes until golden."),
        ];
        let tv = m.embed(&topics.iter().map(|s| s.to_string()).collect::<Vec<_>>()).unwrap();
        let cv = m.embed(&chunks.iter().map(|c| c.1.to_string()).collect::<Vec<_>>()).unwrap();
        for (i, t) in topics.iter().enumerate() {
            let row: Vec<String> = chunks
                .iter()
                .enumerate()
                .map(|(j, c)| format!("{}={:.2}", c.0, spec.calibrated(cos(&tv[i], &cv[j]) as f64)))
                .collect();
            println!("{}\n   {}", &t[..t.find(':').unwrap()], row.join("  "));
        }
    }
}
