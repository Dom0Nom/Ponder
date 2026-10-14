//! Dropbox: OAuth 2 PKCE without a client secret (offline access), files API v2.

use super::{
    check, safe_file_name, stream_to_file, too_large, AuthRequest, ClientConfig, CloudItem,
    CloudPage, Service,
};
use crate::error::{invalid, AppError, AppResult};
use crate::ingest::extract::kind_for_path;
use crate::oauth::pkce;
use crate::oauth::tokens::{now_ms, oauth_error_message, post_form, TokenSet};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// Dropbox only accepts exact, pre-registered redirect URIs, so the loopback port is fixed.
pub const REDIRECT_PORT: u16 = 53789;
const PAGE_LIMIT: u64 = 200;

#[derive(Debug, Clone)]
pub struct Endpoints {
    pub authorize: String,
    pub token: String,
    pub api: String,
    pub content: String,
}

#[cfg(test)]
impl Endpoints {
    pub fn with_base(base: &str) -> Self {
        let b = base.trim_end_matches('/');
        Self {
            authorize: format!("{b}/oauth2/authorize"),
            token: format!("{b}/oauth2/token"),
            api: format!("{b}/2"),
            content: format!("{b}/content/2"),
        }
    }
}

impl Default for Endpoints {
    fn default() -> Self {
        Self {
            authorize: "https://www.dropbox.com/oauth2/authorize".into(),
            token: "https://api.dropboxapi.com/oauth2/token".into(),
            api: "https://api.dropboxapi.com/2".into(),
            content: "https://content.dropboxapi.com/2".into(),
        }
    }
}

pub fn redirect_uri() -> String {
    format!(
        "http://127.0.0.1:{REDIRECT_PORT}{}",
        crate::oauth::loopback::CALLBACK_PATH
    )
}

pub fn build_authorize(ep: &Endpoints, app_key: &str, redirect_uri: &str) -> AuthRequest {
    let verifier = pkce::verifier();
    let state = pkce::random_token(24);
    let mut url = url::Url::parse(&ep.authorize).expect("valid authorize endpoint");
    url.query_pairs_mut()
        .append_pair("client_id", app_key)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("state", &state)
        .append_pair("code_challenge", &pkce::challenge(&verifier))
        .append_pair("code_challenge_method", "S256")
        .append_pair("token_access_type", "offline");
    AuthRequest {
        url: url.into(),
        state,
        verifier,
        redirect_uri: redirect_uri.into(),
    }
}

pub async fn exchange_code(
    http: &reqwest::Client,
    ep: &Endpoints,
    client: &ClientConfig,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> AppResult<TokenSet> {
    let form = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("client_id", client.client_id.as_str()),
        ("code_verifier", verifier),
        ("redirect_uri", redirect_uri),
    ];
    let v = post_form(http, &ep.token, &form)
        .await
        .map_err(|(s, b)| AppError::Other(oauth_error_message(s, &b)))?;
    let mut ts = TokenSet::from_response(&v, now_ms(), None)?;
    if ts.refresh.is_none() {
        return Err(AppError::Other(
            "Dropbox didn't return a refresh token. Try connecting again.".into(),
        ));
    }
    ts.client_id = Some(client.client_id.clone());
    Ok(ts)
}

pub async fn refresh(
    http: &reqwest::Client,
    ep: &Endpoints,
    client: &ClientConfig,
    ts: &TokenSet,
) -> AppResult<TokenSet> {
    let refresh = ts.refresh.as_deref().unwrap_or_default();
    let form = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh),
        ("client_id", client.client_id.as_str()),
    ];
    let v = post_form(http, &ep.token, &form).await.map_err(|(s, b)| {
        if s == 400 || s == 401 {
            AppError::Other("Your Dropbox session expired. Connect again in Settings.".into())
        } else {
            AppError::Other(oauth_error_message(s, &b))
        }
    })?;
    TokenSet::from_response(&v, now_ms(), Some(ts))
}

async fn rpc(http: &reqwest::Client, url: String, token: &str, body: &Value) -> AppResult<Value> {
    let resp = http
        .post(url)
        .bearer_auth(token)
        .header("Content-Type", "application/json")
        .body(serde_json::to_string(body)?)
        .send()
        .await?;
    Ok(check(Service::Dropbox, resp).await?.json().await?)
}

