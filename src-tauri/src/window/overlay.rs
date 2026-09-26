//! 小窓の表示とメインウィンドウの呼び出し。
//!
//! 閲覧モードは `set_focusable(false)`（`WS_EX_NOACTIVATE`）にしてから表示する。設定の `focus: false` は
//! 最初の 1 回の表示にしか効かず（tao の実装）、2 回目からゲームのフォーカスを奪ってしまうため（2026-09-26 の先行検証）。

use tauri::{AppHandle, Emitter, Manager};

use crate::model::OverlayMode;

pub const MAIN: &str = "main";
pub const OVERLAY: &str = "overlay";
/// Rust → 小窓。呼び出しのモード（`OverlayMode`）を知らせる
pub const OVERLAY_MODE_EVENT: &str = "overlay-mode";
/// Rust → メイン。開く画面の URL（例: `/doc/…#…`）
pub const OPEN_HREF_EVENT: &str = "open-href";

/// ホットキーの「表示 / 非表示」。出ていれば隠し、出ていなければフォーカスせずに出す。
///
/// # Errors
///
/// ウィンドウの操作に失敗した場合。
pub fn toggle(app: &AppHandle) -> tauri::Result<()> {
    let Some(overlay) = app.get_webview_window(OVERLAY) else {
        return Ok(());
    };
    if overlay.is_visible()? {
        return overlay.hide();
    }
    show(app, OverlayMode::View)
}

/// 小窓を出す。閲覧はフォーカスせず、検索とトリアージはキーで操作するのでフォーカスする。
///
/// # Errors
///
/// ウィンドウの操作に失敗した場合。
pub fn show(app: &AppHandle, mode: OverlayMode) -> tauri::Result<()> {
    let Some(overlay) = app.get_webview_window(OVERLAY) else {
        return Ok(());
    };
    match mode {
        OverlayMode::View => {
            overlay.set_focusable(false)?;
            overlay.show()?;
        }
        OverlayMode::Search | OverlayMode::Triage => {
            overlay.set_focusable(true)?;
            overlay.show()?;
            overlay.set_focus()?;
        }
    }
    app.emit_to(OVERLAY, OVERLAY_MODE_EVENT, mode)
}

/// 閲覧モードの小窓で入力欄を押したとき。キー入力は前面のアプリに届くので、打つときだけフォーカスを移す。
///
/// # Errors
///
/// ウィンドウの操作に失敗した場合。
pub fn activate(app: &AppHandle) -> tauri::Result<()> {
    let Some(overlay) = app.get_webview_window(OVERLAY) else {
        return Ok(());
    };
    overlay.set_focusable(true)?;
    overlay.set_focus()
}

/// メインウィンドウを前面に出す。`href` があれば、その画面へ移らせる。
///
/// # Errors
///
/// ウィンドウの操作に失敗した場合。
pub fn show_main(app: &AppHandle, href: Option<&str>) -> tauri::Result<()> {
    let Some(main) = app.get_webview_window(MAIN) else {
        return Ok(());
    };
    main.unminimize()?;
    main.show()?;
    main.set_focus()?;
    match href {
        Some(href) => app.emit_to(MAIN, OPEN_HREF_EVENT, href),
        None => Ok(()),
    }
}
