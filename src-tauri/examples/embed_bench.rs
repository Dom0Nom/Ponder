//! Compares the app's local embedder with the original per-batch code on real chunks and reports
//! the minimum cosine and chunks/s. Usage:
//!   embed_bench <app.db> <models dir> <model id> [count]  (BENCH_CACHE=<dir> keeps the old path's vectors and time)
//!   embed_bench --pdf <file.pdf>   (extract + chunk timing)
use app_lib::dev_embed::{chunk_text, extract_file_with, spec, BertEmbedder, Embedder};
use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config};
use std::path::Path;
use std::time::Instant;
use tokenizers::{PaddingParams, Tokenizer, TruncationParams};

struct Legacy {
    model: BertModel,
    tokenizer: Tokenizer,
    prefix: &'static str,
}

impl Legacy {
    fn load(dir: &Path, prefix: &'static str) -> Self {
        let device = Device::Cpu;
        let cfg: Config =
            serde_json::from_str(&std::fs::read_to_string(dir.join("config.json")).unwrap())
                .unwrap();
        let mut tokenizer = Tokenizer::from_file(dir.join("tokenizer.json")).unwrap();
        let (pad_id, pad_token) = ["[PAD]", "<pad>"]
            .iter()
            .find_map(|t| tokenizer.token_to_id(t).map(|id| (id, t.to_string())))
            .unwrap_or((0, "[PAD]".into()));
        tokenizer.with_padding(Some(PaddingParams {
            pad_id,
            pad_token,
            ..Default::default()
        }));
        tokenizer
            .with_truncation(Some(TruncationParams {
                max_length: 256,
                ..Default::default()
            }))
            .unwrap();
        let vb = unsafe {
            VarBuilder::from_mmaped_safetensors(
                &[dir.join("model.safetensors")],
                DType::F32,
                &device,
            )
            .unwrap()
        };
        Self {
            model: BertModel::load(vb, &cfg).unwrap(),
            tokenizer,
            prefix,
        }
    }

    fn embed(&self, texts: &[String]) -> Vec<Vec<f32>> {
        let device = Device::Cpu;
        let texts: Vec<String> = texts
            .iter()
            .map(|t| format!("{}{t}", self.prefix))
            .collect();
        let enc = self.tokenizer.encode_batch(texts, true).unwrap();
        let ids: Vec<_> = enc
            .iter()
            .map(|e| Tensor::new(e.get_ids(), &device).unwrap())
            .collect();
        let mask: Vec<_> = enc
            .iter()
            .map(|e| Tensor::new(e.get_attention_mask(), &device).unwrap())
            .collect();
        let ids = Tensor::stack(&ids, 0).unwrap();
        let mask = Tensor::stack(&mask, 0).unwrap();
        let tt = ids.zeros_like().unwrap();
        let out = self.model.forward(&ids, &tt, Some(&mask)).unwrap();
        let m = mask.to_dtype(DType::F32).unwrap().unsqueeze(2).unwrap();
        let pooled = out
            .broadcast_mul(&m)
            .unwrap()
            .sum(1)
            .unwrap()
            .broadcast_div(&m.sum(1).unwrap())
            .unwrap();
        let norm = pooled
            .sqr()
            .unwrap()
            .sum_keepdim(1)
            .unwrap()
            .sqrt()
            .unwrap()
            .clamp(1e-12, f32::MAX)
            .unwrap();
        pooled
            .broadcast_div(&norm)
            .unwrap()
            .to_vec2::<f32>()
            .unwrap()
    }
}

fn cos(a: &[f32], b: &[f32]) -> f32 {
    let d: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    d / (na * nb)
}

fn pdf(path: &str) {
    let t = Instant::now();
    let mut last = Instant::now();
    let mut max_gap = 0.0f64;
    let mut tenth = 0;
    let ex = extract_file_with(Path::new(path), "pdf", &mut |p| {
        max_gap = max_gap.max(last.elapsed().as_secs_f64());
        last = Instant::now();
        if (p * 10.0) as u32 != tenth {
            tenth = (p * 10.0) as u32;
            println!("  {:.0}% at {:.0}s", p * 100.0, t.elapsed().as_secs_f64());
        }
    })
    .unwrap();
    println!("longest gap between progress ticks {max_gap:.2}s");
    let ext = t.elapsed();
    let t = Instant::now();
    let chunks = chunk_text(&ex.text, ex.pages.as_deref());
    println!(
        "extract {:.1}s, chunk {:.1}s, {} chars, {} chunks",
        ext.as_secs_f64(),
        t.elapsed().as_secs_f64(),
        ex.text.len(),
        chunks.len()
    );
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args[0] == "--pdf" {
        return pdf(&args[1]);
    }
    let count: usize = args.get(3).map(|s| s.parse().unwrap()).unwrap_or(500);
    let sp = spec(&args[2]);
    let db = rusqlite::Connection::open_with_flags(
        format!("file:{}?immutable=1", args[0]),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .unwrap();
    let total: i64 = db
        .query_row("SELECT count(*) FROM chunks", [], |r| r.get(0))
        .unwrap();
    let step = (total as usize / count).max(1);
    let mut st = db
        .prepare("SELECT text FROM chunks WHERE id % ?1 = 0 ORDER BY id LIMIT ?2")
        .unwrap();
    let texts: Vec<String> = st
        .query_map([step as i64, count as i64], |r| r.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    let dir = Path::new(&args[1]).join(sp.id);
    println!("{} chunks from {}", texts.len(), sp.id);

    let cache = std::env::var("BENCH_CACHE")
        .ok()
        .map(|d| Path::new(&d).join(format!("{}-{}.json", sp.id, texts.len())));
    let cached: Option<(f64, Vec<Vec<f32>>)> = cache
        .as_ref()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok());
    let (old_s, old) = cached.unwrap_or_else(|| {
        let legacy = Legacy::load(&dir, sp.passage_prefix);
        legacy.embed(&texts[..4]);
        let t = Instant::now();
        let mut old = Vec::new();
        for b in texts.chunks(16) {
            old.extend(legacy.embed(b));
        }
        let old_s = t.elapsed().as_secs_f64();
        if let Some(p) = &cache {
            std::fs::write(p, serde_json::to_string(&(old_s, &old)).unwrap()).unwrap();
        }
        (old_s, old)
    });
    println!(
        "old: {:.2} chunks/s ({:.1}s)",
        texts.len() as f64 / old_s,
        old_s
    );

    let new = BertEmbedder::load(&dir, sp).unwrap();
    new.embed(&texts[..4]).unwrap();
    let t = Instant::now();
    let mut vecs = Vec::new();
    for b in texts.chunks(new.batch_size()) {
        vecs.extend(new.embed(b).unwrap());
    }
    let new_s = t.elapsed().as_secs_f64();
    println!(
        "new: {:.2} chunks/s ({:.1}s)",
        texts.len() as f64 / new_s,
        new_s
    );
    let cs: Vec<f32> = old.iter().zip(&vecs).map(|(a, b)| cos(a, b)).collect();
    let min = cs.iter().cloned().fold(f32::MAX, f32::min);
    let mean = cs.iter().sum::<f32>() / cs.len() as f32;
    println!(
        "cosine min {min:.6} mean {mean:.6}; speedup {:.2}x",
        old_s / new_s
    );
}
