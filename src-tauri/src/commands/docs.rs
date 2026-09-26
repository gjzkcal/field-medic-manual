use tauri::State;

use crate::db::{Db, docs};
use crate::error::AppError;
use crate::model::{DocDetail, DocOutline, DocSummary, DocUpsertInput};

/// ドキュメントを保存し、id を返す（同じ `sourcePath` なら置き換え）。
///
/// # Errors
///
/// 入力が不正なら `InvalidInput`。
#[tauri::command]
pub async fn doc_upsert(db: State<'_, Db>, input: DocUpsertInput) -> Result<String, AppError> {
    db.run(move |conn, _| docs::upsert(conn, &input)).await
}

/// # Errors
///
/// DB の読み取りに失敗した場合。
#[tauri::command]
pub async fn doc_list(db: State<'_, Db>) -> Result<Vec<DocSummary>, AppError> {
    db.run(|conn, _| docs::list(conn)).await
}

/// # Errors
///
/// 見つからなければ `NotFound`。
#[tauri::command]
pub async fn doc_get(db: State<'_, Db>, id: String) -> Result<DocDetail, AppError> {
    db.run(move |conn, _| docs::get(conn, &id)).await
}

/// # Errors
///
/// 見つからなければ `NotFound`。
#[tauri::command]
pub async fn doc_delete(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    db.run(move |conn, _| docs::delete(conn, &id)).await
}

/// 全ドキュメントの見出し（ビューアの左のツリー用）。
///
/// # Errors
///
/// DB の読み取りに失敗した場合。
#[tauri::command]
pub async fn doc_outline(db: State<'_, Db>) -> Result<Vec<DocOutline>, AppError> {
    db.run(|conn, _| docs::outline(conn)).await
}
