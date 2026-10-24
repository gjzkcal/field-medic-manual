use serde_json::Value;
use tauri::{State, WebviewWindow};

use crate::db::{Db, settings};
use crate::error::AppError;
use crate::window::{hotkey, overlay};

/// 小窓が書けるキー。小窓の画面（ビューアの表示・検索の絞り込み・クイック表の表示）が保存するものだけにする。
/// 常に最前面で開いている小窓から、×ボタンの動作（`window`）・使っている MOD・小窓の透明度を変えられないようにするため（最小権限）。
const OVERLAY_WRITABLE_KEYS: [&str; 3] = ["viewer", "search", "quickref"];

/// 設定の値（任意の JSON）を返す。保存されていなければ `null`。
///
/// # Errors
///
/// キーが不正なら `InvalidInput`。
#[tauri::command]
pub async fn settings_get(db: State<'_, Db>, key: String) -> Result<Option<Value>, AppError> {
    db.run(move |conn, _| settings::get(conn, &key)).await
}

/// # Errors
///
/// キーが不正な場合と、呼んだウィンドウがそのキーを書けない場合は `InvalidInput`。
#[tauri::command]
pub async fn settings_set(
    window: WebviewWindow,
    db: State<'_, Db>,
    key: String,
    value: Value,
) -> Result<(), AppError> {
    check_writable(window.label(), &key)?;
    db.run(move |conn, _| settings::set(conn, &key, &value))
        .await
}

fn check_writable(window_label: &str, key: &str) -> Result<(), AppError> {
    // 保存のときと同じく前後の空白を除いてから比べる（除かないと " hotkeys" で素通りする）
    let key = key.trim();
    // ホットキーは hotkey_set だけが書く。そこで組み合わせを検査して登録し直すので、値だけを書き換えさせない
    if key == hotkey::SETTINGS_KEY {
        return Err(AppError::InvalidInput(format!(
            "設定 {key} はホットキーの設定から変えてください"
        )));
    }
    if window_label == overlay::OVERLAY && !OVERLAY_WRITABLE_KEYS.contains(&key) {
        return Err(AppError::InvalidInput(format!(
            "小窓からは設定 {key} を変えられません"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hotkeys_cannot_be_written_from_any_window() {
        for label in [overlay::MAIN, overlay::OVERLAY] {
            for key in [hotkey::SETTINGS_KEY, " hotkeys "] {
                assert!(matches!(
                    check_writable(label, key),
                    Err(AppError::InvalidInput(_))
                ));
            }
        }
    }

    #[test]
    fn overlay_writes_only_its_own_keys() {
        for key in OVERLAY_WRITABLE_KEYS {
            assert!(check_writable(overlay::OVERLAY, key).is_ok());
        }
        for key in ["window", "mods", "overlay"] {
            assert!(matches!(
                check_writable(overlay::OVERLAY, key),
                Err(AppError::InvalidInput(_))
            ));
        }
    }

    #[test]
    fn main_writes_other_keys() {
        for key in ["viewer", "window", "mods", "overlay"] {
            assert!(check_writable(overlay::MAIN, key).is_ok());
        }
    }
}
