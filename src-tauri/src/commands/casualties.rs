use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{Emitter, State, WebviewWindow};

use crate::db::{Db, casualties};
use crate::error::AppError;
use crate::model::{Casualty, CasualtyOp};
use crate::window::overlay;

/// Rust → もう一方のウィンドウ。片方で記録を足したら、もう片方にすぐ出す
pub const CASUALTIES_CHANGED_EVENT: &str = "casualties-changed";

/// # Errors
///
/// DB の読み取りに失敗した場合。
#[tauri::command]
pub async fn casualty_list(db: State<'_, Db>) -> Result<Vec<Casualty>, AppError> {
    db.run(|conn, _| casualties::list(conn)).await
}

/// 操作を 1 件適用し、全員の記録を返す。時刻は押した窓によらず同じ時計で付ける。
///
/// # Errors
///
/// 中身が不正か上限を超えていれば `InvalidInput`、対象がなければ `NotFound`。
#[tauri::command]
pub async fn casualty_apply(
    window: WebviewWindow,
    db: State<'_, Db>,
    op: CasualtyOp,
) -> Result<Vec<Casualty>, AppError> {
    let now_ms = unix_ms()?;
    let list = db
        .run(move |conn, _| casualties::apply(conn, &op, now_ms))
        .await?;
    // 届かなくても、記録は保存できているので成功にする（小窓は出すたびに読み直す）
    let _ = window.emit_to(
        overlay::other_window(window.label()),
        CASUALTIES_CHANGED_EVENT,
        (),
    );
    Ok(list)
}

fn unix_ms() -> Result<i64, AppError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .ok_or_else(|| AppError::Internal("時計を読めません".to_owned()))
}
