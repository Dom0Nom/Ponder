//! Text shown by the native layer (menus, tray, notifications, dialogs). It reads the same message
//! files as the UI (`src/locales/*.json`, embedded at build time) and looks up `native.*` keys.
//! Placeholders are `{0}`, `{1}`; a missing key falls back to English.
use crate::db::models;
use crate::error::{invalid, AppResult};
use crate::AppState;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use tauri::menu::{Menu, MenuBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, State, Wry};

include!(concat!(env!("OUT_DIR"), "/locales.rs"));

pub const SUPPORTED: &[&str] = &[
    "en", "zh-Hans", "zh-Hant", "hi", "es", "fr", "ar", "bn", "pt-BR", "ru", "ur", "id", "de",
    "ja", "tr", "ko", "vi", "it", "pl", "fa",
];

type Table = Arc<HashMap<String, String>>;

static CURRENT: RwLock<String> = RwLock::new(String::new());
static TABLES: OnceLock<Mutex<HashMap<String, Table>>> = OnceLock::new();

pub fn current() -> String {
    let c = CURRENT.read().unwrap_or_else(|e| e.into_inner());
    if c.is_empty() {
        "en".into()
    } else {
        c.clone()
    }
}

pub fn set_current(code: &str) {
    *CURRENT.write().unwrap_or_else(|e| e.into_inner()) = code.to_string();
}

/// Maps a BCP-47 tag such as "de-AT" or "zh-TW" to a supported code, else "en".
pub fn detect(tag: &str) -> &'static str {
    let lower = tag.to_lowercase().replace('_', "-");
    if let Some(code) = SUPPORTED.iter().find(|c| c.to_lowercase() == lower) {
        return code;
    }
    let mut parts = lower.split('-');
    let lang = parts.next().unwrap_or("");
    match lang {
        "zh" => {
            if parts.any(|p| matches!(p, "hant" | "tw" | "hk" | "mo")) {
                "zh-Hant"
            } else {
                "zh-Hans"
            }
        }
        "pt" => "pt-BR",
        _ => SUPPORTED
            .iter()
            .find(|c| c.to_lowercase() == lang)
            .copied()
            .unwrap_or("en"),
    }
}

fn table(locale: &str) -> Table {
    let tables = TABLES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = tables.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(t) = guard.get(locale) {
        return t.clone();
    }
    let mut map = HashMap::new();
    if let Some((_, text)) = FILES.iter().find(|(code, _)| *code == locale) {
        if let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(text) {
            for (k, v) in obj {
                if !k.starts_with("native.") {
                    continue;
                }
                let s = match v {
                    Value::String(s) => Some(s),
                    Value::Object(o) => o.get("other").and_then(|x| x.as_str()).map(String::from),
                    _ => None,
                };
                if let Some(s) = s {
                    map.insert(k, s);
                }
            }
        }
    }
    let t = Arc::new(map);
    guard.insert(locale.to_string(), t.clone());
    t
}

fn lookup(locale: &str, key: &str) -> String {
    table(locale)
        .get(key)
        .cloned()
        .or_else(|| table("en").get(key).cloned())
        .unwrap_or_else(|| key.to_string())
}

fn fill(template: &str, args: &[&str]) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find('}') else {
            out.push_str(&rest[start..]);
            return out;
        };
        let spec = &after[..end];
        let index = spec.split(',').next().unwrap_or("").trim();
        match index.parse::<usize>().ok().and_then(|i| args.get(i)) {
            Some(arg) => out.push_str(arg),
            None => out.push_str(&rest[start..start + end + 2]),
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

/// The text for a `native.*` key in the current language.
pub fn t(key: &str) -> String {
    lookup(&current(), key)
}

pub fn t_args(key: &str, args: &[&str]) -> String {
    fill(&lookup(&current(), key), args)
}

/// The language to start in: the saved setting, else the operating system's.
pub fn startup_locale(c: &rusqlite::Connection) -> String {
    let saved = models::get_settings(c)
        .ok()
        .and_then(|s| s.get("locale").and_then(|v| v.as_str().map(String::from)))
        .filter(|l| SUPPORTED.contains(&l.as_str()));
    saved.unwrap_or_else(|| detect(&sys_locale::get_locale().unwrap_or_default()).to_string())
}

pub fn init(app: &AppHandle, db: &crate::db::Db) {
    if let Ok(c) = db.conn() {
        set_current(&startup_locale(&c));
    }
    if let Err(e) = apply_menu(app) {
        log::warn!("app menu failed: {e}");
    }
}

/// The application menu with every label in the current language.
pub fn app_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let name = app.package_info().name.clone();
    let name = if name.is_empty() {
        "Ponder".to_string()
    } else {
        name
    };
    let n = name.as_str();
    let sep = || PredefinedMenuItem::separator(app);

    let edit = SubmenuBuilder::new(app, t("native.menu.edit"))
        .item(&PredefinedMenuItem::undo(
            app,
            Some(&t("native.menu.undo")),
        )?)
        .item(&PredefinedMenuItem::redo(
            app,
            Some(&t("native.menu.redo")),
        )?)
        .item(&sep()?)
        .item(&PredefinedMenuItem::cut(app, Some(&t("native.menu.cut")))?)
        .item(&PredefinedMenuItem::copy(
            app,
            Some(&t("native.menu.copy")),
        )?)
        .item(&PredefinedMenuItem::paste(
            app,
            Some(&t("native.menu.paste")),
        )?)
        .item(&PredefinedMenuItem::select_all(
            app,
            Some(&t("native.menu.selectAll")),
        )?)
        .build()?;
    let view = SubmenuBuilder::new(app, t("native.menu.view"))
        .item(&PredefinedMenuItem::fullscreen(
            app,
            Some(&t("native.menu.fullscreen")),
        )?)
        .build()?;
    let window = SubmenuBuilder::new(app, t("native.menu.window"))
        .item(&PredefinedMenuItem::minimize(
            app,
            Some(&t("native.menu.minimize")),
        )?)
        .item(&PredefinedMenuItem::maximize(
            app,
            Some(&t("native.menu.zoom")),
        )?)
        .item(&sep()?)
        .item(&PredefinedMenuItem::close_window(
            app,
            Some(&t("native.menu.closeWindow")),
        )?)
        .build()?;

    #[cfg(target_os = "macos")]
    {
        let about = t_args("native.menu.about", &[n]);
        let app_menu = SubmenuBuilder::new(app, n)
            .item(&PredefinedMenuItem::about(app, Some(&about), None)?)
            .item(&sep()?)
            .item(&PredefinedMenuItem::services(
                app,
                Some(&t("native.menu.services")),
            )?)
            .item(&sep()?)
            .item(&PredefinedMenuItem::hide(
                app,
                Some(&t_args("native.menu.hide", &[n])),
            )?)
            .item(&PredefinedMenuItem::hide_others(
                app,
                Some(&t("native.menu.hideOthers")),
            )?)
            .item(&PredefinedMenuItem::show_all(
                app,
                Some(&t("native.menu.showAll")),
            )?)
            .item(&sep()?)
            .item(&PredefinedMenuItem::quit(
                app,
                Some(&t_args("native.menu.quit", &[n])),
            )?)
            .build()?;
        let file = SubmenuBuilder::new(app, t("native.menu.file"))
            .item(&PredefinedMenuItem::close_window(
                app,
                Some(&t("native.menu.closeWindow")),
            )?)
            .build()?;
        MenuBuilder::new(app)
            .items(&[&app_menu, &file, &edit, &view, &window])
            .build()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let file = SubmenuBuilder::new(app, t("native.menu.file"))
            .item(&PredefinedMenuItem::quit(
                app,
                Some(&t_args("native.menu.quit", &[n])),
            )?)
            .build()?;
        MenuBuilder::new(app)
            .items(&[&file, &edit, &view, &window])
            .build()
    }
}

