use tauri::State;

use crate::db::{Db, quickref};
use crate::error::AppError;
use crate::model::{QuickrefReplaceInput, QuickrefTable};

/// # Errors
///
/// DB の読み取りに失敗した場合。
#[tauri::command]
pub async fn quickref_list(db: State<'_, Db>) -> Result<QuickrefTable, AppError> {
    db.run(|conn, _| quickref::list(conn)).await
}

/// 全行を置き換える。起動時の同期で、同梱ファイルが変わったときに使う。
///
/// # Errors
///
/// 入力が不正なら `InvalidInput`（前の内容は残る）。
#[tauri::command]
pub async fn quickref_replace_all(
    db: State<'_, Db>,
    input: QuickrefReplaceInput,
) -> Result<(), AppError> {
    db.run(move |conn, _| quickref::replace_all(conn, &input))
        .await
}
