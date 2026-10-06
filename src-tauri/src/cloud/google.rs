//! Google Drive: OAuth for installed apps (loopback + PKCE, offline access) and Drive v3.

use super::{check, safe_file_name, stream_to_file, too_large, AuthRequest, ClientConfig, CloudItem, CloudPage, Service};
use crate::error::{invalid, AppError, AppResult};
use crate::ingest::extract::kind_for_path;
use crate::oauth::pkce;
use crate::oauth::tokens::{now_ms, oauth_error_message, post_form, TokenSet};
use serde::Deserialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

pub const SCOPE: &str = "https://www.googleapis.com/auth/drive.readonly";
pub const FOLDER: &str = "application/vnd.google-apps.folder";
pub const DOC: &str = "application/vnd.google-apps.document";
pub const SLIDES: &str = "application/vnd.google-apps.presentation";
pub const SHEET: &str = "application/vnd.google-apps.spreadsheet";
const PAGE_SIZE: &str = "100";
const LIST_FIELDS: &str = "nextPageToken,files(id,name,mimeType,size,modifiedTime)";

#[derive(Debug, Clone)]
pub struct Endpoints {
    pub authorize: String,
    pub token: String,
    pub revoke: String,
    pub api: String,
}

#[cfg(test)]
impl Endpoints {
    pub fn with_base(base: &str) -> Self {
        let b = base.trim_end_matches('/');
        Self {
            authorize: format!("{b}/o/oauth2/v2/auth"),
            token: format!("{b}/token"),
            revoke: format!("{b}/revoke"),
            api: format!("{b}/drive/v3"),
        }
    }
}

impl Default for Endpoints {
    fn default() -> Self {
        Self {
            authorize: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token: "https://oauth2.googleapis.com/token".into(),
            revoke: "https://oauth2.googleapis.com/revoke".into(),
            api: "https://www.googleapis.com/drive/v3".into(),
        }
    }
}

/// Google Workspace files are exported: (export MIME type, local extension).
pub fn export_for(mime: &str) -> Option<(&'static str, &'static str)> {
    match mime {
        DOC => Some(("text/markdown", "md")),
        SLIDES => Some(("text/plain", "txt")),
        SHEET => Some(("text/csv", "txt")),
        _ => None,
    }
}

fn ext_for_mime(mime: &str) -> Option<&'static str> {
    match mime {
        "application/pdf" => Some("pdf"),
        "application/epub+zip" => Some("epub"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => Some("docx"),
        "text/markdown" | "text/x-markdown" => Some("md"),
        "text/plain" => Some("txt"),
        _ => None,
    }
}

/// The name the downloaded file gets, or None when it can't be imported.
pub fn local_name(name: &str, mime: &str) -> Option<String> {
    let safe = safe_file_name(name);
    if let Some((_, ext)) = export_for(mime) {
        return Some(format!("{safe}.{ext}"));
    }
    if mime.starts_with("application/vnd.google-apps.") {
        return None;
    }
    if kind_for_path(Path::new(&safe)).is_some() {
        return Some(safe);
    }
    ext_for_mime(mime).map(|ext| format!("{safe}.{ext}"))
}

pub fn build_authorize(ep: &Endpoints, client_id: &str, redirect_uri: &str) -> AuthRequest {
    let verifier = pkce::verifier();
    let state = pkce::random_token(24);
    let mut url = url::Url::parse(&ep.authorize).expect("valid authorize endpoint");
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("scope", SCOPE)
        .append_pair("state", &state)
        .append_pair("code_challenge", &pkce::challenge(&verifier))
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    AuthRequest { url: url.into(), state, verifier, redirect_uri: redirect_uri.into() }
}

fn with_secret<'a>(mut form: Vec<(&'a str, &'a str)>, client: &'a ClientConfig) -> Vec<(&'a str, &'a str)> {
    if let Some(s) = client.client_secret.as_deref() {
        form.push(("client_secret", s));
    }
    form
}

