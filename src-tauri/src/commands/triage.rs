use tauri::State;

use crate::db::{Db, triage};
use crate::error::AppError;
use crate::model::{TriageDetail, TriageSummary, TriageUpsertInput};

/// # Errors
///
/// DB の読み取りに失敗した場合。
#[tauri::command]
pub async fn triage_list(db: State<'_, Db>) -> Result<Vec<TriageSummary>, AppError> {
    db.run(|conn, _| triage::list(conn)).await
}

/// # Errors
///
/// 見つからなければ `NotFound`。
#[tauri::command]
pub async fn triage_get(db: State<'_, Db>, id: String) -> Result<TriageDetail, AppError> {
    db.run(move |conn, _| triage::get(conn, &id)).await
}

/// フローを保存する（同じ id なら置き換え）。起動時の同期で使う。
///
/// # Errors
///
/// 入力が不正なら `InvalidInput`。
#[tauri::command]
pub async fn triage_upsert(db: State<'_, Db>, input: TriageUpsertInput) -> Result<(), AppError> {
    db.run(move |conn, _| triage::upsert(conn, &input)).await
}

/// # Errors
///
/// 見つからなければ `NotFound`。
#[tauri::command]
pub async fn triage_delete(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    db.run(move |conn, _| triage::delete(conn, &id)).await
}
