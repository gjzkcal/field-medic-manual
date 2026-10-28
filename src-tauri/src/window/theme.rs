//! メインウィンドウの背景色をテーマ（ライト / ダーク / システム）に合わせる。
//!
//! メインは画面を描き終えてから出すが、出した直後の 1 フレームと、起動から 5 秒の保険で出たときは背景色が見える。
//! ライトの人に黒（`tauri.conf.json` の値）を見せないよう、保存したテーマ（システムなら OS のテーマ）の色にする。
//! `set_theme` は使わない。WebView2 の `prefers-color-scheme` まで変わり、画面の「システム」の判定が OS とずれるため。

use serde_json::Value;
use tauri::window::Color;
use tauri::{AppHandle, Manager, Theme};

use crate::db::{Db, settings};
use crate::window::overlay;

/// テーマを持つ設定のキー。値の形は TS の viewer-settings.ts と合わせる。
pub const VIEWER_KEY: &str = "viewer";

/// `src/index.css` の `:root` と `.dark` の `--background` を sRGB に直した値（src/test/background.test.ts で突き合わせる）
const LIGHT_BACKGROUND: Color = Color(0xf8, 0xf7, 0xf3, 0xff);
const DARK_BACKGROUND: Color = Color(0x06, 0x06, 0x05, 0xff);

/// 保存した表示設定と OS のテーマから、メインの背景色を決める。
#[must_use]
pub fn main_background(viewer: Option<&Value>, os: Theme) -> Color {
    let dark = match viewer.and_then(|v| v.get("theme")).and_then(Value::as_str) {
        Some("light") => false,
        Some("dark") => true,
        // システム・保存なし・知らない値は OS に合わせる（TS の parseViewerSettings と同じく既定はシステム）
        _ => os == Theme::Dark,
    };
    if dark {
        DARK_BACKGROUND
    } else {
        LIGHT_BACKGROUND
    }
}

/// 保存したテーマを読んで、メインの背景色を変える。起動時・テーマを変えたとき・OS のテーマが変わったときに呼ぶ。
pub async fn apply_main_background(app: &AppHandle) {
    let Some(main) = app.get_webview_window(overlay::MAIN) else {
        return;
    };
    let saved = app
        .state::<Db>()
        .run(|conn, _| settings::get(conn, VIEWER_KEY))
        .await;
    // OS のテーマを読めなければ、テーマの設定ができる前と同じダークにする
    let os = main.theme().unwrap_or(Theme::Dark);
    // 失敗しても、画面を描いた後は CSS の背景が見えるので止めない
    let _ = main.set_background_color(Some(main_background(saved.ok().flatten().as_ref(), os)));
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn saved_light_or_dark_ignores_os() {
        for os in [Theme::Light, Theme::Dark] {
            assert_eq!(
                main_background(Some(&json!({ "theme": "light" })), os),
                LIGHT_BACKGROUND
            );
            assert_eq!(
                main_background(Some(&json!({ "theme": "dark" })), os),
                DARK_BACKGROUND
            );
        }
    }

    #[test]
    fn system_unsaved_or_unknown_follows_os() {
        let values = [
            Some(json!({ "theme": "system" })),
            // テーマの設定ができる前に保存した値
            Some(json!({ "fontSize": "m", "lineHeight": "relaxed" })),
            Some(json!({ "theme": "sepia" })),
            Some(json!("dark")),
            None,
        ];
        for value in &values {
            assert_eq!(
                main_background(value.as_ref(), Theme::Light),
                LIGHT_BACKGROUND
            );
            assert_eq!(
                main_background(value.as_ref(), Theme::Dark),
                DARK_BACKGROUND
            );
        }
    }
}
