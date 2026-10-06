//! Google Drive and Dropbox import: OAuth (PKCE + loopback) with the user's own app registration,
//! folder browsing, and streaming downloads that go through the normal file import pipeline.

pub mod commands;
pub mod dropbox;
pub mod google;

use crate::error::{AppError, AppResult};
use crate::ingest::Ingest;
use crate::oauth::tokens::TokenSet;
use crate::oauth::OAuth;
use crate::secrets::SecretStore;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

pub const MAX_DOWNLOAD_BYTES: u64 = 200 * 1024 * 1024;
pub const REFRESH_SKEW_MS: i64 = 5 * 60 * 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Service {
    Google,
    Dropbox,
}

impl Service {
    /// Keychain account for the app registration; tokens live under `oauth:<this>`.
    pub fn account(self) -> &'static str {
        match self {
            Service::Google => "cloud:google",
            Service::Dropbox => "cloud:dropbox",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Service::Google => "Google Drive",
            Service::Dropbox => "Dropbox",
        }
    }

    pub fn origin(self, id: &str) -> String {
        match self {
            Service::Google => format!("gdrive://{id}"),
            Service::Dropbox => format!("dropbox://{id}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfig {
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
}

/// A file or folder. `id` is the Drive file id or the Dropbox `path_display`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudItem {
    pub id: String,
    pub name: String,
    pub folder: bool,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    /// RFC 3339
    #[serde(default)]
    pub modified: Option<String>,
    #[serde(default)]
    pub supported: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudPage {
    pub items: Vec<CloudItem>,
    pub next_page_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatus {
    pub service: Service,
    pub configured: bool,
    pub client_id: Option<String>,
    pub has_secret: bool,
    /// signedOut | pending | signedIn | error
    pub state: &'static str,
    pub account: Option<String>,
    pub error: Option<String>,
    /// The exact redirect URI to register (Dropbox only accepts registered ones).
    pub redirect_uri: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFailure {
    pub name: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudImportResult {
    pub sources: Vec<crate::db::models::Source>,
    pub failures: Vec<ImportFailure>,
}

#[derive(Debug, Clone)]
pub struct AuthRequest {
    pub url: String,
    pub state: String,
    pub verifier: String,
    pub redirect_uri: String,
}

pub fn too_large(cap: u64) -> AppError {
    let limit = if cap >= 1024 * 1024 { format!("{} MB", cap / (1024 * 1024)) } else { format!("{cap} bytes") };
    AppError::Other(format!("The file is larger than {limit}."))
}

/// Readable error for a failed API call.
pub fn api_error(service: Service, status: u16, body: &str) -> AppError {
    if status == 401 {
        return AppError::Other(format!("Your {} session expired. Connect again in Settings.", service.label()));
    }
    let v: Option<Value> = serde_json::from_str(body).ok();
    let detail = v
        .as_ref()
        .and_then(|v| v.pointer("/error/message").or_else(|| v.get("error_summary")).or_else(|| v.get("error")))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| body.chars().take(200).collect());
    AppError::Other(format!("{} returned HTTP {status}: {}", service.label(), detail.trim()))
}

pub async fn check(service: Service, resp: reqwest::Response) -> AppResult<reqwest::Response> {
    let status = resp.status().as_u16();
    if (200..300).contains(&status) {
        return Ok(resp);
    }
    let body = resp.text().await.unwrap_or_default();
    Err(api_error(service, status, &body))
}

/// Streams a response body to `dest`, giving up past `cap` bytes. Partial files are removed.
pub async fn stream_to_file(resp: reqwest::Response, dest: &Path, cap: u64) -> AppResult<u64> {
    if resp.content_length().is_some_and(|n| n > cap) {
        return Err(too_large(cap));
    }
    let result = async {
        let mut f = tokio::fs::File::create(dest).await?;
        let mut stream = resp.bytes_stream();
        let mut total = 0u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            total += chunk.len() as u64;
            if total > cap {
                return Err(too_large(cap));
            }
            f.write_all(&chunk).await?;
        }
        f.flush().await?;
        Ok(total)
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(dest).await;
    }
    result
}

/// A file name that is safe to create inside our own folder.
pub fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '\0') || c.is_control() { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.').to_string();
    let mut out = if trimmed.is_empty() { "file".to_string() } else { trimmed };
    if out.len() > 180 {
        let ext = Path::new(&out).extension().map(|e| e.to_string_lossy().into_owned());
        let mut cut = 160;
        while !out.is_char_boundary(cut) {
            cut -= 1;
        }
        out.truncate(cut);
        if let Some(e) = ext {
            out = format!("{out}.{e}");
        }
    }
    out
}

pub fn title_for(name: &str) -> String {
    Path::new(name)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| name.to_string())
}

pub struct CloudServices {
    pub oauth: OAuth,
    pub secrets: Arc<dyn SecretStore>,
    pub dl: reqwest::Client,
    pub google: google::Endpoints,
    pub dropbox: dropbox::Endpoints,
}

impl CloudServices {
    pub fn new(secrets: Arc<dyn SecretStore>) -> Self {
        Self {
            oauth: OAuth::new(secrets.clone()),
            secrets,
            dl: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(15))
                .read_timeout(Duration::from_secs(60))
                .build()
                .expect("http client"),
            google: google::Endpoints::default(),
            dropbox: dropbox::Endpoints::default(),
        }
    }

    pub fn client(&self, svc: Service) -> AppResult<Option<ClientConfig>> {
        Ok(self.secrets.get(svc.account())?.and_then(|s| serde_json::from_str(&s).ok()))
    }

    /// Saves the app registration. An empty client id removes it. A changed id signs out.
    pub fn set_client(&self, svc: Service, client_id: &str, client_secret: Option<&str>) -> AppResult<()> {
        let id = client_id.trim();
        let secret = client_secret.map(str::trim).filter(|s| !s.is_empty());
        let old = self.client(svc)?;
        if id.is_empty() {
            self.secrets.delete(svc.account())?;
            return self.oauth.sign_out(svc.account());
        }
        if id.chars().any(char::is_whitespace) {
            return Err(crate::error::invalid("The client ID can't contain spaces"));
        }
        let secret = secret.map(str::to_string).or_else(|| old.as_ref().filter(|o| o.client_id == id).and_then(|o| o.client_secret.clone()));
        let cfg = ClientConfig { client_id: id.to_string(), client_secret: if svc == Service::Google { secret } else { None } };
        self.secrets.set(svc.account(), &serde_json::to_string(&cfg)?)?;
        if old.map(|o| o.client_id) != Some(cfg.client_id) {
            self.oauth.sign_out(svc.account())?;
        }
        Ok(())
    }

    pub fn status(&self, svc: Service) -> AppResult<CloudStatus> {
        let client = self.client(svc)?;
        let s = self.oauth.status(svc.account())?;
        Ok(CloudStatus {
            service: svc,
            configured: client.is_some(),
            has_secret: client.as_ref().is_some_and(|c| c.client_secret.is_some()),
            client_id: client.map(|c| c.client_id),
            state: s.state,
            account: s.account,
            error: s.error,
            redirect_uri: (svc == Service::Dropbox).then(dropbox::redirect_uri),
        })
    }

    pub fn require_client(&self, svc: Service) -> AppResult<ClientConfig> {
        let c = self.client(svc)?.ok_or_else(|| {
            crate::error::invalid(match svc {
                Service::Google => "Add a Google client ID in Settings first.",
                Service::Dropbox => "Add a Dropbox app key in Settings first.",
            })
        })?;
        if svc == Service::Google && c.client_secret.is_none() {
            return Err(crate::error::invalid("Add the Google client secret in Settings first."));
        }
        Ok(c)
    }

    pub fn build_authorize(&self, svc: Service, client: &ClientConfig, redirect_uri: &str) -> AuthRequest {
        match svc {
            Service::Google => google::build_authorize(&self.google, &client.client_id, redirect_uri),
            Service::Dropbox => dropbox::build_authorize(&self.dropbox, &client.client_id, redirect_uri),
        }
    }

    /// Exchanges the code, looks up the account name and stores the tokens.
    pub async fn finish_sign_in(&self, svc: Service, client: &ClientConfig, req: &AuthRequest, code: &str) -> AppResult<TokenSet> {
        let http = &self.oauth.http;
        let mut ts = match svc {
            Service::Google => google::exchange_code(http, &self.google, client, code, &req.verifier, &req.redirect_uri).await?,
            Service::Dropbox => dropbox::exchange_code(http, &self.dropbox, client, code, &req.verifier, &req.redirect_uri).await?,
        };
        let account = match svc {
            Service::Google => google::account(http, &self.google, &ts.access).await,
            Service::Dropbox => dropbox::account(http, &self.dropbox, &ts.access).await,
        };
        if account.is_some() {
            ts.account = account;
        }
        self.oauth.tokens.save(svc.account(), &ts)?;
        Ok(ts)
    }

    /// A valid access token, refreshed through the rotation-safe token manager when needed.
    pub async fn token(&self, svc: Service) -> AppResult<String> {
        let client = self.require_client(svc)?;
        let http = &self.oauth.http;
        let result = match svc {
            Service::Google => {
                let ep = &self.google;
                let c = &client;
                self.oauth
                    .tokens
                    .valid(svc.account(), |_| REFRESH_SKEW_MS, |old| async move { google::refresh(http, ep, c, &old).await })
                    .await
            }
            Service::Dropbox => {
                let ep = &self.dropbox;
                let c = &client;
                self.oauth
                    .tokens
                    .valid(svc.account(), |_| REFRESH_SKEW_MS, |old| async move { dropbox::refresh(http, ep, c, &old).await })
                    .await
            }
        };
        match result {
            Ok(ts) => {
                if self.oauth.status(svc.account()).is_ok_and(|s| s.state == "error") {
                    self.oauth.clear_transient(svc.account());
                }
                Ok(ts.access)
            }
            Err(e) => {
                if self.oauth.tokens.load(svc.account()).ok().flatten().is_some() {
                    self.oauth.set_transient(self.oauth.error_status(svc.account(), e.to_string()));
                }
                Err(e)
            }
        }
    }

    pub async fn list(&self, svc: Service, folder: Option<&str>, query: Option<&str>, page_token: Option<&str>) -> AppResult<CloudPage> {
        let token = self.token(svc).await?;
        let query = query.map(str::trim).filter(|q| !q.is_empty());
        let folder = folder.filter(|f| !f.is_empty());
        let page_token = page_token.filter(|p| !p.is_empty());
        match svc {
            Service::Google => google::list(&self.oauth.http, &self.google, &token, folder, query, page_token).await,
            Service::Dropbox => dropbox::list(&self.oauth.http, &self.dropbox, &token, folder, query, page_token).await,
        }
    }

    pub async fn download(&self, svc: Service, item: &CloudItem, dir: &Path, cap: u64) -> AppResult<PathBuf> {
        let token = self.token(svc).await?;
        match svc {
            Service::Google => google::download(&self.dl, &self.google, &token, item, dir, cap).await,
            Service::Dropbox => dropbox::download(&self.dl, &self.dropbox, &token, item, dir, cap).await,
        }
    }

    /// Downloads each item to `<imports_dir>/<uuid>/<name>` and imports it. One failure doesn't stop the rest.
    pub async fn import(&self, ingest: &Ingest, svc: Service, space_id: &str, items: &[CloudItem], imports_dir: &Path, cap: u64) -> CloudImportResult {
        let mut sources = Vec::new();
        let mut failures = Vec::new();
        for item in items {
            match self.import_one(ingest, svc, space_id, item, imports_dir, cap).await {
                Ok(src) => sources.push(src),
                Err(e) => {
                    log::warn!("{} import of one file failed: {e}", svc.label());
                    failures.push(ImportFailure { name: item.name.clone(), error: e.to_string() });
                }
            }
        }
        CloudImportResult { sources, failures }
    }

    async fn import_one(&self, ingest: &Ingest, svc: Service, space_id: &str, item: &CloudItem, imports_dir: &Path, cap: u64) -> AppResult<crate::db::models::Source> {
        if item.folder {
            return Err(crate::error::invalid("Folders can't be imported. Open the folder and pick files."));
        }
        let title = match svc {
            Service::Google if item.mime_type.as_deref().is_some_and(|m| google::export_for(m).is_some()) => item.name.trim().to_string(),
            _ => title_for(&item.name),
        };
        let dir = imports_dir.join(uuid::Uuid::new_v4().to_string());
        tokio::fs::create_dir_all(&dir).await?;
        let path = match self.download(svc, item, &dir, cap).await {
            Ok(p) => p,
            Err(e) => {
                let _ = tokio::fs::remove_dir_all(&dir).await;
                return Err(e);
            }
        };
        let ingest = ingest.clone();
        let space_id = space_id.to_string();
        let origin = svc.origin(&item.id);
        tokio::task::spawn_blocking(move || ingest.import_file_as(&space_id, &path.to_string_lossy(), &title, &origin))
            .await
            .map_err(|e| AppError::Other(e.to_string()))?
    }

    /// Best-effort token revocation, then forgets the tokens.
    pub async fn disconnect(&self, svc: Service) -> AppResult<()> {
        self.oauth.cancel_flow(svc.account());
        if let Ok(Some(ts)) = self.oauth.tokens.load(svc.account()) {
            let http = &self.oauth.http;
            let revoke = async {
                match svc {
                    Service::Google => google::revoke(http, &self.google, ts.refresh.as_deref().unwrap_or(&ts.access)).await,
                    Service::Dropbox => dropbox::revoke(http, &self.dropbox, &ts.access).await,
                }
            };
            let _ = tokio::time::timeout(Duration::from_secs(5), revoke).await;
        }
        self.oauth.sign_out(svc.account())
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::secrets::MemoryStore;

    pub fn services(google_base: &str, dropbox_base: &str) -> CloudServices {
        let mut s = CloudServices::new(Arc::new(MemoryStore::default()));
        s.google = google::Endpoints::with_base(google_base);
        s.dropbox = dropbox::Endpoints::with_base(dropbox_base);
        s
    }

    #[test]
    fn safe_names() {
        assert_eq!(safe_file_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(safe_file_name("a/b\\c:d.pdf"), "a_b_c_d.pdf");
        assert_eq!(safe_file_name("  "), "file");
        assert_eq!(safe_file_name(".hidden.md"), "hidden.md");
        let long = format!("{}.pdf", "ä".repeat(150));
        let s = safe_file_name(&long);
        assert!(s.len() <= 170 && s.ends_with(".pdf"));
        assert_eq!(title_for("Lecture 3.pdf"), "Lecture 3");
    }

    #[test]
    fn client_config_and_status() {
        let s = services("http://x", "http://y");
        let st = s.status(Service::Google).unwrap();
        assert!(!st.configured);
        assert_eq!(st.state, "signedOut");
        assert!(s.require_client(Service::Google).unwrap_err().to_string().contains("Add a Google client ID"));

        s.set_client(Service::Google, " id.apps.googleusercontent.com ", None).unwrap();
        assert!(s.require_client(Service::Google).unwrap_err().to_string().contains("client secret"));
        s.set_client(Service::Google, "id.apps.googleusercontent.com", Some("sec")).unwrap();
        s.oauth
            .tokens
            .save("cloud:google", &TokenSet { access: "a".into(), refresh: Some("r".into()), expires_at: 0, account: Some("me@x.com".into()), client_id: None, obtained_at: None })
            .unwrap();
        let st = s.status(Service::Google).unwrap();
        assert!(st.configured && st.has_secret);
        assert_eq!(st.client_id.as_deref(), Some("id.apps.googleusercontent.com"));
        assert_eq!((st.state, st.account.as_deref()), ("signedIn", Some("me@x.com")));
        // tokens are stored under oauth:cloud:google; the registration under cloud:google
        assert!(s.secrets.get("oauth:cloud:google").unwrap().is_some());
        assert!(!s.secrets.get("cloud:google").unwrap().unwrap().contains("\"access\""));

        // same id keeps the secret and the session
        s.set_client(Service::Google, "id.apps.googleusercontent.com", None).unwrap();
        assert_eq!(s.client(Service::Google).unwrap().unwrap().client_secret.as_deref(), Some("sec"));
        assert_eq!(s.status(Service::Google).unwrap().state, "signedIn");
        // a different id signs out
        s.set_client(Service::Google, "other", Some("sec2")).unwrap();
        assert_eq!(s.status(Service::Google).unwrap().state, "signedOut");
        // dropbox never stores a secret
        s.set_client(Service::Dropbox, "appkey", Some("ignored")).unwrap();
        assert_eq!(s.client(Service::Dropbox).unwrap().unwrap().client_secret, None);
        s.set_client(Service::Dropbox, "", None).unwrap();
        assert!(!s.status(Service::Dropbox).unwrap().configured);
    }

    #[tokio::test]
    async fn imports_record_origin_and_title() {
        use crate::ingest::embed::FakeEmbedder;
        use crate::ingest::tests::{setup, wait_status};
        use wiremock::matchers::{header, method, path, query_param};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/doc1/export"))
            .and(query_param("mimeType", "text/markdown"))
            .respond_with(ResponseTemplate::new(200).set_body_string("# Cells\n\nMitochondria make ATP."))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/pdf1"))
            .and(query_param("alt", "media"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(crate::ingest::extract::tests::sample_pdf()))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/content/2/files/download"))
            .and(header("Dropbox-API-Arg", r#"{"path":"/Notes/Genetics.md"}"#))
            .respond_with(ResponseTemplate::new(200).set_body_string("DNA is copied before division."))
            .mount(&server)
            .await;

        let s = services(&server.uri(), &server.uri());
        let far = crate::oauth::tokens::now_ms() + 3_600_000;
        for svc in [Service::Google, Service::Dropbox] {
            s.set_client(svc, "cid", Some("sec")).unwrap();
            s.oauth.tokens.save(svc.account(), &TokenSet { access: "tok".into(), refresh: Some("r".into()), expires_at: far, account: None, client_id: None, obtained_at: None }).unwrap();
        }
        let (ing, db, dir, _events, space) = setup(Some(Arc::new(FakeEmbedder)));
        let imports = dir.path().join("imports");

        let doc = CloudItem { id: "doc1".into(), name: "Biology 101".into(), folder: false, mime_type: Some(google::DOC.into()), size: None, modified: None, supported: true };
        let pdf = CloudItem { id: "pdf1".into(), name: "paper.pdf".into(), mime_type: Some("application/pdf".into()), size: Some(100), ..doc.clone() };
        let img = CloudItem { id: "img".into(), name: "photo.jpg".into(), mime_type: Some("image/jpeg".into()), ..doc.clone() };
        let out = s.import(&ing, Service::Google, &space, &[doc, pdf, img], &imports, MAX_DOWNLOAD_BYTES).await;
        assert_eq!(out.sources.len(), 2);
        assert_eq!(out.failures.len(), 1);
        assert_eq!(out.failures[0].name, "photo.jpg");
        let doc_src = wait_status(&db, &out.sources[0].id, "ready");
        assert_eq!((doc_src.title.as_str(), doc_src.kind.as_str(), doc_src.origin.as_deref()), ("Biology 101", "markdown", Some("gdrive://doc1")));
        let pdf_src = wait_status(&db, &out.sources[1].id, "ready");
        assert_eq!((pdf_src.title.as_str(), pdf_src.kind.as_str(), pdf_src.origin.as_deref()), ("paper", "pdf", Some("gdrive://pdf1")));

        let md = CloudItem { id: "/Notes/Genetics.md".into(), name: "Genetics.md".into(), folder: false, mime_type: None, size: Some(30), modified: None, supported: true };
        let out = s.import(&ing, Service::Dropbox, &space, &[md], &imports, MAX_DOWNLOAD_BYTES).await;
        assert!(out.failures.is_empty());
        let src = wait_status(&db, &out.sources[0].id, "ready");
        assert_eq!((src.title.as_str(), src.origin.as_deref()), ("Genetics", Some("dropbox:///Notes/Genetics.md")));
        let text = crate::db::models::get_source_text(&db.conn().unwrap(), &src.id).unwrap();
        assert!(text.text.contains("DNA is copied"));
        // each download gets its own folder; the failed one leaves nothing behind
        assert_eq!(std::fs::read_dir(&imports).unwrap().count(), 3);
    }
}

