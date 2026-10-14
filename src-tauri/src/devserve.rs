//! Debug builds only: `ponder dev-serve --data <dir> [--port N]` answers a few backend commands
//! over local HTTP against a copy of a data folder, so scripts (context eval) can run the real
//! search and source reading without the app window.
use crate::context;
use crate::db::{models, Db};
use crate::error::{invalid, AppError, AppResult};
use crate::ingest::{embed, Emit, Ingest};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Arc;

struct Server {
    db: Db,
    ingest: Ingest,
}

fn arg(v: &Value, k: &str) -> AppResult<String> {
    v.get(k)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| invalid(format!("missing {k}")))
}

fn ids(v: &Value, k: &str) -> Option<Vec<String>> {
    v.get(k).and_then(Value::as_array).map(|a| {
        a.iter()
            .filter_map(|x| x.as_str().map(str::to_string))
            .collect()
    })
}

impl Server {
    fn call(&self, cmd: &str, a: &Value) -> AppResult<Value> {
        let c = self.db.conn()?;
        let limit = a.get("limit").and_then(Value::as_u64).map(|n| n as usize);
        Ok(match cmd {
            "list_spaces" => json!(models::list_spaces(&c)?),
            "list_sources" => json!(models::list_sources(&c, &arg(a, "spaceId")?)?),
            "get_source_text" => json!(models::get_source_text(&c, &arg(a, "id")?)?),
            "source_outlines" => json!(context::space_outlines(&self.db, &arg(a, "spaceId")?)?),
            "search_chunks" => json!(self.ingest.search(
                &arg(a, "spaceId")?,
                &arg(a, "query")?,
                limit.unwrap_or(8),
                ids(a, "sourceIds").as_deref()
            )?),
            "search_many_chunks" => {
                let queries = ids(a, "queries").unwrap_or_default();
                json!(context::search_many(
                    &self.ingest,
                    &c,
                    &arg(a, "spaceId")?,
                    &queries,
                    limit.unwrap_or(20),
                    ids(a, "sourceIds").as_deref()
                )?)
            }
            "read_source_ranges" => {
                let reqs: Vec<context::RangeRequest> =
                    serde_json::from_value(a.get("ranges").cloned().unwrap_or(json!([])))?;
                json!(context::read_ranges(&c, &reqs)
                    .into_iter()
                    .map(|r| match r {
                        Ok(range) => json!({ "range": range, "error": null }),
                        Err(e) => json!({ "range": null, "error": e }),
                    })
                    .collect::<Vec<_>>())
            }
            "get_settings" => {
                let mut m = serde_json::Map::new();
                let mut st = c.prepare("SELECT key, value FROM settings")?;
                let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
                for r in rows {
                    let (k, v) = r?;
                    m.insert(k, serde_json::from_str(&v).unwrap_or(Value::String(v)));
                }
                Value::Object(m)
            }
            _ => return Err(invalid(format!("unknown command {cmd}"))),
        })
    }

    fn handle(&self, stream: TcpStream) -> std::io::Result<()> {
        let mut r = BufReader::new(stream.try_clone()?);
        let mut first = String::new();
        r.read_line(&mut first)?;
        let path = first.split_whitespace().nth(1).unwrap_or("/").to_string();
        let mut len = 0usize;
        loop {
            let mut line = String::new();
            r.read_line(&mut line)?;
            let l = line.trim_end();
            if l.is_empty() {
                break;
            }
            if let Some(v) = l.to_ascii_lowercase().strip_prefix("content-length:") {
                len = v.trim().parse().unwrap_or(0);
            }
        }
        let mut body = vec![0; len];
        r.read_exact(&mut body)?;
        let args: Value = serde_json::from_slice(&body).unwrap_or(json!({}));
        let cmd = path.trim_start_matches('/');
        let t0 = std::time::Instant::now();
        let res = self.call(cmd, &args);
        if std::env::var_os("DEV_SERVE_TIMING").is_some() {
            eprintln!("{cmd} {} ms", t0.elapsed().as_millis());
        }
        let out = match res {
            Ok(v) => json!({ "ok": v }),
            Err(e) => {
                let e: AppError = e;
                json!({ "error": e })
            }
        };
        let bytes = serde_json::to_vec(&out)?;
        let mut w = stream;
        write!(
            w,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            bytes.len()
        )?;
        w.write_all(&bytes)
    }
}

pub fn run(args: &[String]) -> i32 {
    let mut data: Option<PathBuf> = None;
    let mut port = 1499u16;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--data" => data = it.next().map(PathBuf::from),
            "--port" => port = it.next().and_then(|p| p.parse().ok()).unwrap_or(port),
            _ => {}
        }
    }
    let Some(data) = data else {
        eprintln!("usage: ponder dev-serve --data <copy of a data folder> [--port N]");
        return 2;
    };
    crate::secrets::init(&data);
    let db = match Db::open(data.join("app.db")) {
        Ok(db) => db,
        Err(e) => {
            eprintln!("can't open the database: {e}");
            return 1;
        }
    };
    let emit: Emit = Arc::new(|_, _| {});
    let model_id = db
        .conn()
        .ok()
        .and_then(|c| models::get_setting(&c, embed::SETTING_MODEL).ok().flatten())
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| embed::DEFAULT_MODEL.to_string());
    let embedder = Arc::new(embed::EmbedderService::new(
        data.join("models"),
        &model_id,
        emit.clone(),
        crate::ingest::remote_key(db.clone()),
    ));
    if embedder.ensure_loaded().is_none() {
        eprintln!("search model {model_id} isn't available; keyword search only");
    }
    let ingest = match Ingest::spawn(db.clone(), embedder, emit) {
        Ok(i) => i,
        Err(e) => {
            eprintln!("{e}");
            return 1;
        }
    };
    let server = Server { db, ingest };
    let listener = match TcpListener::bind(("127.0.0.1", port)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("can't listen on {port}: {e}");
            return 1;
        }
    };
    println!("dev-serve ready on http://127.0.0.1:{port}");
    for s in listener.incoming().flatten() {
        if let Err(e) = server.handle(s) {
            eprintln!("request failed: {e}");
        }
    }
    0
}