fn apply_menu(app: &AppHandle) -> tauri::Result<()> {
    app.set_menu(app_menu(app)?)?;
    Ok(())
}

/// Rebuilds the app menu and the tray after the language changed.
pub fn refresh(app: &AppHandle) {
    if let Err(e) = apply_menu(app) {
        log::warn!("app menu failed: {e}");
    }
    crate::focus::tray::relabel(app);
}

#[tauri::command]
pub async fn set_locale(
    app: AppHandle,
    state: State<'_, AppState>,
    locale: String,
) -> AppResult<()> {
    if !SUPPORTED.contains(&locale.as_str()) {
        return Err(invalid(format!("Unsupported language: {locale}")));
    }
    models::set_setting(&state.db.conn()?, "locale", &Value::String(locale.clone()))?;
    set_current(&locale);
    let handle = app.clone();
    // menus must be rebuilt on the main thread
    let _ = app.run_on_main_thread(move || refresh(&handle));
    let _ = app.emit("locale://changed", locale);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_supported_languages() {
        assert_eq!(detect("de-AT"), "de");
        assert_eq!(detect("en_US"), "en");
        assert_eq!(detect("zh-TW"), "zh-Hant");
        assert_eq!(detect("zh-Hant-HK"), "zh-Hant");
        assert_eq!(detect("zh-CN"), "zh-Hans");
        assert_eq!(detect("pt-PT"), "pt-BR");
        assert_eq!(detect("sv"), "en");
        assert_eq!(detect(""), "en");
    }

    #[test]
    fn fills_placeholders() {
        assert_eq!(
            fill("{0} is open. {1} min left.", &["Safari", "5"]),
            "Safari is open. 5 min left."
        );
        assert_eq!(fill("{1, minutes} / {0}", &["a", "b"]), "b / a");
        assert_eq!(fill("no args {2}", &["a"]), "no args {2}");
        assert_eq!(fill("open { brace", &[]), "open { brace");
    }

    #[test]
    fn english_and_german_have_native_text() {
        assert_eq!(lookup("en", "native.tray.quit"), "Quit");
        assert_eq!(lookup("de", "native.tray.quit"), "Beenden");
        assert_eq!(lookup("de", "native.tray.show"), "App anzeigen");
        assert_eq!(
            lookup("xx", "native.tray.quit"),
            "Quit",
            "missing languages fall back to English"
        );
        assert_eq!(lookup("en", "native.nope"), "native.nope");
    }

    #[test]
    fn every_english_native_key_is_embedded() {
        let en = table("en");
        for key in [
            "native.tray.start",
            "native.menu.undo",
            "native.notification.distraction",
            "native.dialog.packFilter",
        ] {
            assert!(en.contains_key(key), "{key}");
        }
        assert!(en["native.notification.distractionLeft"].contains("{1}"));
    }

    #[test]
    fn supported_list_matches_the_ui() {
        let ts = include_str!("../../src/lib/i18n/locales.ts");
        for code in SUPPORTED {
            assert!(ts.contains(&format!("code: \"{code}\"")), "{code}");
        }
        assert_eq!(ts.matches("code: \"").count(), SUPPORTED.len());
    }
}
