//! OS keychain wrapper. Values are never logged.

use crate::error::{invalid, AppError, AppResult};

pub const SERVICE: &str = "dev.ponder.app";

/// Keychain account for a provider's OAuth token set (API keys use the bare provider id).
pub fn oauth_account(provider_id: &str) -> String {
    format!("oauth:{provider_id}")
}

pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> AppResult<Option<String>>;
    fn set(&self, account: &str, value: &str) -> AppResult<()>;
    fn delete(&self, account: &str) -> AppResult<()>;
}

pub struct Keychain;

fn kc_err(e: keyring::Error) -> AppError {
    AppError::Keychain(e.to_string())
}

impl SecretStore for Keychain {
    fn get(&self, account: &str) -> AppResult<Option<String>> {
        let entry = keyring::Entry::new(SERVICE, account).map_err(kc_err)?;
        match entry.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(kc_err(e)),
        }
    }

    fn set(&self, account: &str, value: &str) -> AppResult<()> {
        keyring::Entry::new(SERVICE, account).and_then(|e| e.set_password(value)).map_err(kc_err)
    }

    fn delete(&self, account: &str) -> AppResult<()> {
        let entry = keyring::Entry::new(SERVICE, account).map_err(kc_err)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(kc_err(e)),
        }
    }
}

static FILE_STORE_PATH: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

/// Must run before any secret is read when `default_store` is the file store.
pub fn init(data_dir: &std::path::Path) {
    let _ = FILE_STORE_PATH.set(data_dir.join("dev-secrets.json"));
}

/// Debug builds keep secrets in a 0600 JSON file in the app data dir: every rebuild changes the
/// binary's signature, so macOS would ask for keychain access again on each read.
pub fn default_store() -> std::sync::Arc<dyn SecretStore> {
    static STORE: std::sync::OnceLock<std::sync::Arc<dyn SecretStore>> = std::sync::OnceLock::new();
    STORE
        .get_or_init(|| if cfg!(debug_assertions) { std::sync::Arc::new(FileStore::default()) } else { std::sync::Arc::new(Keychain) })
        .clone()
}

#[derive(Default)]
pub struct FileStore {
    lock: std::sync::Mutex<()>,
    path: Option<std::path::PathBuf>,
}

impl FileStore {
    fn path(&self) -> AppResult<&std::path::Path> {
        self.path.as_deref().or(FILE_STORE_PATH.get().map(|p| p.as_path())).ok_or_else(|| AppError::Keychain("Secret store isn't ready yet".into()))
    }

    fn read(&self) -> AppResult<std::collections::BTreeMap<String, String>> {
        match std::fs::read_to_string(self.path()?) {
            Ok(s) => serde_json::from_str(&s).map_err(|e| AppError::Keychain(format!("Secret file is unreadable: {e}"))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Default::default()),
            Err(e) => Err(AppError::Keychain(e.to_string())),
        }
    }

    fn write(&self, map: &std::collections::BTreeMap<String, String>) -> AppResult<()> {
        use std::io::Write;
        let path = self.path()?;
        let tmp = path.with_extension("json.tmp");
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o600);
        let mut f = opts.open(&tmp).map_err(|e| AppError::Keychain(e.to_string()))?;
        f.write_all(serde_json::to_string_pretty(map).unwrap_or_default().as_bytes()).map_err(|e| AppError::Keychain(e.to_string()))?;
        std::fs::rename(&tmp, path).map_err(|e| AppError::Keychain(e.to_string()))
    }
}

impl SecretStore for FileStore {
    fn get(&self, account: &str) -> AppResult<Option<String>> {
        let _g = self.lock.lock().unwrap();
        Ok(self.read()?.get(account).cloned())
    }
    fn set(&self, account: &str, value: &str) -> AppResult<()> {
        let _g = self.lock.lock().unwrap();
        let mut map = self.read()?;
        map.insert(account.to_string(), value.to_string());
        self.write(&map)
    }
    fn delete(&self, account: &str) -> AppResult<()> {
        let _g = self.lock.lock().unwrap();
        let mut map = self.read()?;
        if map.remove(account).is_some() {
            self.write(&map)?;
        }
        Ok(())
    }
}

/// In-memory store for tests.
#[cfg(test)]
#[derive(Default)]
pub struct MemoryStore(std::sync::Mutex<std::collections::HashMap<String, String>>);

#[cfg(test)]
impl SecretStore for MemoryStore {
    fn get(&self, account: &str) -> AppResult<Option<String>> {
        Ok(self.0.lock().unwrap().get(account).cloned())
    }
    fn set(&self, account: &str, value: &str) -> AppResult<()> {
        self.0.lock().unwrap().insert(account.to_string(), value.to_string());
        Ok(())
    }
    fn delete(&self, account: &str) -> AppResult<()> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}

/// Trims and validates an API key before storing it.
pub fn set_api_key(store: &dyn SecretStore, provider_id: &str, value: &str) -> AppResult<()> {
    let v = value.trim();
    if v.is_empty() {
        return Err(invalid("Key can't be empty"));
    }
    if provider_id.trim().is_empty() {
        return Err(invalid("Missing provider"));
    }
    store.set(provider_id, v)
}

/// Removes everything stored for a provider: API key and OAuth tokens.
pub fn delete_all(store: &dyn SecretStore, provider_id: &str) -> AppResult<()> {
    store.delete(provider_id)?;
    store.delete(&oauth_account(provider_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_trims_and_rejects_empty() {
        let s = MemoryStore::default();
        assert!(set_api_key(&s, "p", "   ").is_err());
        set_api_key(&s, "p", "  sk-123 \n").unwrap();
        assert_eq!(s.get("p").unwrap().as_deref(), Some("sk-123"));
    }

    #[test]
    fn delete_all_removes_key_and_tokens() {
        let s = MemoryStore::default();
        s.set("p", "k").unwrap();
        s.set(&oauth_account("p"), "{}").unwrap();
        s.set("q", "k").unwrap();
        delete_all(&s, "p").unwrap();
        assert!(s.get("p").unwrap().is_none());
        assert!(s.get("oauth:p").unwrap().is_none());
        assert!(s.get("q").unwrap().is_some());
    }

    #[cfg(unix)]
    #[test]
    fn file_store_roundtrip_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let s = FileStore { path: Some(dir.path().join("s.json")), ..Default::default() };
        assert_eq!(s.get("p").unwrap(), None);
        s.set("p", "sk-1").unwrap();
        s.set("q", "sk-2").unwrap();
        s.delete("p").unwrap();
        assert_eq!(s.get("p").unwrap(), None);
        assert_eq!(s.get("q").unwrap().as_deref(), Some("sk-2"));
        let mode = std::fs::metadata(dir.path().join("s.json")).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    /// Touches the real OS keychain; run with `cargo test -- --ignored keychain`.
    #[test]
    #[ignore]
    fn real_keychain_roundtrip() {
        let kc = Keychain;
        let account = "test:keychain-roundtrip";
        kc.delete(account).unwrap();
        assert_eq!(kc.get(account).unwrap(), None);
        kc.set(account, "sk-test-value").unwrap();
        assert_eq!(kc.get(account).unwrap().as_deref(), Some("sk-test-value"));
        kc.delete(account).unwrap();
        assert_eq!(kc.get(account).unwrap(), None);
    }
}
