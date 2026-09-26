use tauri::State;

use crate::db::{Db, prefs};
use crate::error::AppError;
use crate::model::{PrefItem, PrefTarget};

/// お気に入りに入れたら true、外したら false。
///
/// # Errors
///
/// 対象が不正なら `InvalidInput`。
#[tauri::command]
pub async fn fav_toggle(db: State<'_, Db>, target: PrefTarget) -> Result<bool, AppError> {
    db.run(move |conn, _| prefs::fav_toggle(conn, &target))
        .await
}

/// # Errors
///
/// DB の読み取りに失敗した場合。
#[tauri::command]
pub async fn fav_list(db: State<'_, Db>) -> Result<Vec<PrefItem>, AppError> {
    db.run(|conn, _| prefs::fav_list(conn)).await
}

/// # Errors
///
/// 対象が不正なら `InvalidInput`。
#[tauri::command]
pub async fn history_push(db: State<'_, Db>, target: PrefTarget) -> Result<(), AppError> {
    db.run(move |conn, _| prefs::history_push(conn, &target))
        .await
}

/// # Errors
///
/// DB の読み取りに失敗した場合。
#[tauri::command]
pub async fn history_list(db: State<'_, Db>, limit: u32) -> Result<Vec<PrefItem>, AppError> {
    let limit = usize::try_from(limit).unwrap_or(prefs::HISTORY_LIMIT);
    db.run(move |conn, _| prefs::history_list(conn, limit))
        .await
}
