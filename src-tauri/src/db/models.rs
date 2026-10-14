use super::{new_id, now_ms};
use crate::error::{invalid, invalid_key, AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;

fn json_col(row: &Row, idx: &str) -> rusqlite::Result<Option<Value>> {
    let s: Option<String> = row.get(idx)?;
    Ok(s.and_then(|s| serde_json::from_str(&s).ok()))
}

fn json_str(v: &Option<Value>) -> Option<String> {
    match v {
        None | Some(Value::Null) => None,
        Some(v) => Some(v.to_string()),
    }
}

// ---------- spaces ----------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Space {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub tutor_style: String,
    pub strict_grounding: bool,
    pub model_override: Option<Value>,
    pub language: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_opened_at: Option<i64>,
    pub recap: Option<String>,
    pub source_count: i64,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SpacePatch {
    pub name: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub tutor_style: Option<String>,
    pub strict_grounding: Option<bool>,
    /// `null` clears the override
    #[serde(default, deserialize_with = "deserialize_some")]
    pub model_override: Option<Option<Value>>,
    pub recap: Option<String>,
    /// BCP-47 code the tutor answers in; `null` follows the app language
    #[serde(default, deserialize_with = "deserialize_some")]
    pub language: Option<Option<String>>,
}

fn deserialize_some<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(d).map(Some)
}

const TUTOR_STYLES: &[&str] = &["direct", "socratic", "mixed"];

/// A BCP-47 language tag such as "de" or "pt-BR".
fn valid_language(tag: &str) -> bool {
    !tag.is_empty()
        && tag.len() <= 16
        && tag.split('-').all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric()))
}

fn space_from_row(r: &Row) -> rusqlite::Result<Space> {
    Ok(Space {
        id: r.get("id")?,
        name: r.get("name")?,
        icon: r.get("icon")?,
        color: r.get("color")?,
        tutor_style: r.get("tutor_style")?,
        strict_grounding: r.get::<_, i64>("strict_grounding")? != 0,
        model_override: json_col(r, "model_override")?,
        language: r.get("language")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        last_opened_at: r.get("last_opened_at")?,
        recap: r.get("recap")?,
        source_count: r.get("source_count")?,
    })
}

const SPACE_SELECT: &str = "SELECT s.*, (SELECT count(*) FROM sources WHERE space_id = s.id) AS source_count FROM spaces s";

