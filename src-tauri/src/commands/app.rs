use tauri::{AppHandle, State};

use crate::db::Db;
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

/// お気に入り・履歴・設定を保存しているフォルダを、OS のファイルの画面で開く。
///
/// 開く場所を引数で受けない。画面からパスを渡せると、任意のファイルやプログラムを開く口になるため
/// （JS に opener のパスの権限を渡していないのも同じ理由）。
///
/// # Errors
///
/// フォルダが無い、または OS が開けなかった場合。
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri のコマンド引数は State を値で受け取る（&State は CommandArg を実装していない）"
)]
pub fn data_folder_open(db: State<'_, Db>) -> Result<(), AppError> {
    tauri_plugin_opener::open_path(db.data_dir(), None::<&str>)
        .map_err(|e| AppError::Internal(format!("保存場所を開けませんでした: {e}")))
}
