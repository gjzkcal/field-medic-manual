use tauri::AppHandle;

use crate::error::AppError;

/// アプリのバージョン（`tauri.conf.json` の `version`）を返す。
///
/// # Errors
///
/// 現状は失敗しない。IPC の規約で全コマンドの戻り値を `Result<T, AppError>` に揃えている。
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri のコマンド引数は AppHandle を値で受け取る（&AppHandle は CommandArg を実装していない）"
)]
pub fn app_version(app: AppHandle) -> Result<String, AppError> {
    Ok(app.package_info().version.to_string())
}
