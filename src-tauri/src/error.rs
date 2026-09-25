use serde::{Serialize, Serializer};
use ts_rs::TS;

/// すべての Tauri コマンドが返す共通エラー。
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("入出力エラー: {0}")]
    Io(#[from] std::io::Error),
    #[error("見つかりません: {0}")]
    NotFound(String),
    #[error("入力が不正です: {0}")]
    InvalidInput(String),
    #[error("内部エラー: {0}")]
    Internal(String),
}

/// TS 側で分岐に使うエラーの種類。文字列リテラルの union として生成される。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ErrorKind {
    Io,
    NotFound,
    InvalidInput,
    Internal,
}

/// IPC で送る形。`AppError` は `std::io::Error` などを抱えて直接シリアライズできないため、この形に写して送る。
#[derive(Debug, Serialize, TS)]
#[ts(export, rename = "AppError")]
pub struct ErrorPayload {
    pub kind: ErrorKind,
    pub message: String,
}

impl AppError {
    #[must_use]
    pub const fn kind(&self) -> ErrorKind {
        match self {
            Self::Io(_) => ErrorKind::Io,
            Self::NotFound(_) => ErrorKind::NotFound,
            Self::InvalidInput(_) => ErrorKind::InvalidInput,
            Self::Internal(_) => ErrorKind::Internal,
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        ErrorPayload {
            kind: self.kind(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_to_kind_and_message() {
        let err = AppError::NotFound("doc 42".to_owned());
        let json = serde_json::to_value(&err).expect("AppError should serialize");
        assert_eq!(
            json,
            serde_json::json!({ "kind": "not_found", "message": "見つかりません: doc 42" })
        );
    }

    #[test]
    fn io_error_maps_to_io_kind() {
        let err = AppError::from(std::io::Error::other("disk"));
        assert_eq!(err.kind(), ErrorKind::Io);
    }
}
