//! 小窓の表示とメインウィンドウの呼び出し。
//!
//! 閲覧モードは `set_focusable(false)`（`WS_EX_NOACTIVATE`）にしてから表示する。設定の `focus: false` は
//! 最初の 1 回の表示にしか効かず（tao の実装）、2 回目からゲームのフォーカスを奪ってしまうため（2026-09-26 の先行検証）。

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WebviewWindow, Window};

use crate::model::OverlayMode;

pub const MAIN: &str = "main";
pub const OVERLAY: &str = "overlay";
/// Rust → 小窓。呼び出しのモード（`OverlayMode`）を知らせる
pub const OVERLAY_MODE_EVENT: &str = "overlay-mode";
/// Rust → メイン。開く画面の URL（例: `/doc/…#…`）
pub const OPEN_HREF_EVENT: &str = "open-href";
/// Rust → 小窓。キー入力が小窓に届くか（bool）。届かない間、小窓はキーの案内を出さない
pub const OVERLAY_KEYS_EVENT: &str = "overlay-keys";

/// メインを一度でも出したか。メインは非表示で起動し、最初の画面を描き終えてから出す。
#[derive(Default)]
pub struct MainRevealed(AtomicBool);

/// 小窓を閲覧モードで出しているか。フォーカスを失ったときに元へ戻すかどうかの判断に使う。
#[derive(Default)]
pub struct ViewMode(AtomicBool);

/// 小窓がフォーカスを取れる状態か（最後に `set_focusable` へ渡した値）。
/// フォーカスを取れない状態でも、中を押すと「フォーカスを得た」というイベントは届く（WebView が知らせる）。
/// 前面は別のアプリのままでキーは届かないので、イベントだけでは「キーが届く」と判断できない。
#[derive(Default)]
pub struct Focusable(AtomicBool);

/// キー入力が小窓に届くか。フォーカスを得たというイベントは、フォーカスを取れる状態のときだけ信じる。
#[must_use]
pub const fn keys_reach(focused: bool, focusable: bool) -> bool {
    focused && focusable
}

fn set_focusable(app: &AppHandle, overlay: &WebviewWindow, focusable: bool) -> tauri::Result<()> {
    overlay.set_focusable(focusable)?;
    if let Some(state) = app.try_state::<Focusable>() {
        state.0.store(focusable, Ordering::SeqCst);
    }
    Ok(())
}

fn emit_keys(app: &AppHandle, reach: bool) -> tauri::Result<()> {
    app.emit_to(OVERLAY, OVERLAY_KEYS_EVENT, reach)
}

/// フォーカスを移した後、ウィンドウの状態が落ち着くのを待つ時間。
const FOCUS_SETTLE: Duration = Duration::from_millis(200);

/// フォーカスを移した後に、キーが届くかを知らせる。
///
/// `set_focus` は、前面にできなかったとき（Windows が前面の切り替えを拒んだとき）もエラーを返さない。
/// 成功したと決めつけて知らせると、キーはゲームに届くのに小窓がキーの案内を出してしまうので、
/// ウィンドウが実際にフォーカスを得たか（`is_focused`）を確かめて知らせる。
/// 状態の反映が遅れることがあるので、少し待ってもう一度確かめる。
fn emit_keys_after_focus(app: &AppHandle, overlay: &WebviewWindow) -> tauri::Result<()> {
    emit_keys(app, overlay.is_focused()?)?;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FOCUS_SETTLE).await;
        if let Some(overlay) = app.get_webview_window(OVERLAY)
            && let Ok(focused) = overlay.is_focused()
        {
            let _ = emit_keys(&app, focused);
        }
    });
    Ok(())
}

/// 起動時にメインを出す。画面の準備ができたときと、JS が動かないときの保険の両方から呼ばれるので、2 回目以降は何もしない。
///
/// # Errors
///
/// ウィンドウの操作に失敗した場合。
pub fn reveal_main(app: &AppHandle) -> tauri::Result<()> {
    let already = app
        .try_state::<MainRevealed>()
        .is_some_and(|revealed| revealed.0.swap(true, Ordering::SeqCst));
    if already {
        return Ok(());
    }
    show_main(app, None)
}

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
    if let Some(view_mode) = app.try_state::<ViewMode>() {
        view_mode
            .0
            .store(matches!(mode, OverlayMode::View), Ordering::SeqCst);
    }
    match mode {
        OverlayMode::View => {
            set_focusable(app, &overlay, false)?;
            overlay.show()?;
            emit_keys(app, false)?;
        }
        OverlayMode::Search | OverlayMode::Triage => {
            set_focusable(app, &overlay, true)?;
            overlay.show()?;
            overlay.set_focus()?;
            emit_keys_after_focus(app, &overlay)?;
        }
    }
    app.emit_to(OVERLAY, OVERLAY_MODE_EVENT, mode)
}

/// メインなら小窓、小窓ならメインのラベル。片方の変更をもう片方に知らせるときに使う。
#[must_use]
pub fn other_window(label: &str) -> &'static str {
    if label == MAIN { OVERLAY } else { MAIN }
}

/// 閲覧モードの小窓で、入力欄か「キーで操作」を押したとき。キー入力は前面のアプリに届くので、
/// 利用者が求めたときだけフォーカスを移す。
///
/// # Errors
///
/// ウィンドウの操作に失敗した場合。
pub fn activate(app: &AppHandle) -> tauri::Result<()> {
    let Some(overlay) = app.get_webview_window(OVERLAY) else {
        return Ok(());
    };
    set_focusable(app, &overlay, true)?;
    overlay.set_focus()?;
    // 押した時点で「フォーカスを得た」のイベントは済んでいて、もう一度届くとは限らないので、ここで知らせる
    emit_keys_after_focus(app, &overlay)
}

/// 小窓のフォーカスが変わったとき。キー入力が届くかを小窓に知らせる。
///
/// 閲覧モードの小窓がフォーカスを失ったら、フォーカスできない状態に戻す。
/// メモを打つと focusable のままになり、以後ボタンを押すたびにゲームのフォーカスを奪うため。
/// 検索とトリアージは戻さない。キーで操作するので、小窓を押してフォーカスを取り戻せる必要がある。
pub fn on_focus_changed(window: &Window, focused: bool) {
    let app = window.app_handle();
    if !focused {
        let viewing = app
            .try_state::<ViewMode>()
            .is_some_and(|view_mode| view_mode.0.load(Ordering::SeqCst));
        if viewing && let Some(overlay) = app.get_webview_window(OVERLAY) {
            let _ = set_focusable(app, &overlay, false);
        }
    }
    let focusable = app
        .try_state::<Focusable>()
        .is_some_and(|state| state.0.load(Ordering::SeqCst));
    let _ = emit_keys(app, keys_reach(focused, focusable));
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
    // 起動を待つ間にトレイや 2 つ目の起動で出した後、起動時の表示がもう一度前面に出さないように
    if let Some(revealed) = app.try_state::<MainRevealed>() {
        revealed.0.store(true, Ordering::SeqCst);
    }
    main.unminimize()?;
    main.show()?;
    main.set_focus()?;
    match href {
        Some(href) => app.emit_to(MAIN, OPEN_HREF_EVENT, href),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_reach_only_when_focused_and_focusable() {
        assert!(keys_reach(true, true));
        // 閲覧モードの小窓を押したとき。イベントは届くが、前面は別のアプリのまま
        assert!(!keys_reach(true, false));
        assert!(!keys_reach(false, true));
        assert!(!keys_reach(false, false));
    }
}