pub fn list_spaces(c: &Connection) -> AppResult<Vec<Space>> {
    let mut st = c.prepare(&format!(
        "{SPACE_SELECT} ORDER BY coalesce(s.last_opened_at, s.created_at) DESC"
    ))?;
    let rows = st.query_map([], space_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get_space(c: &Connection, id: &str) -> AppResult<Space> {
    c.query_row(
        &format!("{SPACE_SELECT} WHERE s.id = ?1"),
        [id],
        space_from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound("space".into()))
}

pub fn create_space(c: &Connection, p: SpacePatch) -> AppResult<Space> {
    let name = p.name.as_deref().map(str::trim).unwrap_or("");
    if name.is_empty() {
        return Err(invalid_key("spaceNameEmpty", "Space name can't be empty"));
    }
    let id = new_id();
    let now = now_ms();
    c.execute(
        "INSERT INTO spaces (id, name, icon, color, tutor_style, strict_grounding, model_override, language, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?9, ?8, ?8)",
        params![
            id,
            name,
            p.icon.unwrap_or_else(|| "book".into()),
            p.color.unwrap_or_else(|| "blue".into()),
            p.tutor_style.unwrap_or_else(|| "mixed".into()),
            p.strict_grounding.unwrap_or(false) as i64,
            p.model_override.flatten().as_ref().map(|v| v.to_string()),
            now,
            p.language.flatten().filter(|l| valid_language(l))
        ],
    )?;
    get_space(c, &id)
}

pub fn update_space(c: &Connection, id: &str, p: SpacePatch) -> AppResult<Space> {
    let cur = get_space(c, id)?;
    let name = p.name.map(|n| n.trim().to_string()).unwrap_or(cur.name);
    if name.is_empty() {
        return Err(invalid_key("spaceNameEmpty", "Space name can't be empty"));
    }
    let tutor = p.tutor_style.unwrap_or(cur.tutor_style);
    if !TUTOR_STYLES.contains(&tutor.as_str()) {
        return Err(invalid(format!("Unknown tutor style: {tutor}")));
    }
    let model = match p.model_override {
        Some(v) => v,
        None => cur.model_override,
    };
    let language = match p.language {
        Some(v) => v.filter(|l| valid_language(l)),
        None => cur.language,
    };
    c.execute(
        "UPDATE spaces SET name=?2, icon=?3, color=?4, tutor_style=?5, strict_grounding=?6, model_override=?7, recap=?8, updated_at=?9, language=?10 WHERE id=?1",
        params![
            id,
            name,
            p.icon.unwrap_or(cur.icon),
            p.color.unwrap_or(cur.color),
            tutor,
            p.strict_grounding.unwrap_or(cur.strict_grounding) as i64,
            json_str(&model),
            p.recap.or(cur.recap),
            now_ms(),
            language
        ],
    )?;
    get_space(c, id)
}

pub fn touch_space(c: &Connection, id: &str) -> AppResult<()> {
    c.execute(
        "UPDATE spaces SET last_opened_at=?2 WHERE id=?1",
        params![id, now_ms()],
    )?;
    Ok(())
}

pub fn delete_space(c: &Connection, id: &str) -> AppResult<()> {
    let n = c.execute("DELETE FROM spaces WHERE id=?1", [id])?;
    if n == 0 {
        return Err(AppError::NotFound("space".into()));
    }
    Ok(())
}

// ---------- sources ----------

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub space_id: String,
    pub title: String,
    pub kind: String,
    pub origin: Option<String>,
    pub status: String,
    pub error: Option<String>,
    pub summary: Option<String>,
    pub use_in_chat: bool,
    pub progress: f64,
    pub char_count: i64,
    pub chunk_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourcePatch {
    pub title: Option<String>,
    pub use_in_chat: Option<bool>,
    pub summary: Option<String>,
}

fn source_from_row(r: &Row) -> rusqlite::Result<Source> {
    Ok(Source {
        id: r.get("id")?,
        space_id: r.get("space_id")?,
        title: r.get("title")?,
        kind: r.get("kind")?,
        origin: r.get("origin")?,
        status: r.get("status")?,
        error: r.get("error")?,
        summary: r.get("summary")?,
        use_in_chat: r.get::<_, i64>("use_in_chat")? != 0,
        progress: r.get("progress")?,
        char_count: r.get("char_count")?,
        chunk_count: r.get("chunk_count")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

pub fn list_sources(c: &Connection, space_id: &str) -> AppResult<Vec<Source>> {
    let mut st = c.prepare("SELECT * FROM sources WHERE space_id=?1 ORDER BY created_at DESC")?;
    let rows = st.query_map([space_id], source_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get_source(c: &Connection, id: &str) -> AppResult<Source> {
    c.query_row("SELECT * FROM sources WHERE id=?1", [id], source_from_row)
        .optional()?
        .ok_or_else(|| AppError::NotFound("source".into()))
}

pub fn insert_source(
    c: &Connection,
    space_id: &str,
    title: &str,
    kind: &str,
    origin: Option<&str>,
) -> AppResult<Source> {
    let id = new_id();
    let now = now_ms();
    c.execute(
        "INSERT INTO sources (id, space_id, title, kind, origin, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'processing', ?6, ?6)",
        params![id, space_id, title, kind, origin, now],
    )?;
    get_source(c, &id)
}

pub fn update_source(c: &Connection, id: &str, p: SourcePatch) -> AppResult<Source> {
    let cur = get_source(c, id)?;
    c.execute(
        "UPDATE sources SET title=?2, use_in_chat=?3, summary=?4, updated_at=?5 WHERE id=?1",
        params![
            id,
            p.title.unwrap_or(cur.title),
            p.use_in_chat.unwrap_or(cur.use_in_chat) as i64,
            p.summary.or(cur.summary),
            now_ms()
        ],
    )?;
    get_source(c, id)
}

pub fn set_source_status(
    c: &Connection,
    id: &str,
    status: &str,
    error: Option<&str>,
    progress: f64,
) -> AppResult<()> {
    c.execute(
        "UPDATE sources SET status=?2, error=?3, progress=?4, updated_at=?5 WHERE id=?1",
        params![id, status, error, progress, now_ms()],
    )?;
    Ok(())
}

pub fn delete_source(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM sources WHERE id=?1", [id])?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceText {
    pub text: String,
    /// [page, start_offset] pairs, ascending; offsets are in UTF-16 code units, matching JS strings
    pub pages: Option<Value>,
}

pub fn get_source_text(c: &Connection, id: &str) -> AppResult<SourceText> {
    c.query_row(
        "SELECT text, pages FROM source_texts WHERE source_id=?1",
        [id],
        |r| {
            Ok(SourceText {
                text: r.get(0)?,
                pages: json_col(r, "pages")?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound("source text".into()))
}

// ---------- threads + messages ----------

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub id: String,
    pub space_id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub pinned: bool,
}

fn thread_from_row(r: &Row) -> rusqlite::Result<Thread> {
    Ok(Thread {
        id: r.get("id")?,
        space_id: r.get("space_id")?,
        title: r.get("title")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        pinned: r.get::<_, i64>("pinned")? != 0,
    })
}

pub fn list_threads(c: &Connection, space_id: &str) -> AppResult<Vec<Thread>> {
    let mut st =
        c.prepare("SELECT * FROM threads WHERE space_id=?1 ORDER BY pinned DESC, updated_at DESC")?;
    let rows = st.query_map([space_id], thread_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get_thread(c: &Connection, id: &str) -> AppResult<Thread> {
    c.query_row("SELECT * FROM threads WHERE id=?1", [id], thread_from_row)
        .optional()?
        .ok_or_else(|| AppError::NotFound("thread".into()))
}

pub fn create_thread(c: &Connection, space_id: &str, title: Option<String>) -> AppResult<Thread> {
    let id = new_id();
    let now = now_ms();
    c.execute(
        "INSERT INTO threads (id, space_id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, space_id, title.unwrap_or_else(|| "New chat".into()), now],
    )?;
    get_thread(c, &id)
}

pub fn rename_thread(c: &Connection, id: &str, title: &str) -> AppResult<Thread> {
    let t = title.trim();
    if t.is_empty() {
        return Err(invalid("Title can't be empty"));
    }
    c.execute(
        "UPDATE threads SET title=?2, updated_at=?3 WHERE id=?1",
        params![id, t, now_ms()],
    )?;
    get_thread(c, id)
}

pub fn set_thread_pinned(c: &Connection, id: &str, pinned: bool) -> AppResult<Thread> {
    c.execute(
        "UPDATE threads SET pinned=?2 WHERE id=?1",
        params![id, pinned as i64],
    )?;
    get_thread(c, id)
}

pub fn delete_thread(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM threads WHERE id=?1", [id])?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub thread_id: String,
    pub role: String,
    pub content: String,
    pub reasoning: Option<String>,
    pub citations: Option<Value>,
    pub meta: Option<Value>,
    pub status: String,
    pub error: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMessage {
    pub thread_id: String,
    pub role: String,
    #[serde(default)]
    pub content: String,
    pub reasoning: Option<String>,
    pub citations: Option<Value>,
    pub meta: Option<Value>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MessagePatch {
    pub content: Option<String>,
    pub reasoning: Option<String>,
    pub citations: Option<Value>,
    pub meta: Option<Value>,
    pub status: Option<String>,
    pub error: Option<String>,
}

const ROLES: &[&str] = &["user", "assistant", "buddy", "system", "practice"];

fn message_from_row(r: &Row) -> rusqlite::Result<Message> {
    Ok(Message {
        id: r.get("id")?,
        thread_id: r.get("thread_id")?,
        role: r.get("role")?,
        content: r.get("content")?,
        reasoning: r.get("reasoning")?,
        citations: json_col(r, "citations")?,
        meta: json_col(r, "meta")?,
        status: r.get("status")?,
        error: r.get("error")?,
        created_at: r.get("created_at")?,
    })
}

pub fn list_messages(c: &Connection, thread_id: &str) -> AppResult<Vec<Message>> {
    let mut st =
        c.prepare("SELECT * FROM messages WHERE thread_id=?1 ORDER BY created_at, rowid")?;
    let rows = st.query_map([thread_id], message_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get_message(c: &Connection, id: &str) -> AppResult<Message> {
    c.query_row("SELECT * FROM messages WHERE id=?1", [id], message_from_row)
        .optional()?
        .ok_or_else(|| AppError::NotFound("message".into()))
}

pub fn add_message(c: &Connection, m: NewMessage) -> AppResult<Message> {
    if !ROLES.contains(&m.role.as_str()) {
        return Err(invalid(format!("Unknown role: {}", m.role)));
    }
    let id = new_id();
    let now = now_ms();
    c.execute(
        "INSERT INTO messages (id, thread_id, role, content, reasoning, citations, meta, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            m.thread_id,
            m.role,
            m.content,
            m.reasoning,
            json_str(&m.citations),
            json_str(&m.meta),
            m.status.unwrap_or_else(|| "complete".into()),
            now
        ],
    )?;
    c.execute(
        "UPDATE threads SET updated_at=?2 WHERE id=?1",
        params![m.thread_id, now],
    )?;
    get_message(c, &id)
}

pub fn update_message(c: &Connection, id: &str, p: MessagePatch) -> AppResult<Message> {
    let cur = get_message(c, id)?;
    c.execute(
        "UPDATE messages SET content=?2, reasoning=?3, citations=?4, meta=?5, status=?6, error=?7 WHERE id=?1",
        params![
            id,
            p.content.unwrap_or(cur.content),
            p.reasoning.or(cur.reasoning),
            json_str(&p.citations.or(cur.citations)),
            json_str(&p.meta.or(cur.meta)),
            p.status.unwrap_or(cur.status),
            p.error.or(cur.error),
        ],
    )?;
    get_message(c, id)
}

pub fn delete_message(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM messages WHERE id=?1", [id])?;
    Ok(())
}

// ---------- journal ----------

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub id: String,
    pub space_id: String,
    pub kind: String,
    pub title: String,
    pub content: String,
    pub created_at: i64,
}

pub fn list_journal(c: &Connection, space_id: &str) -> AppResult<Vec<JournalEntry>> {
    let mut st = c.prepare(
        "SELECT id, space_id, kind, title, content, created_at FROM journal_entries WHERE space_id=?1 ORDER BY created_at DESC",
    )?;
    let rows = st.query_map([space_id], |r| {
        Ok(JournalEntry {
            id: r.get(0)?,
            space_id: r.get(1)?,
            kind: r.get(2)?,
            title: r.get(3)?,
            content: r.get(4)?,
            created_at: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn add_journal(
    c: &Connection,
    space_id: &str,
    kind: &str,
    title: &str,
    content: &str,
) -> AppResult<JournalEntry> {
    let e = JournalEntry {
        id: new_id(),
        space_id: space_id.into(),
        kind: kind.into(),
        title: title.into(),
        content: content.into(),
        created_at: now_ms(),
    };
    c.execute(
        "INSERT INTO journal_entries (id, space_id, kind, title, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![e.id, e.space_id, e.kind, e.title, e.content, e.created_at],
    )?;
    Ok(e)
}

// ---------- providers (no secrets here, see secrets.rs) ----------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: String,
    /// anthropic | openai | google | openrouter | xai | groq | mistral | deepseek | openai-compatible
    /// | lmstudio | ollama | llamacpp | chatgpt-oauth | xai-oauth
    #[serde(rename = "type")]
    pub provider_type: String,
    /// apiKey | oauth | local
    pub kind: String,
    pub name: String,
    pub base_url: Option<String>,
    #[serde(default)]
    pub config: Value,
    #[serde(default)]
    pub created_at: i64,
}

pub fn list_providers(c: &Connection) -> AppResult<Vec<Provider>> {
    let mut st = c.prepare("SELECT * FROM providers ORDER BY created_at")?;
    let rows = st.query_map([], |r| {
        Ok(Provider {
            id: r.get("id")?,
            provider_type: r.get("type")?,
            kind: r.get("kind")?,
            name: r.get("name")?,
            base_url: r.get("base_url")?,
            config: json_col(r, "config")?.unwrap_or(Value::Object(Default::default())),
            created_at: r.get("created_at")?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get_provider(c: &Connection, id: &str) -> AppResult<Provider> {
    list_providers(c)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| AppError::NotFound("provider".into()))
}

pub fn save_provider(c: &Connection, mut p: Provider) -> AppResult<Provider> {
    if p.name.trim().is_empty() {
        return Err(invalid("Provider name can't be empty"));
    }
    if p.id.is_empty() {
        p.id = new_id();
    }
    if p.created_at == 0 {
        p.created_at = now_ms();
    }
    c.execute(
        "INSERT INTO providers (id, type, kind, name, base_url, config, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET type=?2, kind=?3, name=?4, base_url=?5, config=?6",
        params![p.id, p.provider_type, p.kind, p.name, p.base_url, p.config.to_string(), p.created_at],
    )?;
    get_provider(c, &p.id)
}

pub fn delete_provider(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM providers WHERE id=?1", [id])?;
    Ok(())
}

// ---------- learner memory ----------

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoryItem {
    pub id: String,
    pub text: String,
    /// user | tutor
    pub origin: String,
    pub space_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

fn memory_from_row(r: &Row) -> rusqlite::Result<MemoryItem> {
    Ok(MemoryItem {
        id: r.get("id")?,
        text: r.get("text")?,
        origin: r.get("origin")?,
        space_id: r.get("space_id")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

pub fn list_memory(c: &Connection) -> AppResult<Vec<MemoryItem>> {
    let mut st = c.prepare("SELECT * FROM learner_memory ORDER BY created_at DESC")?;
    let rows = st.query_map([], memory_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn add_memory(
    c: &Connection,
    text: &str,
    origin: &str,
    space_id: Option<&str>,
) -> AppResult<MemoryItem> {
    let text = text.trim();
    if text.is_empty() {
        return Err(invalid("Memory text can't be empty"));
    }
    if text.chars().count() > 500 {
        return Err(invalid("Keep a memory under 500 characters"));
    }
    if origin != "user" && origin != "tutor" {
        return Err(invalid(format!("Unknown memory origin: {origin}")));
    }
    let existing: Option<String> = c
        .query_row(
            "SELECT id FROM learner_memory WHERE lower(text) = lower(?1)",
            [text],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(id) = existing {
        return c
            .query_row(
                "SELECT * FROM learner_memory WHERE id=?1",
                [id],
                memory_from_row,
            )
            .map_err(Into::into);
    }
    let id = new_id();
    let now = now_ms();
    c.execute(
        "INSERT INTO learner_memory (id, text, origin, space_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, text, origin, space_id, now],
    )?;
    Ok(c.query_row(
        "SELECT * FROM learner_memory WHERE id=?1",
        [id],
        memory_from_row,
    )?)
}

pub fn update_memory(c: &Connection, id: &str, text: &str) -> AppResult<MemoryItem> {
    let text = text.trim();
    if text.is_empty() {
        return Err(invalid("Memory text can't be empty"));
    }
    let n = c.execute(
        "UPDATE learner_memory SET text=?2, updated_at=?3 WHERE id=?1",
        params![id, text, now_ms()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound("memory".into()));
    }
    Ok(c.query_row(
        "SELECT * FROM learner_memory WHERE id=?1",
        [id],
        memory_from_row,
    )?)
}

pub fn delete_memory(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM learner_memory WHERE id=?1", [id])?;
    Ok(())
}

// ---------- settings ----------

pub fn get_settings(c: &Connection) -> AppResult<serde_json::Map<String, Value>> {
    let mut st = c.prepare("SELECT key, value FROM settings")?;
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut map = serde_json::Map::new();
    for row in rows {
        let (k, v) = row?;
        map.insert(k, serde_json::from_str(&v).unwrap_or(Value::Null));
    }
    Ok(map)
}

pub fn get_setting(c: &Connection, key: &str) -> AppResult<Option<Value>> {
    let v: Option<String> = c
        .query_row("SELECT value FROM settings WHERE key=?1", [key], |r| {
            r.get(0)
        })
        .optional()?;
    Ok(v.and_then(|s| serde_json::from_str(&s).ok()))
}

pub fn set_setting(c: &Connection, key: &str, value: &Value) -> AppResult<()> {
    if value.is_null() {
        c.execute("DELETE FROM settings WHERE key=?1", [key])?;
    } else {
        c.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=?2",
            params![key, value.to_string()],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;

    #[test]
    fn space_language_can_be_set_changed_and_cleared() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let patch = |v: serde_json::Value| -> SpacePatch { serde_json::from_value(v).unwrap() };
        let s = create_space(&c, patch(serde_json::json!({"name": "Bio", "language": "de"}))).unwrap();
        assert_eq!(s.language.as_deref(), Some("de"));
        let plain = create_space(&c, patch(serde_json::json!({"name": "Chem"}))).unwrap();
        assert_eq!(plain.language, None);
        let kept = update_space(&c, &s.id, patch(serde_json::json!({"name": "Biology"}))).unwrap();
        assert_eq!(kept.language.as_deref(), Some("de"));
        let changed = update_space(&c, &s.id, patch(serde_json::json!({"language": "pt-BR"}))).unwrap();
        assert_eq!(changed.language.as_deref(), Some("pt-BR"));
        let bad = update_space(&c, &s.id, patch(serde_json::json!({"language": "not a tag!"}))).unwrap();
        assert_eq!(bad.language, None);
        update_space(&c, &s.id, patch(serde_json::json!({"language": "fr"}))).unwrap();
        let cleared = update_space(&c, &s.id, patch(serde_json::json!({"language": null}))).unwrap();
        assert_eq!(cleared.language, None);
        assert_eq!(get_space(&c, &s.id).unwrap().language, None);
    }

    #[test]
    fn space_crud_and_cascade() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let s = create_space(
            &c,
            SpacePatch {
                name: Some("  GED Math ".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(s.name, "GED Math");
        assert_eq!(s.tutor_style, "mixed");
        assert!(create_space(&c, SpacePatch::default()).is_err());

        let s2 = update_space(
            &c,
            &s.id,
            serde_json::from_value(serde_json::json!({"tutorStyle": "socratic", "modelOverride": {"providerId": "p", "model": "m"}})).unwrap(),
        )
        .unwrap();
        assert_eq!(s2.tutor_style, "socratic");
        assert!(s2.model_override.is_some());
        let s3 = update_space(
            &c,
            &s.id,
            serde_json::from_value(serde_json::json!({"modelOverride": null})).unwrap(),
        )
        .unwrap();
        assert!(s3.model_override.is_none());
        assert!(update_space(
            &c,
            &s.id,
            SpacePatch {
                tutor_style: Some("yelling".into()),
                ..Default::default()
            }
        )
        .is_err());

        let t = create_thread(&c, &s.id, None).unwrap();
        assert!(!t.pinned);
        c.execute(
            "UPDATE threads SET updated_at=updated_at-1000 WHERE id=?1",
            [&t.id],
        )
        .unwrap();
        let t = get_thread(&c, &t.id).unwrap();
        let t_new = create_thread(&c, &s.id, Some("Newer".into())).unwrap();
        assert_eq!(list_threads(&c, &s.id).unwrap()[0].id, t_new.id);
        let pinned = set_thread_pinned(&c, &t.id, true).unwrap();
        assert!(pinned.pinned);
        assert_eq!(pinned.updated_at, t.updated_at);
        assert_eq!(list_threads(&c, &s.id).unwrap()[0].id, t.id);
        assert!(!set_thread_pinned(&c, &t.id, false).unwrap().pinned);
        delete_thread(&c, &t_new.id).unwrap();
        let m = add_message(
            &c,
            NewMessage {
                thread_id: t.id.clone(),
                role: "user".into(),
                content: "hi".into(),
                reasoning: None,
                citations: None,
                meta: None,
                status: None,
            },
        )
        .unwrap();
        let practice = add_message(
            &c,
            NewMessage {
                thread_id: t.id.clone(),
                role: "practice".into(),
                content: String::new(),
                reasoning: None,
                citations: None,
                meta: None,
                status: None,
            },
        )
        .unwrap();
        assert_eq!(practice.role, "practice");
        delete_message(&c, &practice.id).unwrap();
        let m2 = update_message(
            &c,
            &m.id,
            MessagePatch {
                content: Some("hello".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(m2.content, "hello");
        let src = insert_source(&c, &s.id, "Doc", "text", None).unwrap();
        assert_eq!(src.status, "processing");
        assert_eq!(get_space(&c, &s.id).unwrap().source_count, 1);

        delete_space(&c, &s.id).unwrap();
        assert!(list_messages(&c, &t.id).unwrap().is_empty());
        assert!(get_source(&c, &src.id).is_err());
    }

    #[test]
    fn learner_memory_crud_dedupes() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let a = add_memory(&c, " Likes Minecraft analogies ", "tutor", None).unwrap();
        assert_eq!(a.text, "Likes Minecraft analogies");
        let b = add_memory(&c, "likes minecraft analogies", "user", None).unwrap();
        assert_eq!(a.id, b.id);
        assert!(add_memory(&c, "  ", "user", None).is_err());
        assert!(add_memory(&c, "x", "robot", None).is_err());
        let u = update_memory(&c, &a.id, "Prefers short answers").unwrap();
        assert_eq!(u.text, "Prefers short answers");
        assert_eq!(list_memory(&c).unwrap().len(), 1);
        delete_memory(&c, &a.id).unwrap();
        assert!(list_memory(&c).unwrap().is_empty());
    }

    #[test]
    fn settings_roundtrip() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        set_setting(&c, "theme", &serde_json::json!("dark")).unwrap();
        assert_eq!(
            get_setting(&c, "theme").unwrap(),
            Some(serde_json::json!("dark"))
        );
        set_setting(&c, "theme", &Value::Null).unwrap();
        assert!(get_settings(&c).unwrap().is_empty());
    }
}
