use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("network error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("keychain error: {0}")]
    Keychain(String),
    #[error("{0} not found")]
    NotFound(String),
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Auth(String),
    #[error("{0}")]
    Other(String),
    /// An error the UI can show in the user's language: `key` names an entry in the UI's `errors`
    /// messages and `params` fill its `{0}`, `{1}` placeholders. `message` is the English text.
    #[error("{message}")]
    Keyed {
        code: &'static str,
        key: &'static str,
        params: Vec<String>,
        message: String,
    },
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Db(_) => "db",
            AppError::Io(_) => "io",
            AppError::Http(_) => "http",
            AppError::Json(_) => "json",
            AppError::Keychain(_) => "keychain",
            AppError::NotFound(_) => "not_found",
            AppError::Invalid(_) => "invalid",
            AppError::Auth(_) => "auth",
            AppError::Other(_) => "other",
            AppError::Keyed { code, .. } => code,
        }
    }

    /// Message key and parameters for the UI, when the error has a translated form.
    pub fn key(&self) -> Option<(&'static str, Vec<String>)> {
        use rusqlite::ErrorCode;
        use std::io::ErrorKind;
        match self {
            AppError::Keyed { key, params, .. } => Some((key, params.clone())),
            AppError::NotFound(what) => Some(("notFound", vec![what.clone()])),
            AppError::Db(rusqlite::Error::SqliteFailure(e, _))
                if matches!(e.code, ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) =>
            {
                Some(("dbBusy", vec![]))
            }
            AppError::Io(e) => match e.kind() {
                ErrorKind::NotFound => Some(("fileNotFound", vec![])),
                ErrorKind::PermissionDenied => Some(("permissionDenied", vec![])),
                _ => None,
            },
            _ => None,
        }
    }
}

#[derive(Serialize)]
struct ErrorPayload<'a> {
    code: &'a str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    key: Option<&'a str>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    params: Vec<String>,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let (key, params) = match self.key() {
            Some((k, p)) => (Some(k), p),
            None => (None, Vec::new()),
        };
        ErrorPayload {
            code: self.code(),
            message: self.to_string(),
            key,
            params,
        }
        .serialize(s)
    }
}

pub type AppResult<T> = Result<T, AppError>;

pub fn invalid(msg: impl Into<String>) -> AppError {
    AppError::Invalid(msg.into())
}

/// An invalid-input error with a translatable form.
pub fn invalid_key(key: &'static str, msg: impl Into<String>) -> AppError {
    keyed("invalid", key, Vec::new(), msg)
}

pub fn keyed(
    code: &'static str,
    key: &'static str,
    params: Vec<String>,
    message: impl Into<String>,
) -> AppError {
    AppError::Keyed {
        code,
        key,
        params,
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn plain_errors_serialize_without_a_key() {
        let v = serde_json::to_value(invalid("Bad input")).unwrap();
        assert_eq!(v, json!({ "code": "invalid", "message": "Bad input" }));
    }

    #[test]
    fn keyed_errors_carry_key_and_params() {
        let e = keyed(
            "other",
            "cantConnect",
            vec!["example.org".into()],
            "Couldn't connect to example.org",
        );
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["code"], "other");
        assert_eq!(v["key"], "cantConnect");
        assert_eq!(v["params"], json!(["example.org"]));
        assert_eq!(e.to_string(), "Couldn't connect to example.org");
    }

    #[test]
    fn common_errors_get_keys() {
        let v = serde_json::to_value(AppError::NotFound("card".into())).unwrap();
        assert_eq!(v["key"], "notFound");
        assert_eq!(v["params"], json!(["card"]));
        let io = AppError::Io(std::io::Error::from(std::io::ErrorKind::NotFound));
        assert_eq!(serde_json::to_value(io).unwrap()["key"], "fileNotFound");
        let busy = AppError::Db(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
            None,
        ));
        assert_eq!(serde_json::to_value(busy).unwrap()["key"], "dbBusy");
        let other = AppError::Io(std::io::Error::from(std::io::ErrorKind::BrokenPipe));
        assert!(serde_json::to_value(other).unwrap().get("key").is_none());
    }
}
