//! Read-only MCP server (JSON-RPC 2.0, one message per line on stdio) over the app database.
use crate::error::{invalid, AppError, AppResult};
use crate::{paths, retrieval};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::Path;

const PROTOCOL: &str = "2025-06-18";
const SUPPORTED: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_TEXT_CHARS: usize = 20_000;
const MAX_TEXT_CHARS: usize = 100_000;
const MAX_LIMIT: i64 = 50;
const SNIPPET_CHARS: usize = 600;

const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;

fn tools() -> Value {
    json!([
        {
            "name": "list_spaces",
            "description": "List the learning spaces (id, name, number of sources and notes).",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
        },
        {
            "name": "list_sources",
            "description": "List the sources in a space.",
            "inputSchema": {
                "type": "object",
                "properties": { "space": { "type": "string", "description": "Space id or name." } },
                "required": ["space"],
            },
        },
        {
            "name": "search",
            "description": "Keyword search (FTS5, best match first) over the text chunks of the sources. Searches every space unless one is given.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "space": { "type": "string", "description": "Space id or name. Optional." },
                    "limit": { "type": "integer", "minimum": 1, "maximum": MAX_LIMIT, "description": "Default 8." },
                },
                "required": ["query"],
            },
        },
        {
            "name": "get_source_text",
            "description": "Text of a source by character range. Returns at most 100000 characters (20000 by default); check `truncated` and call again with a later `start`.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "source": { "type": "string", "description": "Source id." },
                    "start": { "type": "integer", "minimum": 0, "description": "First character. Default 0." },
                    "end": { "type": "integer", "minimum": 0, "description": "Character after the last one. Default start + 20000." },
                },
                "required": ["source"],
            },
        },
        {
            "name": "list_notes",
            "description": "List the notes in a space (without their text).",
            "inputSchema": {
                "type": "object",
                "properties": { "space": { "type": "string", "description": "Space id or name." } },
                "required": ["space"],
            },
        },
        {
            "name": "get_note",
            "description": "A note with its full text.",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"],
            },
        },
    ])
}

fn text_arg<'a>(args: &'a Value, key: &str) -> AppResult<&'a str> {
    match args.get(key).and_then(Value::as_str) {
        Some(s) if !s.trim().is_empty() => Ok(s),
        _ => Err(invalid(format!("`{key}` is required and must be a non-empty string."))),
    }
}

fn int_arg(args: &Value, key: &str) -> AppResult<Option<i64>> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match v.as_i64() {
            Some(n) if n >= 0 => Ok(Some(n)),
            _ => Err(invalid(format!("`{key}` must be a non-negative integer."))),
        },
    }
}

fn snippet(text: &str) -> String {
    if text.chars().count() <= SNIPPET_CHARS {
        return text.to_string();
    }
    let cut: String = text.chars().take(SNIPPET_CHARS).collect();
    format!("{cut}…")
}

