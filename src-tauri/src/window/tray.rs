//! タスクトレイ。左クリックでメイン、右クリックのメニューからメイン・小窓・設定・終了。

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle};

use super::overlay;
use crate::model::OverlayMode;

const MAIN_ID: &str = "main";
const OVERLAY_ID: &str = "overlay";
const SETTINGS_ID: &str = "settings";
const QUIT_ID: &str = "quit";

/// # Errors
///
/// トレイやメニューを作れない場合。
pub fn create(app: &App) -> tauri::Result<TrayIcon> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, MAIN_ID, "メインウィンドウを開く", true, None::<&str>)?,
            &MenuItem::with_id(app, OVERLAY_ID, "小窓を表示", true, None::<&str>)?,
            &MenuItem::with_id(app, SETTINGS_ID, "設定", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, QUIT_ID, "終了", true, None::<&str>)?,
        ],
    )?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Field Medic Manual")
        .menu(&menu)
        // 左クリックはメインを出す操作にし、メニューは右クリックだけで開く
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_menu(app, &event))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = overlay::show_main(tray.app_handle(), None);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)
}

fn handle_menu(app: &AppHandle, event: &MenuEvent) {
    let _ = match event.id.as_ref() {
        MAIN_ID => overlay::show_main(app, None),
        OVERLAY_ID => overlay::show(app, OverlayMode::View),
        SETTINGS_ID => overlay::show_main(app, Some("/settings")),
        QUIT_ID => {
            // exit で終わらせると window-state がウィンドウの位置を保存する
            app.exit(0);
            Ok(())
        }
        _ => Ok(()),
    };
}
