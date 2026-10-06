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