fn list_spaces(c: &Connection) -> AppResult<Value> {
    let mut st = c.prepare(
        "SELECT s.id, s.name,
                (SELECT count(*) FROM sources x WHERE x.space_id = s.id),
                (SELECT count(*) FROM notes n WHERE n.space_id = s.id)
         FROM spaces s ORDER BY coalesce(s.last_opened_at, s.updated_at) DESC",
    )?;
    let rows = st
        .query_map([], |r| {
            Ok(json!({ "id": r.get::<_, String>(0)?, "name": r.get::<_, String>(1)?, "sources": r.get::<_, i64>(2)?, "notes": r.get::<_, i64>(3)? }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({ "spaces": rows }))
}

fn list_sources(c: &Connection, args: &Value) -> AppResult<Value> {
    let space = paths::resolve_space(c, text_arg(args, "space")?)?;
    let mut st = c.prepare(
        "SELECT id, title, kind, origin, status, char_count, chunk_count, summary FROM sources WHERE space_id = ?1 ORDER BY created_at, id",
    )?;
    let rows = st
        .query_map([&space], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "title": r.get::<_, String>(1)?,
                "kind": r.get::<_, String>(2)?,
                "origin": r.get::<_, Option<String>>(3)?,
                "status": r.get::<_, String>(4)?,
                "chars": r.get::<_, i64>(5)?,
                "chunks": r.get::<_, i64>(6)?,
                "summary": r.get::<_, Option<String>>(7)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({ "space": space, "sources": rows }))
}

fn search(c: &Connection, args: &Value) -> AppResult<Value> {
    let query = text_arg(args, "query")?;
    let space = match args.get("space").and_then(Value::as_str).filter(|s| !s.trim().is_empty()) {
        Some(s) => Some(paths::resolve_space(c, s)?),
        None => None,
    };
    let limit = int_arg(args, "limit")?.unwrap_or(8).clamp(1, MAX_LIMIT);
    let Some(m) = retrieval::fts_query(query) else {
        return Ok(json!({ "results": [] }));
    };
    let mut st = c.prepare(
        "SELECT c.id, c.source_id, s.title, c.space_id, c.ord, c.text, c.start_offset, c.end_offset, c.page, c.heading
         FROM chunks_fts f
         JOIN chunks c ON c.id = f.rowid
         JOIN sources s ON s.id = c.source_id
         WHERE chunks_fts MATCH ?1 AND (?2 IS NULL OR c.space_id = ?2)
         ORDER BY bm25(chunks_fts) LIMIT ?3",
    )?;
    let rows = st
        .query_map(params![m, space, limit], |r| {
            Ok(json!({
                "source": r.get::<_, String>(1)?,
                "sourceTitle": r.get::<_, String>(2)?,
                "space": r.get::<_, String>(3)?,
                "text": snippet(&r.get::<_, String>(5)?),
                "start": r.get::<_, i64>(6)?,
                "end": r.get::<_, i64>(7)?,
                "page": r.get::<_, Option<i64>>(8)?,
                "heading": r.get::<_, Option<String>>(9)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({ "results": rows }))
}

fn get_source_text(c: &Connection, args: &Value) -> AppResult<Value> {
    let id = text_arg(args, "source")?;
    let (title, text): (String, String) = c
        .query_row(
            "SELECT s.title, t.text FROM sources s JOIN source_texts t ON t.source_id = s.id WHERE s.id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Source text for “{id}”")),
            e => e.into(),
        })?;
    let total = text.chars().count();
    let start = int_arg(args, "start")?.unwrap_or(0) as usize;
    let wanted_end = int_arg(args, "end")?.map(|e| e as usize).unwrap_or(start.saturating_add(DEFAULT_TEXT_CHARS));
    if wanted_end < start {
        return Err(invalid("`end` must not be before `start`."));
    }
    let end = wanted_end.min(start.saturating_add(MAX_TEXT_CHARS)).min(total);
    let start = start.min(total);
    let slice: String = text.chars().skip(start).take(end - start).collect();
    Ok(json!({ "source": id, "title": title, "start": start, "end": end, "totalChars": total, "truncated": end < total, "text": slice }))
}

fn list_notes(c: &Connection, args: &Value) -> AppResult<Value> {
    let space = paths::resolve_space(c, text_arg(args, "space")?)?;
    let mut st = c.prepare(
        "SELECT id, title, use_as_source, length(body), updated_at FROM notes WHERE space_id = ?1 ORDER BY updated_at DESC, id",
    )?;
    let rows = st
        .query_map([&space], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "title": r.get::<_, String>(1)?,
                "useAsSource": r.get::<_, i64>(2)? != 0,
                "chars": r.get::<_, i64>(3)?,
                "updatedAt": r.get::<_, i64>(4)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({ "space": space, "notes": rows }))
}

fn get_note(c: &Connection, args: &Value) -> AppResult<Value> {
    let id = text_arg(args, "id")?;
    c.query_row("SELECT id, space_id, title, body, updated_at FROM notes WHERE id = ?1", [id], |r| {
        Ok(json!({ "id": r.get::<_, String>(0)?, "space": r.get::<_, String>(1)?, "title": r.get::<_, String>(2)?, "body": r.get::<_, String>(3)?, "updatedAt": r.get::<_, i64>(4)? }))
    })
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Note “{id}”")),
        e => e.into(),
    })
}

fn call_tool(c: &Connection, name: &str, args: &Value) -> Option<AppResult<Value>> {
    Some(match name {
        "list_spaces" => list_spaces(c),
        "list_sources" => list_sources(c, args),
        "search" => search(c, args),
        "get_source_text" => get_source_text(c, args),
        "list_notes" => list_notes(c, args),
        "get_note" => get_note(c, args),
        _ => return None,
    })
}

fn rpc_error(id: Value, code: i64, message: impl Into<String>) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message.into() } })
}

