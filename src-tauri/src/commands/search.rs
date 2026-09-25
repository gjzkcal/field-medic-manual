use tauri::State;

use crate::db::{Db, search};
use crate::error::AppError;
use crate::model::{SearchFilter, SearchHit};

/// セクションを検索する。`limit` は省略時 20、最大 100。
///
/// # Errors
///
/// DB の読み取りに失敗した場合。
#[tauri::command]
pub async fn search_query(
    db: State<'_, Db>,
    q: String,
    limit: Option<u32>,
    filter: Option<SearchFilter>,
) -> Result<Vec<SearchHit>, AppError> {
    let filter = filter.unwrap_or_default();
    db.run(move |conn, _| search::search(conn, &q, limit, &filter))
        .await
}