pub async fn exchange_code(
    http: &reqwest::Client,
    ep: &Endpoints,
    client: &ClientConfig,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> AppResult<TokenSet> {
    let form = with_secret(
        vec![
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", &client.client_id),
            ("code_verifier", verifier),
            ("redirect_uri", redirect_uri),
        ],
        client,
    );
    let v = post_form(http, &ep.token, &form).await.map_err(|(s, b)| AppError::Other(oauth_error_message(s, &b)))?;
    let mut ts = TokenSet::from_response(&v, now_ms(), None)?;
    if ts.refresh.is_none() {
        return Err(AppError::Other("Google didn't return a refresh token. Try connecting again.".into()));
    }
    ts.client_id = Some(client.client_id.clone());
    Ok(ts)
}

pub async fn refresh(http: &reqwest::Client, ep: &Endpoints, client: &ClientConfig, ts: &TokenSet) -> AppResult<TokenSet> {
    let refresh = ts.refresh.as_deref().unwrap_or_default();
    let form = with_secret(vec![("grant_type", "refresh_token"), ("refresh_token", refresh), ("client_id", &client.client_id)], client);
    let v = post_form(http, &ep.token, &form).await.map_err(|(s, b)| {
        if s == 400 || s == 401 {
            AppError::Other("Your Google Drive session expired. Connect again in Settings.".into())
        } else {
            AppError::Other(oauth_error_message(s, &b))
        }
    })?;
    TokenSet::from_response(&v, now_ms(), Some(ts))
}

pub async fn account(http: &reqwest::Client, ep: &Endpoints, token: &str) -> Option<String> {
    let resp = http
        .get(format!("{}/about", ep.api))
        .query(&[("fields", "user(emailAddress,displayName)")])
        .bearer_auth(token)
        .send()
        .await
        .ok()?;
    let v: Value = resp.error_for_status().ok()?.json().await.ok()?;
    v.pointer("/user/emailAddress").or_else(|| v.pointer("/user/displayName")).and_then(Value::as_str).map(str::to_string)
}

pub async fn revoke(http: &reqwest::Client, ep: &Endpoints, token: &str) -> AppResult<()> {
    http.post(&ep.revoke).form(&[("token", token)]).send().await?;
    Ok(())
}

fn quote(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\'")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFile {
    id: String,
    name: String,
    mime_type: String,
    size: Option<String>,
    modified_time: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileList {
    #[serde(default)]
    files: Vec<DriveFile>,
    next_page_token: Option<String>,
}

fn to_item(f: DriveFile) -> CloudItem {
    let folder = f.mime_type == FOLDER;
    CloudItem {
        supported: !folder && local_name(&f.name, &f.mime_type).is_some(),
        id: f.id,
        name: f.name,
        folder,
        size: f.size.and_then(|s| s.parse().ok()),
        modified: f.modified_time,
        mime_type: Some(f.mime_type),
    }
}

/// Lists a folder (root when None), or searches file names across the Drive when `query` is set.
pub async fn list(
    http: &reqwest::Client,
    ep: &Endpoints,
    token: &str,
    folder: Option<&str>,
    query: Option<&str>,
    page_token: Option<&str>,
) -> AppResult<CloudPage> {
    let q = match query {
        Some(text) => format!("name contains '{}' and trashed = false", quote(text)),
        None => format!("'{}' in parents and trashed = false", quote(folder.unwrap_or("root"))),
    };
    let mut params = vec![("q", q.as_str()), ("pageSize", PAGE_SIZE), ("fields", LIST_FIELDS), ("orderBy", "folder,name")];
    if let Some(p) = page_token {
        params.push(("pageToken", p));
    }
    let resp = http.get(format!("{}/files", ep.api)).query(&params).bearer_auth(token).send().await?;
    let list: FileList = check(Service::Google, resp).await?.json().await?;
    Ok(CloudPage { items: list.files.into_iter().map(to_item).collect(), next_page_token: list.next_page_token })
}

/// Google Docs/Slides/Sheets go through `files.export`; everything else is `alt=media`.
pub async fn download(http: &reqwest::Client, ep: &Endpoints, token: &str, item: &CloudItem, dir: &Path, cap: u64) -> AppResult<PathBuf> {
    let mime = item.mime_type.as_deref().unwrap_or_default();
    let name = local_name(&item.name, mime).ok_or_else(|| invalid(format!("{} can't be imported (unsupported file type).", item.name)))?;
    if item.id.is_empty() {
        return Err(invalid("Missing file id"));
    }
    let mut url = url::Url::parse(&format!("{}/", ep.api)).map_err(|e| AppError::Other(e.to_string()))?;
    url.path_segments_mut().map_err(|_| AppError::Other("bad API url".into()))?.pop_if_empty().push("files").push(&item.id);
    let req = match export_for(mime) {
        Some((export_mime, _)) => {
            url.path_segments_mut().map_err(|_| AppError::Other("bad API url".into()))?.push("export");
            http.get(url).query(&[("mimeType", export_mime)])
        }
        None => {
            if item.size.is_some_and(|s| s > cap) {
                return Err(too_large(cap));
            }
            http.get(url).query(&[("alt", "media")])
        }
    };
    let resp = check(Service::Google, req.bearer_auth(token).send().await?).await?;
    let dest = dir.join(name);
    stream_to_file(resp, &dest, cap).await?;
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::tests::services;
    use serde_json::json;
    use std::collections::HashMap;
    use wiremock::matchers::{bearer_token, body_string_contains, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[test]
    fn authorize_url() {
        let ep = Endpoints::default();
        let req = build_authorize(&ep, "cid.apps.googleusercontent.com", "http://127.0.0.1:49152/auth/callback");
        let url = url::Url::parse(&req.url).unwrap();
        assert_eq!(url.host_str(), Some("accounts.google.com"));
        assert_eq!(url.path(), "/o/oauth2/v2/auth");
        let q: HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["client_id"], "cid.apps.googleusercontent.com");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:49152/auth/callback");
        assert_eq!(q["response_type"], "code");
        assert_eq!(q["scope"], SCOPE);
        assert_eq!(q["access_type"], "offline");
        assert_eq!(q["prompt"], "consent");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["code_challenge"], pkce::challenge(&req.verifier));
        assert_eq!(q["state"], req.state);
        assert!(!q.contains_key("client_secret"));
    }

    #[test]
    fn supported_names() {
        assert_eq!(local_name("Notes", DOC).as_deref(), Some("Notes.md"));
        assert_eq!(local_name("Deck", SLIDES).as_deref(), Some("Deck.txt"));
        assert_eq!(local_name("Sheet", SHEET).as_deref(), Some("Sheet.txt"));
        assert_eq!(local_name("Form", "application/vnd.google-apps.form"), None);
        assert_eq!(local_name("paper.PDF", "application/pdf").as_deref(), Some("paper.PDF"));
        assert_eq!(local_name("scan", "application/pdf").as_deref(), Some("scan.pdf"));
        assert_eq!(local_name("photo.jpg", "image/jpeg"), None);
        assert_eq!(quote("it's a\\b"), "it\\'s a\\\\b");
    }

    #[tokio::test]
    async fn sign_in_and_refresh() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .and(body_string_contains("grant_type=authorization_code"))
            .and(body_string_contains("code=the-code"))
            .and(body_string_contains("client_id=cid"))
            .and(body_string_contains("client_secret=shh"))
            .and(body_string_contains("code_verifier=ver"))
            .and(body_string_contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A9%2Fauth%2Fcallback"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "access_token": "a1", "refresh_token": "r1", "expires_in": 1, "token_type": "Bearer", "scope": SCOPE
            })))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/about"))
            .and(bearer_token("a1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"user": {"emailAddress": "me@gmail.com"}})))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .and(body_string_contains("grant_type=refresh_token"))
            .and(body_string_contains("refresh_token=r1"))
            .and(body_string_contains("client_secret=shh"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"access_token": "a2", "expires_in": 3600})))
            .expect(1)
            .mount(&server)
            .await;

        let s = services(&server.uri(), "http://unused");
        s.set_client(Service::Google, "cid", Some("shh")).unwrap();
        let client = s.require_client(Service::Google).unwrap();
        let req = AuthRequest { url: String::new(), state: "st".into(), verifier: "ver".into(), redirect_uri: "http://127.0.0.1:9/auth/callback".into() };
        let ts = s.finish_sign_in(Service::Google, &client, &req, "the-code").await.unwrap();
        assert_eq!(ts.account.as_deref(), Some("me@gmail.com"));
        let st = s.status(Service::Google).unwrap();
        assert_eq!((st.state, st.account.as_deref()), ("signedIn", Some("me@gmail.com")));

        // expires_in=1 is inside the refresh skew, so this refreshes once and keeps the refresh token
        assert_eq!(s.token(Service::Google).await.unwrap(), "a2");
        assert_eq!(s.token(Service::Google).await.unwrap(), "a2");
        let stored = s.oauth.tokens.load("cloud:google").unwrap().unwrap();
        assert_eq!(stored.refresh.as_deref(), Some("r1"));
        assert_eq!(stored.account.as_deref(), Some("me@gmail.com"));
    }

    #[tokio::test]
    async fn refresh_failure_marks_session_expired() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(ResponseTemplate::new(400).set_body_json(json!({"error": "invalid_grant"})))
            .mount(&server)
            .await;
        let s = services(&server.uri(), "http://unused");
        s.set_client(Service::Google, "cid", Some("shh")).unwrap();
        s.oauth.tokens.save("cloud:google", &TokenSet { access: "old".into(), refresh: Some("r".into()), expires_at: 1, account: None, client_id: None, obtained_at: None }).unwrap();
        let e = s.token(Service::Google).await.unwrap_err();
        assert!(e.to_string().contains("session expired"));
        assert_eq!(s.status(Service::Google).unwrap().state, "error");
    }

    pub async fn signed_in(server: &MockServer) -> crate::cloud::CloudServices {
        let s = services(&server.uri(), "http://unused");
        s.set_client(Service::Google, "cid", Some("shh")).unwrap();
        s.oauth
            .tokens
            .save("cloud:google", &TokenSet { access: "tok".into(), refresh: Some("r".into()), expires_at: now_ms() + 3_600_000, account: None, client_id: None, obtained_at: None })
            .unwrap();
        s
    }

    #[tokio::test]
    async fn lists_folders_and_searches() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files"))
            .and(bearer_token("tok"))
            .and(query_param("q", "'root' in parents and trashed = false"))
            .and(query_param("orderBy", "folder,name"))
            .and(query_param("pageSize", "100"))
            .and(query_param("fields", LIST_FIELDS))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "nextPageToken": "p2",
                "files": [
                    {"id": "f1", "name": "Biology", "mimeType": FOLDER, "modifiedTime": "2026-01-02T10:00:00.000Z"},
                    {"id": "d1", "name": "Lecture notes", "mimeType": DOC},
                    {"id": "b1", "name": "paper.pdf", "mimeType": "application/pdf", "size": "1234"},
                    {"id": "i1", "name": "photo.jpg", "mimeType": "image/jpeg", "size": "99"}
                ]
            })))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files"))
            .and(query_param("q", "'f1' in parents and trashed = false"))
            .and(query_param("pageToken", "p2"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"files": []})))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files"))
            .and(query_param("q", "name contains 'cell\\'s' and trashed = false"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"files": [{"id": "x", "name": "cell's.txt", "mimeType": "text/plain"}]})))
            .expect(1)
            .mount(&server)
            .await;

        let s = signed_in(&server).await;
        let page = s.list(Service::Google, None, None, None).await.unwrap();
        assert_eq!(page.next_page_token.as_deref(), Some("p2"));
        let v: Vec<(&str, bool, bool, Option<u64>)> = page.items.iter().map(|i| (i.id.as_str(), i.folder, i.supported, i.size)).collect();
        assert_eq!(v, vec![("f1", true, false, None), ("d1", false, true, None), ("b1", false, true, Some(1234)), ("i1", false, false, Some(99))]);
        assert_eq!(page.items[0].modified.as_deref(), Some("2026-01-02T10:00:00.000Z"));
        assert!(s.list(Service::Google, Some("f1"), None, Some("p2")).await.unwrap().items.is_empty());
        let found = s.list(Service::Google, Some("f1"), Some(" cell's "), None).await.unwrap();
        assert_eq!(found.items[0].name, "cell's.txt");
    }

    #[tokio::test]
    async fn downloads_export_and_media() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/doc1/export"))
            .and(query_param("mimeType", "text/markdown"))
            .and(bearer_token("tok"))
            .respond_with(ResponseTemplate::new(200).set_body_string("# Notes\n\nCells divide."))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/bin1"))
            .and(query_param("alt", "media"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![7u8; 4096]))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/big"))
            .and(query_param("alt", "media"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![1u8; 2048]))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/gone"))
            .respond_with(ResponseTemplate::new(404).set_body_json(json!({"error": {"code": 404, "message": "File not found: gone."}})))
            .mount(&server)
            .await;

        let s = signed_in(&server).await;
        let dir = tempfile::tempdir().unwrap();
        let doc = CloudItem { id: "doc1".into(), name: "My Notes".into(), folder: false, mime_type: Some(DOC.into()), size: None, modified: None, supported: true };
        let p = s.download(Service::Google, &doc, dir.path(), 1024).await.unwrap();
        assert_eq!(p.file_name().unwrap(), "My Notes.md");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "# Notes\n\nCells divide.");

        let bin = CloudItem { id: "bin1".into(), name: "paper.pdf".into(), folder: false, mime_type: Some("application/pdf".into()), size: Some(4096), modified: None, supported: true };
        let p = s.download(Service::Google, &bin, dir.path(), 1 << 20).await.unwrap();
        assert_eq!(std::fs::read(&p).unwrap().len(), 4096);

        // size cap: declared size, then actual body size (metadata can lie or be missing)
        let mut big = CloudItem { id: "big".into(), name: "big.pdf".into(), size: Some(10 << 20), ..bin.clone() };
        assert!(s.download(Service::Google, &big, dir.path(), 1024).await.unwrap_err().to_string().contains("larger than"));
        big.size = None;
        assert!(s.download(Service::Google, &big, dir.path(), 1024).await.unwrap_err().to_string().contains("larger than"));
        assert!(!dir.path().join("big.pdf").exists());

        let gone = CloudItem { id: "gone".into(), name: "gone.pdf".into(), size: None, ..bin.clone() };
        let e = s.download(Service::Google, &gone, dir.path(), 1024).await.unwrap_err().to_string();
        assert!(e.contains("404") && e.contains("File not found"), "{e}");

        let img = CloudItem { id: "i".into(), name: "photo.jpg".into(), mime_type: Some("image/jpeg".into()), ..bin };
        assert!(s.download(Service::Google, &img, dir.path(), 1024).await.unwrap_err().to_string().contains("unsupported"));
    }
}