fn rpc_result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

/// The response for one parsed message, or None for notifications.
fn handle(c: &Connection, msg: &Value) -> Option<Value> {
    let Some(obj) = msg.as_object().filter(|o| o.get("jsonrpc").and_then(Value::as_str) == Some("2.0")) else {
        return Some(rpc_error(Value::Null, INVALID_REQUEST, "Not a JSON-RPC 2.0 request."));
    };
    let id = obj.get("id").cloned();
    let Some(method) = obj.get("method").and_then(Value::as_str) else {
        return Some(rpc_error(id.unwrap_or(Value::Null), INVALID_REQUEST, "Missing `method`."));
    };
    let id = id?;
    if !matches!(id, Value::String(_) | Value::Number(_)) {
        return Some(rpc_error(Value::Null, INVALID_REQUEST, "`id` must be a string or number."));
    }
    let params = obj.get("params").cloned().unwrap_or(Value::Null);
    Some(match method {
        "initialize" => {
            let asked = params.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL);
            let version = if SUPPORTED.contains(&asked) { asked } else { PROTOCOL };
            rpc_result(
                id,
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "ponder", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": "Read-only access to the Ponder learning app: spaces, sources, notes and keyword search.",
                }),
            )
        }
        "ping" => rpc_result(id, json!({})),
        "tools/list" => rpc_result(id, json!({ "tools": tools() })),
        "tools/call" => {
            let Some(name) = params.get("name").and_then(Value::as_str) else {
                return Some(rpc_error(id, INVALID_PARAMS, "`name` is required."));
            };
            let args = match params.get("arguments") {
                None | Some(Value::Null) => json!({}),
                Some(a) if a.is_object() => a.clone(),
                Some(_) => return Some(rpc_error(id, INVALID_PARAMS, "`arguments` must be an object.")),
            };
            match call_tool(c, name, &args) {
                None => rpc_error(id, INVALID_PARAMS, format!("Unknown tool “{name}”.")),
                Some(Ok(v)) => rpc_result(
                    id,
                    json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&v).unwrap_or_default() }], "structuredContent": v, "isError": false }),
                ),
                Some(Err(e)) => rpc_result(id, json!({ "content": [{ "type": "text", "text": e.to_string() }], "isError": true })),
            }
        }
        other => rpc_error(id, METHOD_NOT_FOUND, format!("Method not found: {other}")),
    })
}

/// Serves requests from `input` until it ends. Batches are answered as arrays.
pub fn serve(input: impl BufRead, mut output: impl Write, conn: &Connection) -> std::io::Result<()> {
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Err(e) => Some(rpc_error(Value::Null, PARSE_ERROR, format!("Parse error: {e}"))),
            Ok(Value::Array(items)) if items.is_empty() => Some(rpc_error(Value::Null, INVALID_REQUEST, "Empty batch.")),
            Ok(Value::Array(items)) => {
                let out: Vec<Value> = items.iter().filter_map(|m| handle(conn, m)).collect();
                (!out.is_empty()).then_some(Value::Array(out))
            }
            Ok(msg) => handle(conn, &msg),
        };
        if let Some(r) = reply {
            writeln!(output, "{r}")?;
            output.flush()?;
        }
    }
    Ok(())
}

