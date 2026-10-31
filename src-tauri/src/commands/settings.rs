use serde_json::Value;
use tauri::{Emitter, Manager, State, WebviewWindow};

use crate::db::{Db, settings};
use crate::error::AppError;
use crate::window::{hotkey, overlay, theme};

/// Rust → もう一方のウィンドウ。保存した設定のキーを知らせ、読み直させる（テーマや文字サイズをすぐ反映するため）
pub const SETTINGS_CHANGED_EVENT: &str = "settings-changed";

/// 小窓が書けるキー。小窓の画面（ビューアの表示・検索の絞り込み・クイック表の表示）が保存するものだけにする。
/// 常に最前面で開いている小窓から、×ボタンの動作（`window`）・使っている MOD・小窓の透明度を変えられないようにするため（最小権限）。
const OVERLAY_WRITABLE_KEYS: [&str; 3] = ["viewer", "search", "quickref"];

/// 画面から読み書きする設定のキー。`hotkeys` は `hotkey_list` / `hotkey_set` だけで扱うので含めない。
/// 画面で新しい設定を保存するようにしたら、ここにも足す。
const KNOWN_KEYS: [&str; 6] = ["viewer", "search", "quickref", "mods", "overlay", "window"];

/// 設定の値の大きさの上限（JSON のバイト数）。どの設定も数百バイトなので、桁違いに大きいものは不正な値とみなす
const MAX_VALUE_LEN: usize = 64 * 1024;

/// 設定の値（JSON オブジェクト）を返す。保存されていなければ `null`。
///
/// # Errors
///
/// キーが不正なら `InvalidInput`。
#[tauri::command]
pub async fn settings_get(db: State<'_, Db>, key: String) -> Result<Option<Value>, AppError> {
    check_known(&key)?;
    db.run(move |conn, _| settings::get(conn, &key)).await
}

/// 保存したら、もう一方のウィンドウ（メイン / 小窓）に知らせる。呼んだウィンドウには送らない
/// （続けて変えたときに、知らせを受けて読み直した古い値で、画面の新しい値を戻さないため）。
///
/// # Errors
///
/// キーか値が不正な場合と、呼んだウィンドウがそのキーを書けない場合は `InvalidInput`。
#[tauri::command]
pub async fn settings_set(
    window: WebviewWindow,
    db: State<'_, Db>,
    key: String,
    value: Value,
) -> Result<(), AppError> {
    check_writable(window.label(), &key)?;
    check_value(&value)?;
    let key = key.trim().to_owned();
    let saved_key = key.clone();
    db.run(move |conn, _| settings::set(conn, &saved_key, &value))
        .await?;
    if key == theme::VIEWER_KEY {
        theme::apply_main_background(window.app_handle()).await;
    }
    let other = if window.label() == overlay::MAIN {
        overlay::OVERLAY
    } else {
        overlay::MAIN
    };
    // 届かなくても、小窓は出すたびに読み直すので保存は成功にする
    let _ = window.emit_to(other, SETTINGS_CHANGED_EVENT, &key);
    Ok(())
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
    check_known(key)?;
    if window_label == overlay::OVERLAY && !OVERLAY_WRITABLE_KEYS.contains(&key) {
        return Err(AppError::InvalidInput(format!(
            "小窓からは設定 {key} を変えられません"
        )));
    }
    Ok(())
}

fn check_known(key: &str) -> Result<(), AppError> {
    if KNOWN_KEYS.contains(&key.trim()) {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!("知らない設定です: {key}")))
    }
}

/// 値の形の全体は読む側（画面）が検査し、不正なら既定値に戻す。ここでは DB に入れてよい最低限を確かめる。
fn check_value(value: &Value) -> Result<(), AppError> {
    if !value.is_object() {
        return Err(AppError::InvalidInput(
            "設定の値は JSON のオブジェクトにしてください".to_owned(),
        ));
    }
    if value.to_string().len() > MAX_VALUE_LEN {
        return Err(AppError::InvalidInput(format!(
            "設定の値は {MAX_VALUE_LEN} バイトまでです"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

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

    #[test]
    fn unknown_keys_are_rejected_from_any_window() {
        for label in [overlay::MAIN, overlay::OVERLAY] {
            for key in ["secret", "", "Viewer"] {
                assert!(matches!(
                    check_writable(label, key),
                    Err(AppError::InvalidInput(_))
                ));
            }
        }
        assert!(check_known(" viewer ").is_ok());
        assert!(matches!(
            check_known(hotkey::SETTINGS_KEY),
            Err(AppError::InvalidInput(_))
        ));
    }

    #[test]
    fn value_must_be_a_small_object() {
        assert!(check_value(&json!({ "closeToTray": true })).is_ok());
        for value in [
            json!(null),
            json!("text"),
            json!([1, 2]),
            json!({ "long": "a".repeat(MAX_VALUE_LEN) }),
        ] {
            assert!(matches!(
                check_value(&value),
                Err(AppError::InvalidInput(_))
            ));
        }
    }
}
