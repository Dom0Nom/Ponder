//! Flashcards, their FSRS state, review logs and the mistake notebook. Scheduling runs in the UI
//! (ts-fsrs); this module stores cards and states and answers "what's due" across spaces.
use crate::db::{new_id, now_ms};
use crate::error::{invalid, AppError, AppResult};
use crate::AppState;
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

const KINDS: &[&str] = &["basic", "cloze", "occlusion", "mcq"];
const MAX_IMAGE_BYTES: usize = 15 * 1024 * 1024;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: String,
    pub space_id: String,
    pub kind: String,
    pub front: String,
    pub back: String,
    pub data: Option<Value>,
    pub source_id: Option<String>,
    pub chunk_start: Option<i64>,
    pub chunk_end: Option<i64>,
    pub origin: String,
    pub suspended: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub due: i64,
    pub state: i64,
    pub fsrs: Option<Value>,
    pub space_name: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NewCard {
    pub kind: String,
    pub front: String,
    #[serde(default)]
    pub back: String,
    pub data: Option<Value>,
    pub source_id: Option<String>,
    pub chunk_start: Option<i64>,
    pub chunk_end: Option<i64>,
    pub origin: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CardPatch {
    pub front: Option<String>,
    pub back: Option<String>,
    pub data: Option<Value>,
    pub suspended: Option<bool>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DueCount {
    pub space_id: String,
    pub space_name: String,
    pub due: i64,
    pub new: i64,
    pub total: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Mistake {
    pub id: String,
    pub space_id: String,
    pub origin: String,
    pub question: String,
    pub given: Option<String>,
    pub correct: String,
    pub explanation: Option<String>,
    pub topic: Option<String>,
    pub card_id: Option<String>,
    pub resolved: bool,
    pub created_at: i64,
    pub error_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMistake {
    pub origin: String,
    pub question: String,
    pub given: Option<String>,
    pub correct: String,
    pub explanation: Option<String>,
    pub topic: Option<String>,
    /// options for a multiple-choice re-test card
    pub options: Option<Vec<String>>,
}

const CARD_SELECT: &str = "SELECT c.*, s.due, s.state, s.fsrs, sp.name AS space_name
    FROM cards c JOIN card_state s ON s.card_id = c.id JOIN spaces sp ON sp.id = c.space_id";

fn json(r: &Row, col: &str) -> rusqlite::Result<Option<Value>> {
    let s: Option<String> = r.get(col)?;
    Ok(s.and_then(|s| serde_json::from_str(&s).ok()))
}

fn card_from_row(r: &Row) -> rusqlite::Result<Card> {
    Ok(Card {
        id: r.get("id")?,
        space_id: r.get("space_id")?,
        kind: r.get("kind")?,
        front: r.get("front")?,
        back: r.get("back")?,
        data: json(r, "data")?,
        source_id: r.get("source_id")?,
        chunk_start: r.get("chunk_start")?,
        chunk_end: r.get("chunk_end")?,
        origin: r.get("origin")?,
        suspended: r.get::<_, i64>("suspended")? != 0,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        due: r.get("due")?,
        state: r.get("state")?,
        fsrs: json(r, "fsrs")?,
        space_name: r.get("space_name")?,
    })
}

pub fn get_card(c: &Connection, id: &str) -> AppResult<Card> {
    c.query_row(&format!("{CARD_SELECT} WHERE c.id=?1"), [id], card_from_row)
        .optional()?
        .ok_or_else(|| AppError::NotFound("card".into()))
}

fn validate(card: &NewCard) -> AppResult<()> {
    if !KINDS.contains(&card.kind.as_str()) {
        return Err(invalid(format!("Unknown card type: {}", card.kind)));
    }
    if card.front.trim().is_empty() && card.kind != "occlusion" {
        return Err(invalid("A card needs a front"));
    }
    if card.kind == "basic" && card.back.trim().is_empty() {
        return Err(invalid("A card needs a back"));
    }
    if card.kind == "cloze" && !card.front.contains("{{c") {
        return Err(invalid("A cloze card needs at least one {{c1::…}} gap"));
    }
    Ok(())
}

pub fn add_cards(c: &Connection, space_id: &str, cards: &[NewCard]) -> AppResult<Vec<Card>> {
    for card in cards {
        validate(card)?;
    }
    let tx = c.unchecked_transaction()?;
    let now = now_ms();
    let mut ids = Vec::with_capacity(cards.len());
    for card in cards {
        let id = new_id();
        tx.execute(
            "INSERT INTO cards (id, space_id, kind, front, back, data, source_id, chunk_start, chunk_end, origin, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![
                id,
                space_id,
                card.kind,
                card.front.trim(),
                card.back.trim(),
                card.data.as_ref().map(|d| d.to_string()),
                card.source_id,
                card.chunk_start,
                card.chunk_end,
                card.origin.as_deref().unwrap_or("manual"),
                now
            ],
        )?;
        // new cards are due right away
        tx.execute(
            "INSERT INTO card_state (card_id, due, state) VALUES (?1, ?2, 0)",
            params![id, now],
        )?;
        ids.push(id);
    }
    tx.commit()?;
    ids.iter().map(|id| get_card(c, id)).collect()
}

pub fn update_card(c: &Connection, id: &str, p: CardPatch) -> AppResult<Card> {
    let cur = get_card(c, id)?;
    c.execute(
        "UPDATE cards SET front=?2, back=?3, data=?4, suspended=?5, updated_at=?6 WHERE id=?1",
        params![
            id,
            p.front.unwrap_or(cur.front),
            p.back.unwrap_or(cur.back),
            p.data.or(cur.data).map(|d| d.to_string()),
            p.suspended.unwrap_or(cur.suspended) as i64,
            now_ms()
        ],
    )?;
    get_card(c, id)
}

pub fn delete_card(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM cards WHERE id=?1", [id])?;
    Ok(())
}

pub fn list_cards(c: &Connection, space_id: &str) -> AppResult<Vec<Card>> {
    let mut st = c.prepare(&format!(
        "{CARD_SELECT} WHERE c.space_id=?1 ORDER BY c.created_at DESC"
    ))?;
    let rows = st.query_map([space_id], card_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Due cards (including new ones), oldest due first; `space_id` None = every space.
pub fn due_cards(
    c: &Connection,
    space_id: Option<&str>,
    now: i64,
    limit: i64,
) -> AppResult<Vec<Card>> {
    let mut st = c.prepare(&format!(
        "{CARD_SELECT} WHERE c.suspended = 0 AND s.due <= ?1 AND (?2 IS NULL OR c.space_id = ?2)
         ORDER BY CASE WHEN s.state = 0 THEN 1 ELSE 0 END, s.due LIMIT ?3"
    ))?;
    let rows = st.query_map(params![now, space_id, limit], card_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn due_counts(c: &Connection, now: i64) -> AppResult<Vec<DueCount>> {
    let mut st = c.prepare(
        "SELECT sp.id, sp.name,
                sum(CASE WHEN c.suspended = 0 AND s.due <= ?1 AND s.state != 0 THEN 1 ELSE 0 END),
                sum(CASE WHEN c.suspended = 0 AND s.state = 0 THEN 1 ELSE 0 END),
                count(*)
         FROM cards c JOIN card_state s ON s.card_id = c.id JOIN spaces sp ON sp.id = c.space_id
         GROUP BY sp.id ORDER BY sp.name",
    )?;
    let rows = st.query_map([now], |r| {
        Ok(DueCount {
            space_id: r.get(0)?,
            space_name: r.get(1)?,
            due: r.get(2)?,
            new: r.get(3)?,
            total: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Stores the scheduler's new state for a card and logs the review.
#[allow(clippy::too_many_arguments)]
pub fn review_card(
    c: &Connection,
    id: &str,
    rating: i64,
    fsrs: &Value,
    due: i64,
    state: i64,
    duration_ms: Option<i64>,
    log: Option<&Value>,
) -> AppResult<Card> {
    if !(1..=4).contains(&rating) {
        return Err(invalid("Rating must be 1–4"));
    }
    let tx = c.unchecked_transaction()?;
    let n = tx.execute(
        "UPDATE card_state SET due=?2, state=?3, fsrs=?4 WHERE card_id=?1",
        params![id, due, state, fsrs.to_string()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound("card".into()));
    }
    tx.execute(
        "INSERT INTO review_logs (card_id, rating, reviewed_at, duration_ms, log) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, rating, now_ms(), duration_ms, log.map(|l| l.to_string())],
    )?;
    // a mistake counts as fixed once its re-test card has been answered right twice in a row
    let last_two: Vec<i64> = {
        let mut st =
            tx.prepare("SELECT rating FROM review_logs WHERE card_id=?1 ORDER BY id DESC LIMIT 2")?;
        let rows = st.query_map([id], |r| r.get(0))?;
        rows.collect::<Result<_, _>>()?
    };
    if last_two.len() == 2 && last_two.iter().all(|r| *r >= 3) {
        tx.execute("UPDATE mistakes SET resolved=1 WHERE card_id=?1", [id])?;
    }
    tx.commit()?;
    get_card(c, id)
}

fn mistake_from_row(r: &Row) -> rusqlite::Result<Mistake> {
    Ok(Mistake {
        id: r.get("id")?,
        space_id: r.get("space_id")?,
        origin: r.get("origin")?,
        question: r.get("question")?,
        given: r.get("given")?,
        correct: r.get("correct")?,
        explanation: r.get("explanation")?,
        topic: r.get("topic")?,
        card_id: r.get("card_id")?,
        resolved: r.get::<_, i64>("resolved")? != 0,
        created_at: r.get("created_at")?,
        error_type: r.get("error_type")?,
    })
}

/// Saves wrong answers and creates a re-test card for each, so they come back in the review queue.
pub fn add_mistakes(
    c: &Connection,
    space_id: &str,
    items: &[NewMistake],
) -> AppResult<Vec<Mistake>> {
    let mut out = Vec::new();
    for m in items {
        if m.question.trim().is_empty() || m.correct.trim().is_empty() {
            return Err(invalid("A mistake needs the question and the right answer"));
        }
        let back = match &m.explanation {
            Some(e) if !e.trim().is_empty() => format!("{}\n\n{}", m.correct.trim(), e.trim()),
            _ => m.correct.trim().to_string(),
        };
        let (kind, data) = match &m.options {
            Some(opts) if opts.len() >= 2 && opts.iter().any(|o| o == &m.correct) => (
                "mcq",
                Some(
                    serde_json::json!({ "options": opts, "answer": opts.iter().position(|o| o == &m.correct) }),
                ),
            ),
            _ => ("basic", None),
        };
        let card = add_cards(
            c,
            space_id,
            &[NewCard {
                kind: kind.into(),
                front: m.question.trim().into(),
                back,
                data,
                source_id: None,
                chunk_start: None,
                chunk_end: None,
                origin: Some("mistake".into()),
            }],
        )?
        .remove(0);
        let id = new_id();
        c.execute(
            "INSERT INTO mistakes (id, space_id, origin, question, given, correct, explanation, topic, card_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![id, space_id, m.origin, m.question.trim(), m.given, m.correct.trim(), m.explanation, m.topic, card.id, now_ms()],
        )?;
        out.push(c.query_row(
            "SELECT * FROM mistakes WHERE id=?1",
            [&id],
            mistake_from_row,
        )?);
    }
    Ok(out)
}

pub fn list_mistakes(c: &Connection, space_id: Option<&str>) -> AppResult<Vec<Mistake>> {
    let mut st = c.prepare("SELECT * FROM mistakes WHERE (?1 IS NULL OR space_id=?1) ORDER BY resolved, created_at DESC")?;
    let rows = st.query_map([space_id], mistake_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn set_mistake_resolved(c: &Connection, id: &str, resolved: bool) -> AppResult<()> {
    c.execute(
        "UPDATE mistakes SET resolved=?2 WHERE id=?1",
        params![id, resolved as i64],
    )?;
    Ok(())
}

pub fn delete_mistake(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM mistakes WHERE id=?1", [id])?;
    Ok(())
}

/// Copies an image into the app's data dir for occlusion cards; returns the stored file name.
pub fn store_image(dir: &std::path::Path, src: &std::path::Path) -> AppResult<String> {
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !["png", "jpg", "jpeg", "webp", "gif"].contains(&ext.as_str()) {
        return Err(invalid("Use a PNG, JPEG, WebP or GIF image"));
    }
    let len = std::fs::metadata(src)?.len() as usize;
    if len > MAX_IMAGE_BYTES {
        return Err(invalid("Images must be under 15 MB"));
    }
    std::fs::create_dir_all(dir)?;
    let name = format!("{}.{ext}", new_id());
    std::fs::copy(src, dir.join(&name))?;
    Ok(name)
}

pub fn image_data_url(dir: &std::path::Path, name: &str) -> AppResult<String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(invalid("Bad image name"));
    }
    let bytes = std::fs::read(dir.join(name))?;
    let mime = match name.rsplit('.').next().unwrap_or("") {
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/jpeg",
    };
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

// ---------- commands ----------

#[tauri::command]
pub async fn cards_add(
    state: State<'_, AppState>,
    space_id: String,
    cards: Vec<NewCard>,
) -> AppResult<Vec<Card>> {
    add_cards(&state.db.conn()?, &space_id, &cards)
}

#[tauri::command]
pub async fn card_update(
    state: State<'_, AppState>,
    id: String,
    patch: CardPatch,
) -> AppResult<Card> {
    update_card(&state.db.conn()?, &id, patch)
}

#[tauri::command]
pub async fn card_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    delete_card(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn cards_list(state: State<'_, AppState>, space_id: String) -> AppResult<Vec<Card>> {
    list_cards(&state.db.conn()?, &space_id)
}

#[tauri::command]
pub async fn cards_due(
    state: State<'_, AppState>,
    space_id: Option<String>,
    limit: Option<i64>,
) -> AppResult<Vec<Card>> {
    due_cards(
        &state.db.conn()?,
        space_id.as_deref(),
        now_ms(),
        limit.unwrap_or(200),
    )
}

#[tauri::command]
pub async fn cards_due_counts(state: State<'_, AppState>) -> AppResult<Vec<DueCount>> {
    due_counts(&state.db.conn()?, now_ms())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn card_review(
    state: State<'_, AppState>,
    id: String,
    rating: i64,
    fsrs: Value,
    due: i64,
    card_state: i64,
    duration_ms: Option<i64>,
    log: Option<Value>,
) -> AppResult<Card> {
    review_card(
        &state.db.conn()?,
        &id,
        rating,
        &fsrs,
        due,
        card_state,
        duration_ms,
        log.as_ref(),
    )
}

#[tauri::command]
pub async fn mistakes_add(
    state: State<'_, AppState>,
    space_id: String,
    items: Vec<NewMistake>,
) -> AppResult<Vec<Mistake>> {
    add_mistakes(&state.db.conn()?, &space_id, &items)
}

#[tauri::command]
pub async fn mistakes_list(
    state: State<'_, AppState>,
    space_id: Option<String>,
) -> AppResult<Vec<Mistake>> {
    list_mistakes(&state.db.conn()?, space_id.as_deref())
}

#[tauri::command]
pub async fn mistake_set_resolved(
    state: State<'_, AppState>,
    id: String,
    resolved: bool,
) -> AppResult<()> {
    set_mistake_resolved(&state.db.conn()?, &id, resolved)
}

#[tauri::command]
pub async fn mistake_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    delete_mistake(&state.db.conn()?, &id)
}

#[tauri::command]
pub async fn image_store(state: State<'_, AppState>, path: String) -> AppResult<String> {
    store_image(&state.data_dir.join("images"), std::path::Path::new(&path))
}

#[tauri::command]
pub async fn image_read(state: State<'_, AppState>, name: String) -> AppResult<String> {
    image_data_url(&state.data_dir.join("images"), &name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{models, test_db};
    use serde_json::json;

    fn card(kind: &str, front: &str, back: &str) -> NewCard {
        NewCard {
            kind: kind.into(),
            front: front.into(),
            back: back.into(),
            data: None,
            source_id: None,
            chunk_start: None,
            chunk_end: None,
            origin: None,
        }
    }

    #[test]
    fn cards_queue_and_reviews() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let a = models::create_space(
            &c,
            models::SpacePatch {
                name: Some("A".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let b = models::create_space(
            &c,
            models::SpacePatch {
                name: Some("B".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(add_cards(&c, &a.id, &[card("basic", "Q", "")]).is_err());
        assert!(add_cards(&c, &a.id, &[card("cloze", "no gap", "")]).is_err());
        assert!(add_cards(&c, &a.id, &[card("weird", "Q", "A")]).is_err());
        let added = add_cards(
            &c,
            &a.id,
            &[
                card("basic", "Q1", "A1"),
                card("cloze", "The {{c1::stroma}} hosts it", ""),
            ],
        )
        .unwrap();
        add_cards(&c, &b.id, &[card("basic", "Q2", "A2")]).unwrap();

        let now = now_ms() + 1000;
        assert_eq!(due_cards(&c, None, now, 10).unwrap().len(), 3);
        assert_eq!(due_cards(&c, Some(&a.id), now, 10).unwrap().len(), 2);

        let later = now + 86_400_000;
        let r = review_card(
            &c,
            &added[0].id,
            3,
            &json!({"stability": 3.1}),
            later,
            2,
            Some(4000),
            None,
        )
        .unwrap();
        assert_eq!(r.due, later);
        assert_eq!(r.state, 2);
        assert!(review_card(&c, &added[0].id, 7, &json!({}), later, 2, None, None).is_err());
        assert_eq!(due_cards(&c, None, now, 10).unwrap().len(), 2);
        // review cards come before new ones once due
        let order = due_cards(&c, None, later + 1, 10).unwrap();
        assert_eq!(order[0].id, added[0].id);

        let counts = due_counts(&c, now).unwrap();
        let ca = counts.iter().find(|x| x.space_id == a.id).unwrap();
        assert_eq!((ca.due, ca.new, ca.total), (0, 1, 2));

        update_card(
            &c,
            &added[1].id,
            CardPatch {
                suspended: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(due_cards(&c, Some(&a.id), later + 1, 10).unwrap().len(), 1);

        models::delete_space(&c, &b.id).unwrap();
        assert!(list_cards(&c, &b.id).unwrap().is_empty());
    }

    #[test]
    fn mistakes_become_retest_cards_and_resolve() {
        let (db, _d) = test_db();
        let c = db.conn().unwrap();
        let sp = models::create_space(
            &c,
            models::SpacePatch {
                name: Some("GED".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let ms = add_mistakes(
            &c,
            &sp.id,
            &[NewMistake {
                origin: "placement".into(),
                question: "15% of 80?".into(),
                given: Some("8".into()),
                correct: "12".into(),
                explanation: Some("0.15 × 80".into()),
                topic: Some("ged.math.percents".into()),
                options: Some(vec!["8".into(), "12".into(), "15".into(), "20".into()]),
            }],
        )
        .unwrap();
        let card = get_card(&c, ms[0].card_id.as_ref().unwrap()).unwrap();
        assert_eq!(card.kind, "mcq");
        assert_eq!(card.origin, "mistake");
        assert_eq!(card.data.as_ref().unwrap()["answer"], 1);

        review_card(&c, &card.id, 3, &json!({}), 1, 2, None, None).unwrap();
        assert!(!list_mistakes(&c, Some(&sp.id)).unwrap()[0].resolved);
        review_card(&c, &card.id, 4, &json!({}), 2, 2, None, None).unwrap();
        assert!(list_mistakes(&c, Some(&sp.id)).unwrap()[0].resolved);
        review_card(&c, &card.id, 1, &json!({}), 3, 3, None, None).unwrap();
        // a later lapse doesn't silently reopen it; the user can
        set_mistake_resolved(&c, &ms[0].id, false).unwrap();
        assert!(!list_mistakes(&c, None).unwrap()[0].resolved);
    }

    #[test]
    fn images_are_stored_and_read_safely() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("diagram.png");
        std::fs::write(&src, [0x89, b'P', b'N', b'G']).unwrap();
        let name = store_image(&dir.path().join("images"), &src).unwrap();
        let url = image_data_url(&dir.path().join("images"), &name).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
        assert!(image_data_url(&dir.path().join("images"), "../secret.png").is_err());
        std::fs::write(dir.path().join("x.exe"), b"no").unwrap();
        assert!(store_image(&dir.path().join("images"), &dir.path().join("x.exe")).is_err());
    }
}