/// Entry point for the `ponder-mcp` binary and `ponder mcp`. `args` excludes the program name.
pub fn run_stdio(args: &[String]) -> i32 {
    let mut db: Option<&str> = None;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--db" => match it.next() {
                Some(v) => db = Some(v),
                None => {
                    eprintln!("ponder-mcp: --db needs a path");
                    return 2;
                }
            },
            "--help" | "-h" => {
                eprintln!("Usage: ponder-mcp [--db <path>]\nRead-only MCP server over stdio for the Ponder database.");
                return 0;
            }
            other => {
                eprintln!("ponder-mcp: unknown argument “{other}”");
                return 2;
            }
        }
    }
    let conn = match paths::resolve_db(db).and_then(|p| paths::open_readonly(Path::new(&p))) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("ponder-mcp: {e}");
            return 1;
        }
    };
    let stdin = std::io::stdin();
    match serve(stdin.lock(), std::io::stdout().lock(), &conn) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("ponder-mcp: {e}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seeded() -> (tempfile::TempDir, Connection) {
        let (db, dir) = crate::db::test_db();
        {
            let c = db.conn().unwrap();
            c.execute("INSERT INTO spaces (id,name,created_at,updated_at) VALUES ('s1','Biology',1,5),('s2','Algebra',1,9)", []).unwrap();
            c.execute("INSERT INTO sources (id,space_id,title,kind,created_at,updated_at,char_count,chunk_count) VALUES ('a','s1','Cells','text',1,1,26,2)", []).unwrap();
            c.execute("INSERT INTO sources (id,space_id,title,kind,created_at,updated_at) VALUES ('b','s2','Equations','text',2,2)", []).unwrap();
            c.execute("INSERT INTO source_texts (source_id,text) VALUES ('a','Chloroplasts make sugar. Mitochondria burn it.')", []).unwrap();
            for (i, (src, sp, t)) in [("a", "s1", "Chloroplasts make sugar."), ("a", "s1", "Mitochondria burn it."), ("b", "s2", "Chloroplasts of equations")].into_iter().enumerate() {
                c.execute(
                    "INSERT INTO chunks (source_id,space_id,ord,text,start_offset,end_offset) VALUES (?1,?2,?3,?4,0,1)",
                    params![src, sp, i as i64, t],
                )
                .unwrap();
            }
            c.execute("INSERT INTO notes (id,space_id,title,body,created_at,updated_at) VALUES ('n1','s1','Osmosis','Water moves across a membrane.',1,3)", []).unwrap();
        }
        let ro = paths::open_readonly(db.path()).unwrap();
        (dir, ro)
    }

    fn talk(conn: &Connection, lines: &[&str]) -> Vec<Value> {
        let input = lines.join("\n") + "\n";
        let mut out = vec![];
        serve(input.as_bytes(), &mut out, conn).unwrap();
        String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect()
    }

    fn call(conn: &Connection, tool: &str, args: Value) -> Value {
        let req = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": tool, "arguments": args } }).to_string();
        talk(conn, &[&req]).remove(0)
    }

    #[test]
    fn handshake_and_tool_list() {
        let (_d, c) = seeded();
        let out = talk(
            &c,
            &[
                r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}"#,
                r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
                r#"{"jsonrpc":"2.0","id":"x","method":"tools/list"}"#,
                r#"{"jsonrpc":"2.0","id":3,"method":"ping"}"#,
            ],
        );
        assert_eq!(out.len(), 3, "notification gets no reply");
        assert_eq!(out[0]["result"]["protocolVersion"], "2024-11-05");
        assert_eq!(out[0]["result"]["serverInfo"]["name"], "ponder");
        assert!(out[0]["result"]["capabilities"]["tools"].is_object());
        assert_eq!(out[1]["id"], "x");
        let names: Vec<&str> = out[1]["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["list_spaces", "list_sources", "search", "get_source_text", "list_notes", "get_note"]);
        assert_eq!(out[2]["result"], json!({}));
    }

    #[test]
    fn protocol_errors() {
        let (_d, c) = seeded();
        let out = talk(
            &c,
            &[
                "{not json",
                r#"{"jsonrpc":"2.0","id":1,"method":"nope"}"#,
                r#"{"jsonrpc":"1.0","id":2,"method":"ping"}"#,
                r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"drop_tables"}}"#,
                r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{}}"#,
                r#"[]"#,
            ],
        );
        assert_eq!(out[0]["error"]["code"], PARSE_ERROR);
        assert_eq!(out[1]["error"]["code"], METHOD_NOT_FOUND);
        assert_eq!(out[2]["error"]["code"], INVALID_REQUEST);
        assert_eq!(out[3]["error"]["code"], INVALID_PARAMS);
        assert_eq!(out[4]["error"]["code"], INVALID_PARAMS);
        assert_eq!(out[5]["error"]["code"], INVALID_REQUEST);
    }

    #[test]
    fn lists_spaces_sources_and_notes() {
        let (_d, c) = seeded();
        let r = call(&c, "list_spaces", json!({}));
        let spaces = &r["result"]["structuredContent"]["spaces"];
        assert_eq!(spaces[0]["name"], "Algebra");
        assert_eq!(spaces[1]["sources"], 1);
        assert_eq!(spaces[1]["notes"], 1);

        let r = call(&c, "list_sources", json!({ "space": "biology" }));
        let src = &r["result"]["structuredContent"]["sources"];
        assert_eq!(src.as_array().unwrap().len(), 1);
        assert_eq!(src[0]["title"], "Cells");

        let r = call(&c, "list_notes", json!({ "space": "s1" }));
        assert_eq!(r["result"]["structuredContent"]["notes"][0]["title"], "Osmosis");
        assert!(r["result"]["structuredContent"]["notes"][0].get("body").is_none());

        let r = call(&c, "get_note", json!({ "id": "n1" }));
        assert_eq!(r["result"]["structuredContent"]["body"], "Water moves across a membrane.");
    }

    #[test]
    fn tool_errors_are_results_with_is_error() {
        let (_d, c) = seeded();
        for (tool, args) in [
            ("list_sources", json!({ "space": "Chemistry" })),
            ("list_sources", json!({})),
            ("get_note", json!({ "id": "missing" })),
            ("get_source_text", json!({ "source": "missing" })),
            ("get_source_text", json!({ "source": "a", "start": 10, "end": 2 })),
            ("search", json!({ "query": "x", "limit": -1 })),
        ] {
            let r = call(&c, tool, args);
            assert_eq!(r["result"]["isError"], true, "{tool}: {r}");
            assert!(r["result"]["content"][0]["text"].as_str().unwrap().len() > 3);
        }
    }

    #[test]
    fn searches_chunks_by_keyword() {
        let (_d, c) = seeded();
        let r = call(&c, "search", json!({ "query": "chloroplasts" }));
        assert_eq!(r["result"]["structuredContent"]["results"].as_array().unwrap().len(), 2);

        let r = call(&c, "search", json!({ "query": "chloroplasts", "space": "Biology" }));
        let hits = r["result"]["structuredContent"]["results"].as_array().unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0]["source"], "a");
        assert_eq!(hits[0]["sourceTitle"], "Cells");

        let r = call(&c, "search", json!({ "query": "chloroplasts", "limit": 1 }));
        assert_eq!(r["result"]["structuredContent"]["results"].as_array().unwrap().len(), 1);
        let r = call(&c, "search", json!({ "query": "\"*()" }));
        assert_eq!(r["result"]["structuredContent"]["results"], json!([]));
    }

    #[test]
    fn source_text_is_bounded_and_ranged() {
        let (_d, c) = seeded();
        let r = call(&c, "get_source_text", json!({ "source": "a", "start": 0, "end": 11 }));
        let v = &r["result"]["structuredContent"];
        assert_eq!(v["text"], "Chloroplast");
        assert_eq!(v["truncated"], true);
        assert_eq!(v["totalChars"], 46);

        let r = call(&c, "get_source_text", json!({ "source": "a", "start": 25 }));
        let v = &r["result"]["structuredContent"];
        assert_eq!(v["text"], "Mitochondria burn it.");
        assert_eq!(v["truncated"], false);

        let r = call(&c, "get_source_text", json!({ "source": "a", "start": 500 }));
        assert_eq!(r["result"]["structuredContent"]["text"], "");
    }

    #[test]
    fn caps_large_ranges() {
        let (db, _dir) = crate::db::test_db();
        let c = db.conn().unwrap();
        c.execute("INSERT INTO spaces (id,name,created_at,updated_at) VALUES ('s','S',1,1)", []).unwrap();
        c.execute("INSERT INTO sources (id,space_id,title,kind,created_at,updated_at) VALUES ('big','s','Big','text',1,1)", []).unwrap();
        c.execute("INSERT INTO source_texts (source_id,text) VALUES ('big', ?1)", [&"é".repeat(250_000)]).unwrap();
        let ro = paths::open_readonly(db.path()).unwrap();
        let r = call(&ro, "get_source_text", json!({ "source": "big" }));
        assert_eq!(r["result"]["structuredContent"]["text"].as_str().unwrap().chars().count(), DEFAULT_TEXT_CHARS);
        let r = call(&ro, "get_source_text", json!({ "source": "big", "end": 10_000_000 }));
        let v = &r["result"]["structuredContent"];
        assert_eq!(v["text"].as_str().unwrap().chars().count(), MAX_TEXT_CHARS);
        assert_eq!(v["truncated"], true);
    }

    #[test]
    fn database_is_read_only() {
        let (_d, c) = seeded();
        assert!(c.execute("DELETE FROM notes", []).is_err());
    }
}
