use serde_json::Value;
use tauri::State;

use crate::db::{Db, settings};
use crate::error::AppError;

/// 設定の値（任意の JSON）を返す。保存されていなければ `null`。
///
/// # Errors
///
/// キーが不正なら `InvalidInput`。
#[tauri::command]
pub async fn settings_get(db: State<'_, Db>, key: String) -> Result<Option<Value>, AppError> {
    db.run(move |conn, _| settings::get(conn, &key)).await
}

/// # Errors
///
/// キーが不正なら `InvalidInput`。
#[tauri::command]
pub async fn settings_set(db: State<'_, Db>, key: String, value: Value) -> Result<(), AppError> {
    db.run(move |conn, _| settings::set(conn, &key, &value))
        .await
}