pub async fn account(http: &reqwest::Client, ep: &Endpoints, token: &str) -> Option<String> {
    let v = rpc(
        http,
        format!("{}/users/get_current_account", ep.api),
        token,
        &Value::Null,
    )
    .await
    .ok()?;
    v.get("email")
        .or_else(|| v.pointer("/name/display_name"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

pub async fn revoke(http: &reqwest::Client, ep: &Endpoints, token: &str) -> AppResult<()> {
    rpc(
        http,
        format!("{}/auth/token/revoke", ep.api),
        token,
        &Value::Null,
    )
    .await
    .map(|_| ())
}

fn to_item(v: &Value) -> Option<CloudItem> {
    let tag = v.get(".tag")?.as_str()?;
    if tag == "deleted" {
        return None;
    }
    let name = v.get("name")?.as_str()?.to_string();
    let path = v
        .get("path_display")
        .or_else(|| v.get("path_lower"))?
        .as_str()?
        .to_string();
    let folder = tag == "folder";
    let downloadable = v
        .get("is_downloadable")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    Some(CloudItem {
        supported: !folder && downloadable && kind_for_path(Path::new(&name)).is_some(),
        id: path,
        name,
        folder,
        mime_type: None,
        size: v.get("size").and_then(Value::as_u64),
        modified: v
            .get("server_modified")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn sorted(mut items: Vec<CloudItem>) -> Vec<CloudItem> {
    items.sort_by(|a, b| {
        b.folder
            .cmp(&a.folder)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    items
}

/// Lists a folder (root when None) or searches file names below it. `page_token` is a Dropbox
/// cursor; pass the same `query` with it so the right continue endpoint is used.
pub async fn list(
    http: &reqwest::Client,
    ep: &Endpoints,
    token: &str,
    folder: Option<&str>,
    query: Option<&str>,
    page_token: Option<&str>,
) -> AppResult<CloudPage> {
    let folder = folder.filter(|f| *f != "/").unwrap_or("");
    let v = match (query, page_token) {
        (Some(_), Some(cursor)) => rpc(http, format!("{}/files/search/continue_v2", ep.api), token, &json!({ "cursor": cursor })).await?,
        (None, Some(cursor)) => rpc(http, format!("{}/files/list_folder/continue", ep.api), token, &json!({ "cursor": cursor })).await?,
        (Some(q), None) => {
            let mut options = json!({ "max_results": 100, "file_status": "active", "filename_only": true });
            if !folder.is_empty() {
                options["path"] = Value::String(folder.into());
            }
            rpc(http, format!("{}/files/search_v2", ep.api), token, &json!({ "query": q, "options": options })).await?
        }
        (None, None) => {
            rpc(http, format!("{}/files/list_folder", ep.api), token, &json!({ "path": folder, "limit": PAGE_LIMIT, "include_non_downloadable_files": false })).await?
        }
    };
    let items: Vec<CloudItem> = if query.is_some() {
        v.get("matches")
            .and_then(Value::as_array)
            .map(|m| {
                m.iter()
                    .filter_map(|m| m.pointer("/metadata/metadata").and_then(to_item))
                    .collect()
            })
            .unwrap_or_default()
    } else {
        v.get("entries")
            .and_then(Value::as_array)
            .map(|e| e.iter().filter_map(to_item).collect())
            .unwrap_or_default()
    };
    let more = v.get("has_more").and_then(Value::as_bool).unwrap_or(false);
    let cursor = v.get("cursor").and_then(Value::as_str).map(str::to_string);
    Ok(CloudPage {
        items: sorted(items),
        next_page_token: if more { cursor } else { None },
    })
}

/// JSON for the `Dropbox-API-Arg` header: HTTP headers must be ASCII, so everything from 0x7F up
/// is written as `\uXXXX` (UTF-16 surrogate pairs above the BMP).
pub fn header_json(v: &Value) -> String {
    let raw = v.to_string();
    let mut out = String::with_capacity(raw.len());
    for c in raw.chars() {
        if (c as u32) < 0x7F {
            out.push(c);
        } else {
            let mut buf = [0u16; 2];
            for unit in c.encode_utf16(&mut buf) {
                out.push_str(&format!("\\u{:04x}", unit));
            }
        }
    }
    out
}

pub async fn download(
    http: &reqwest::Client,
    ep: &Endpoints,
    token: &str,
    item: &CloudItem,
    dir: &Path,
    cap: u64,
) -> AppResult<PathBuf> {
    if !item.id.starts_with('/') {
        return Err(invalid("Missing Dropbox path"));
    }
    let name = safe_file_name(&item.name);
    if kind_for_path(Path::new(&name)).is_none() {
        return Err(invalid(format!(
            "{} can't be imported (unsupported file type).",
            item.name
        )));
    }
    if item.size.is_some_and(|s| s > cap) {
        return Err(too_large(cap));
    }
    let resp = http
        .post(format!("{}/files/download", ep.content))
        .bearer_auth(token)
        .header("Dropbox-API-Arg", header_json(&json!({ "path": item.id })))
        .send()
        .await?;
    let resp = check(Service::Dropbox, resp).await?;
    let dest = dir.join(name);
    stream_to_file(resp, &dest, cap).await?;
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::tests::services;
    use std::collections::HashMap;
    use wiremock::matchers::{bearer_token, body_json, body_string_contains, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[test]
    fn authorize_url() {
        let req = build_authorize(&Endpoints::default(), "appkey123", &redirect_uri());
        let url = url::Url::parse(&req.url).unwrap();
        assert_eq!(url.host_str(), Some("www.dropbox.com"));
        assert_eq!(url.path(), "/oauth2/authorize");
        let q: HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["client_id"], "appkey123");
        assert_eq!(q["response_type"], "code");
        assert_eq!(
            q["redirect_uri"],
            format!("http://127.0.0.1:{REDIRECT_PORT}/auth/callback")
        );
        assert_eq!(q["token_access_type"], "offline");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["code_challenge"], pkce::challenge(&req.verifier));
        assert_eq!(q["state"], req.state);
    }

    #[test]
    fn header_json_escapes_non_ascii() {
        assert_eq!(
            header_json(&json!({"path": "/Bio/Zellübersicht 🌿.pdf"})),
            r#"{"path":"/Bio/Zell\u00fcbersicht \ud83c\udf3f.pdf"}"#
        );
        assert!(header_json(&json!({"path": "/a\u{7f}"})).contains("\\u007f"));
    }

    #[tokio::test]
    async fn sign_in_and_refresh_without_secret() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/oauth2/token"))
            .and(body_string_contains("grant_type=authorization_code"))
            .and(body_string_contains("client_id=appkey"))
            .and(body_string_contains("code_verifier=ver"))
            .and(body_string_contains("code=c0de"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "access_token": "sl.a1", "refresh_token": "rt", "expires_in": 14400, "token_type": "bearer", "account_id": "dbid:x"
            })))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/2/users/get_current_account"))
            .and(bearer_token("sl.a1"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(
                    json!({"email": "me@dropbox.test", "name": {"display_name": "Me"}}),
                ),
            )
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/oauth2/token"))
            .and(body_string_contains("grant_type=refresh_token"))
            .and(body_string_contains("refresh_token=rt"))
            .and(body_string_contains("client_id=appkey"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"access_token": "sl.a2", "expires_in": 14400})),
            )
            .expect(1)
            .mount(&server)
            .await;

        let s = services("http://unused", &server.uri());
        s.set_client(Service::Dropbox, "appkey", None).unwrap();
        let client = s.require_client(Service::Dropbox).unwrap();
        let req = build_authorize(&s.dropbox, "appkey", &redirect_uri());
        let req = AuthRequest {
            verifier: "ver".into(),
            ..req
        };
        let ts = s
            .finish_sign_in(Service::Dropbox, &client, &req, "c0de")
            .await
            .unwrap();
        assert_eq!(ts.account.as_deref(), Some("me@dropbox.test"));
        let received = server.received_requests().await.unwrap();
        assert!(!String::from_utf8_lossy(&received[0].body).contains("client_secret"));

        let mut expired = s.oauth.tokens.load("cloud:dropbox").unwrap().unwrap();
        expired.expires_at = 1;
        s.oauth.tokens.save("cloud:dropbox", &expired).unwrap();
        assert_eq!(s.token(Service::Dropbox).await.unwrap(), "sl.a2");
        let stored = s.oauth.tokens.load("cloud:dropbox").unwrap().unwrap();
        assert_eq!(stored.refresh.as_deref(), Some("rt"));
        assert_eq!(stored.account.as_deref(), Some("me@dropbox.test"));
    }

    async fn signed_in(server: &MockServer) -> crate::cloud::CloudServices {
        let s = services("http://unused", &server.uri());
        s.set_client(Service::Dropbox, "appkey", None).unwrap();
        s.oauth
            .tokens
            .save(
                "cloud:dropbox",
                &TokenSet {
                    access: "tok".into(),
                    refresh: Some("rt".into()),
                    expires_at: now_ms() + 3_600_000,
                    account: None,
                    client_id: None,
                    obtained_at: None,
                },
            )
            .unwrap();
        s
    }

    #[tokio::test]
    async fn lists_continues_and_searches() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2/files/list_folder"))
            .and(bearer_token("tok"))
            .and(body_json(json!({"path": "", "limit": 200, "include_non_downloadable_files": false})))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "entries": [
                    {".tag": "file", "name": "zeta.pdf", "path_display": "/zeta.pdf", "path_lower": "/zeta.pdf", "id": "id:1", "size": 10, "server_modified": "2026-01-01T00:00:00Z"},
                    {".tag": "folder", "name": "Biology", "path_display": "/Biology", "path_lower": "/biology", "id": "id:2"},
                    {".tag": "file", "name": "song.mp3", "path_display": "/song.mp3", "id": "id:3", "size": 5}
                ],
                "cursor": "c1",
                "has_more": true
            })))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/2/files/list_folder/continue"))
            .and(body_json(json!({"cursor": "c1"})))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "entries": [{".tag": "file", "name": "notes.md", "path_display": "/notes.md", "size": 3}],
                "cursor": "c2",
                "has_more": false
            })))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/2/files/list_folder"))
            .and(body_json(
                json!({"path": "/Biology", "limit": 200, "include_non_downloadable_files": false}),
            ))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"entries": [], "cursor": "c", "has_more": false})),
            )
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/2/files/search_v2"))
            .and(body_json(json!({"query": "cell", "options": {"max_results": 100, "file_status": "active", "filename_only": true, "path": "/Biology"}})))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "matches": [{"metadata": {".tag": "metadata", "metadata": {".tag": "file", "name": "cell.txt", "path_display": "/Biology/cell.txt", "size": 9}}}],
                "has_more": false
            })))
            .expect(1)
            .mount(&server)
            .await;

        let s = signed_in(&server).await;
        let page = s.list(Service::Dropbox, None, None, None).await.unwrap();
        let v: Vec<(&str, bool, bool)> = page
            .items
            .iter()
            .map(|i| (i.id.as_str(), i.folder, i.supported))
            .collect();
        assert_eq!(
            v,
            vec![
                ("/Biology", true, false),
                ("/song.mp3", false, false),
                ("/zeta.pdf", false, true)
            ]
        );
        assert_eq!(page.items[2].size, Some(10));
        assert_eq!(page.next_page_token.as_deref(), Some("c1"));
        let next = s
            .list(Service::Dropbox, None, None, Some("c1"))
            .await
            .unwrap();
        assert_eq!(next.items[0].id, "/notes.md");
        assert_eq!(next.next_page_token, None);
        assert!(s
            .list(Service::Dropbox, Some("/Biology"), None, None)
            .await
            .unwrap()
            .items
            .is_empty());
        let found = s
            .list(Service::Dropbox, Some("/Biology"), Some("cell"), None)
            .await
            .unwrap();
        assert_eq!(found.items[0].id, "/Biology/cell.txt");
        assert!(found.items[0].supported);
    }

    #[tokio::test]
    async fn downloads_with_api_arg_and_cap() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/content/2/files/download"))
            .and(bearer_token("tok"))
            .and(header(
                "Dropbox-API-Arg",
                r#"{"path":"/Bio/Zell\u00fcbersicht.pdf"}"#,
            ))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![3u8; 512]))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/content/2/files/download"))
            .and(header("Dropbox-API-Arg", r#"{"path":"/big.pdf"}"#))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![3u8; 4096]))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/content/2/files/download"))
            .and(header("Dropbox-API-Arg", r#"{"path":"/missing.pdf"}"#))
            .respond_with(ResponseTemplate::new(409).set_body_json(
                json!({"error_summary": "path/not_found/..", "error": {".tag": "path"}}),
            ))
            .mount(&server)
            .await;

        let s = signed_in(&server).await;
        let dir = tempfile::tempdir().unwrap();
        let item = CloudItem {
            id: "/Bio/Zellübersicht.pdf".into(),
            name: "Zellübersicht.pdf".into(),
            folder: false,
            mime_type: None,
            size: Some(512),
            modified: None,
            supported: true,
        };
        let p = s
            .download(Service::Dropbox, &item, dir.path(), 1024)
            .await
            .unwrap();
        assert_eq!(p.file_name().unwrap(), "Zellübersicht.pdf");
        assert_eq!(std::fs::read(&p).unwrap().len(), 512);

        let big = CloudItem {
            id: "/big.pdf".into(),
            name: "big.pdf".into(),
            size: None,
            ..item.clone()
        };
        assert!(s
            .download(Service::Dropbox, &big, dir.path(), 1024)
            .await
            .unwrap_err()
            .to_string()
            .contains("larger than"));
        assert!(!dir.path().join("big.pdf").exists());
        let declared = CloudItem {
            size: Some(5000),
            ..big
        };
        assert!(s
            .download(Service::Dropbox, &declared, dir.path(), 1024)
            .await
            .unwrap_err()
            .to_string()
            .contains("larger than"));

        let missing = CloudItem {
            id: "/missing.pdf".into(),
            name: "missing.pdf".into(),
            ..item.clone()
        };
        let e = s
            .download(Service::Dropbox, &missing, dir.path(), 1024)
            .await
            .unwrap_err()
            .to_string();
        assert!(e.contains("409") && e.contains("path/not_found"), "{e}");

        let bad = CloudItem {
            id: "/x.exe".into(),
            name: "x.exe".into(),
            ..item
        };
        assert!(s
            .download(Service::Dropbox, &bad, dir.path(), 1024)
            .await
            .is_err());
    }
}
