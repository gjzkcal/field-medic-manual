//! 保存先と読み込むファイルを選ぶ、OS のダイアログ。
//!
//! Rust の側で出す。画面（WebView）にダイアログやファイルの読み書きの権限を渡すと、
//! 画面で動くスクリプトから PC の中のファイルに届く口になるため。

use std::path::PathBuf;

use tauri::WebviewWindow;

use crate::error::AppError;

#[cfg(windows)]
fn dialog(window: &WebviewWindow) -> rfd::AsyncFileDialog {
    rfd::AsyncFileDialog::new()
        // 親を付けないと、ダイアログがメインのウィンドウの後ろに回ることがある
        .set_parent(window)
        .add_filter("バックアップ（JSON）", &["json"])
}

/// 書き出す先を選んでもらう。取り消したら None。
///
/// # Errors
///
/// この OS で使えない場合は `InvalidInput`。
#[cfg(windows)]
pub async fn pick_save(
    window: &WebviewWindow,
    default_name: &str,
) -> Result<Option<PathBuf>, AppError> {
    let picked = dialog(window)
        .set_title("バックアップを書き出す")
        .set_file_name(default_name)
        .save_file()
        .await;
    Ok(picked.map(|file| file.path().to_path_buf()))
}

/// 復元するファイルを選んでもらう。取り消したら None。
///
/// # Errors
///
/// この OS で使えない場合は `InvalidInput`。
#[cfg(windows)]
pub async fn pick_open(window: &WebviewWindow) -> Result<Option<PathBuf>, AppError> {
    let picked = dialog(window)
        .set_title("復元するバックアップを選ぶ")
        .pick_file()
        .await;
    Ok(picked.map(|file| file.path().to_path_buf()))
}

#[cfg(not(windows))]
fn unsupported() -> AppError {
    AppError::InvalidInput("この OS では、ファイルを選ぶ操作を使えません".to_owned())
}

/// 書き出す先を選んでもらう。
///
/// # Errors
///
/// Windows 以外では常に `InvalidInput`（ダイアログの依存を Windows だけに入れているため）。
#[cfg(not(windows))]
#[expect(clippy::unused_async, reason = "Windows の版と呼び方をそろえる")]
pub async fn pick_save(
    _window: &WebviewWindow,
    _default_name: &str,
) -> Result<Option<PathBuf>, AppError> {
    Err(unsupported())
}

/// 復元するファイルを選んでもらう。
///
/// # Errors
///
/// Windows 以外では常に `InvalidInput`。
#[cfg(not(windows))]
#[expect(clippy::unused_async, reason = "Windows の版と呼び方をそろえる")]
pub async fn pick_open(_window: &WebviewWindow) -> Result<Option<PathBuf>, AppError> {
    Err(unsupported())
}
