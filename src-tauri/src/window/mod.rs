//! 小窓・ホットキー・トレイ・閉じるボタン・背景色の扱い。

pub mod hotkey;
pub mod overlay;
pub mod theme;
pub mod tray;

use serde_json::Value;
use tauri::{AppHandle, Manager, Window, WindowEvent};

use crate::db::{Db, casualties, settings};

/// ×ボタンの動作などの設定（キー `window`）。値の形は TS の window-settings.ts と合わせる。
pub const SETTINGS_KEY: &str = "window";

/// ×でトレイに格納するか。既定は格納する（ホットキーを効かせ続けるため）。
#[must_use]
pub fn close_to_tray(value: Option<&Value>) -> bool {
    value
        .and_then(|v| v.get("closeToTray"))
        .and_then(Value::as_bool)
        .unwrap_or(true)
}

/// ウィンドウを閉じる操作を受ける。小窓は閉じずに隠し（閉じると次のホットキーで出せないため）、
/// メインは設定に従ってトレイに格納するか、アプリを終了する。
/// OS のテーマが変わったら、メインの背景色を合わせ直す（テーマが「システム」のとき）。
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::ThemeChanged(_) = event {
        if window.label() == overlay::MAIN {
            let app = window.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                theme::apply_main_background(&app).await;
            });
        }
        return;
    }
    // メモを打つと小窓は focusable のままになり、以後ボタンを押すたびにゲームのフォーカスを奪う。
    // ゲームへ戻ったら閲覧モードと同じ状態に戻す
    if matches!(event, WindowEvent::Focused(false)) && window.label() == overlay::OVERLAY {
        let _ = window.set_focusable(false);
        return;
    }
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    match window.label() {
        overlay::OVERLAY => {
            api.prevent_close();
            let _ = window.hide();
        }
        overlay::MAIN => {
            api.prevent_close();
            let app = window.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                close_main(&app).await;
            });
        }
        _ => {}
    }
}

async fn close_main(app: &AppHandle) {
    let saved = app
        .state::<Db>()
        .run(|conn, _| settings::get(conn, SETTINGS_KEY))
        .await;
    // 設定を読めなくても、ホットキーを失わない側（格納）に倒す
    if close_to_tray(saved.ok().flatten().as_ref()) {
        if let Some(main) = app.get_webview_window(overlay::MAIN) {
            let _ = main.hide();
        }
    } else {
        quit(app).await;
    }
}

/// アプリを完全に終了する。負傷者の記録はこの時に消す（トレイにしまうだけなら残す）。
/// 消すのを終了の操作に限るのは、更新の再起動やクラッシュでは記録を失わないようにするため。
/// exit で終わらせると window-state がウィンドウの位置を保存する。
pub async fn quit(app: &AppHandle) {
    // 消せなくても終了を止めない
    let _ = app
        .state::<Db>()
        .run(|conn, _| casualties::clear_all(conn))
        .await;
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn close_to_tray_defaults_to_true() {
        assert!(close_to_tray(None));
        assert!(close_to_tray(Some(&json!({}))));
        assert!(close_to_tray(Some(&json!({ "closeToTray": "no" }))));
        assert!(!close_to_tray(Some(&json!({ "closeToTray": false }))));
    }
}
