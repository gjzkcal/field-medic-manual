use tauri::State;

use crate::db::{Db, dict};
use crate::error::AppError;
use crate::model::{SynonymGroup, SynonymGroupInput, TagCount};

/// # Errors
///
/// DB の読み取りに失敗した場合。
#[tauri::command]
pub async fn tag_list(db: State<'_, Db>) -> Result<Vec<TagCount>, AppError> {
    db.run(|conn, _| dict::tag_list(conn)).await
}

/// # Errors
///
/// DB の読み取りに失敗した場合。
#[tauri::command]
pub async fn synonym_list(db: State<'_, Db>) -> Result<Vec<SynonymGroup>, AppError> {
    db.run(|conn, _| dict::synonym_list(conn)).await
}

/// # Errors
///
/// 語が 2 つ未満なら `InvalidInput`、`id` のグループがなければ `NotFound`。
#[tauri::command]
pub async fn synonym_save(
    db: State<'_, Db>,
    group: SynonymGroupInput,
) -> Result<SynonymGroup, AppError> {
    db.run(move |conn, _| dict::synonym_save(conn, &group))
        .await
}

/// # Errors
///
/// 見つからなければ `NotFound`。
#[tauri::command]
pub async fn synonym_delete(db: State<'_, Db>, id: i64) -> Result<(), AppError> {
    db.run(move |conn, _| dict::synonym_delete(conn, id)).await
}
