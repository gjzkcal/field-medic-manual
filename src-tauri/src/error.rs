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
    #[error("権限がありません: {0}")]
    Forbidden(String),
    #[error("内部エラー: {0}")]
    Internal(String),
    #[error("データベースエラー: {0}")]
    Db(#[from] rusqlite::Error),
}

/// TS 側で分岐に使うエラーの種類。文字列リテラルの union として生成される。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ErrorKind {
    Io,
    NotFound,
    InvalidInput,
    Forbidden,
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
            Self::Forbidden(_) => ErrorKind::Forbidden,
            // DB の失敗は利用者が対処できる種類のエラーではないため、TS 側では内部エラーとして扱う
            Self::Internal(_) | Self::Db(_) => ErrorKind::Internal,
        }
    }

    /// 画面に送る文面。`detailed` が false なら、利用者が対処できない種類のエラーは決まった文面にする。
    /// rusqlite の文面は表・列の名前や SQL 文を、`Io` の文面はパスを含むため、配布版では内部の作りを画面に出さず、ログにだけ残す。
    fn message(&self, detailed: bool) -> String {
        match self {
            Self::Db(_) if !detailed => DB_ERROR_MESSAGE.to_owned(),
            Self::Io(_) if !detailed => IO_ERROR_MESSAGE.to_owned(),
            Self::Internal(_) if !detailed => INTERNAL_ERROR_MESSAGE.to_owned(),
            _ => self.to_string(),
        }
    }

    /// ログに書く。`NotFound` は消した文書を開いたときなど普段の操作でも起きるので書かない。
    fn report(&self) {
        match self {
            Self::NotFound(_) => {}
            Self::InvalidInput(_) | Self::Forbidden(_) => log::warn!("{self}"),
            Self::Io(_) | Self::Internal(_) | Self::Db(_) => log::error!("{self}"),
        }
    }
}

const DB_ERROR_MESSAGE: &str = "データベースの処理に失敗しました";
const IO_ERROR_MESSAGE: &str = "ファイルの読み書きに失敗しました";
const INTERNAL_ERROR_MESSAGE: &str = "アプリの内部で問題が起きました";

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        // コマンドが返すエラーはすべてここを通る。コマンドごとに書かなくて済み、書き漏らしも起きない
        self.report();
        ErrorPayload {
            kind: self.kind(),
            // 開発中は原因を追えるよう、詳しい文面も画面に出す
            message: self.message(cfg!(debug_assertions)),
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
    fn db_error_hides_details_unless_detailed() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory DB should open");
        let err = AppError::from(
            conn.prepare("SELECT secret_column FROM secret_table")
                .expect_err("unknown table should fail"),
        );
        assert_eq!(err.message(false), DB_ERROR_MESSAGE);
        assert!(err.message(true).contains("secret_table"));
    }

    #[test]
    fn io_and_internal_errors_hide_details_unless_detailed() {
        let err = AppError::from(std::io::Error::other(r"C:\Users\name\secret"));
        assert_eq!(err.message(false), IO_ERROR_MESSAGE);
        assert!(err.message(true).contains("secret"));

        let err = AppError::Internal("設定 viewer の値を読めません: expected".to_owned());
        assert_eq!(err.message(false), INTERNAL_ERROR_MESSAGE);
        assert!(err.message(true).contains("viewer"));
    }

    #[test]
    fn errors_the_user_can_act_on_keep_their_message() {
        let err = AppError::InvalidInput("キーが長すぎます".to_owned());
        assert_eq!(err.message(false), "入力が不正です: キーが長すぎます");
        let err = AppError::NotFound("doc 42".to_owned());
        assert_eq!(err.message(false), "見つかりません: doc 42");
    }

    #[test]
    fn forbidden_has_its_own_kind_and_message() {
        let err = AppError::Forbidden("小窓からは変えられません".to_owned());
        assert_eq!(err.kind(), ErrorKind::Forbidden);
        assert_eq!(
            err.message(false),
            "権限がありません: 小窓からは変えられません"
        );
    }

    #[test]
    fn io_error_maps_to_io_kind() {
        let err = AppError::from(std::io::Error::other("disk"));
        assert_eq!(err.kind(), ErrorKind::Io);
    }
}
