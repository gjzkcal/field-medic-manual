//! `SQLite` への保存と全文検索。設計は dev-docs/reference/data-model.md。

pub mod assets;
pub mod dict;
pub mod docs;
#[cfg(test)]
pub mod fixtures;
mod migrate;
pub mod search;
pub mod settings;
mod text;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::error::AppError;

pub const DB_FILE_NAME: &str = "field-medic.db";

/// Tauri の State として持つ DB の接続とデータのフォルダ。
///
/// 接続は 1 本だけにし、Mutex で直列化する（利用者は 1 人で、書き込みの競合を考えずに済むため）。
/// Arc で包むのは、コマンドから `spawn_blocking` に接続を持ち出すため。
pub struct Db {
    conn: Arc<Mutex<Connection>>,
    data_dir: Arc<PathBuf>,
}

impl Db {
    /// `data_dir` に DB ファイルを開き（なければ作り）、マイグレーションを適用する。
    ///
    /// # Errors
    ///
    /// フォルダを作れない、DB を開けない、マイグレーションに失敗した場合。
    pub fn open(data_dir: &Path) -> Result<Self, AppError> {
        std::fs::create_dir_all(data_dir)?;
        let mut conn = Connection::open(data_dir.join(DB_FILE_NAME))?;
        configure(&conn)?;
        // WAL は、書き込み中に読み取りを止めないため。インメモリ DB では使えないので open だけで設定する
        let mode: String =
            conn.pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get(0))?;
        if !mode.eq_ignore_ascii_case("wal") {
            return Err(AppError::Internal(format!(
                "journal_mode を WAL にできませんでした: {mode}"
            )));
        }
        migrate::migrate(&mut conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            data_dir: Arc::new(data_dir.to_path_buf()),
        })
    }

    /// 接続を別スレッドで使って `f` を実行する。
    ///
    /// Tauri の非同期コマンドから Mutex を直接取ると、DB の処理中に非同期ランタイムのスレッドが止まるため、
    /// ブロッキング用のスレッドに移して実行する。
    ///
    /// # Errors
    ///
    /// `f` が返したエラー。Mutex が壊れている、スレッドが異常終了した場合は `Internal`。
    pub async fn run<T, F>(&self, f: F) -> Result<T, AppError>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection, &Path) -> Result<T, AppError> + Send + 'static,
    {
        let conn = Arc::clone(&self.conn);
        let data_dir = Arc::clone(&self.data_dir);
        tauri::async_runtime::spawn_blocking(move || {
            let mut guard = conn
                .lock()
                .map_err(|_| AppError::Internal("DB の接続が使えない状態です".to_owned()))?;
            f(&mut guard, &data_dir)
        })
        .await
        .map_err(|e| AppError::Internal(format!("DB の処理が異常終了しました: {e}")))?
    }
}

fn configure(conn: &Connection) -> Result<(), AppError> {
    // SQLite は既定で外部キーを検査しない。カスケード削除に必要
    conn.pragma_update(None, "foreign_keys", true)?;
    Ok(())
}

/// 保存用の現在時刻（UTC の ISO 8601）。日時のクレートを増やさないため `SQLite` に作らせる。
fn now(conn: &Connection) -> Result<String, AppError> {
    Ok(
        conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get(0)
        })?,
    )
}

/// テスト用のインメモリ DB（マイグレーション適用済み）。
///
/// # Panics
///
/// DB を用意できない場合。テストの前提が崩れているので続行しない。
#[cfg(test)]
#[must_use]
pub fn test_conn() -> Connection {
    let mut conn = Connection::open_in_memory().expect("インメモリ DB を開ける");
    configure(&conn).expect("PRAGMA を設定できる");
    migrate::migrate(&mut conn).expect("マイグレーションを適用できる");
    conn
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_creates_file_and_reopens_with_data() {
        let dir = tempfile::tempdir().expect("一時フォルダを作れる");
        {
            let db = Db::open(dir.path()).expect("DB を開ける");
            let conn = db.conn.lock().expect("ロックできる");
            conn.execute("INSERT INTO settings (key, value) VALUES ('k', '1')", [])
                .expect("書き込める");
        }
        let db = Db::open(dir.path()).expect("DB を開き直せる");
        let conn = db.conn.lock().expect("ロックできる");
        let value: String = conn
            .query_row("SELECT value FROM settings WHERE key = 'k'", [], |r| {
                r.get(0)
            })
            .expect("前回のデータが残っている");
        assert_eq!(value, "1");
        let mode: String = conn
            .pragma_query_value(None, "journal_mode", |r| r.get(0))
            .expect("journal_mode を読める");
        assert_eq!(mode.to_ascii_lowercase(), "wal");
    }
}
