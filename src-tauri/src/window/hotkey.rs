//! グローバルホットキー。WebView の読み込みを待たずに効くよう、起動時に Rust が DB の設定（キー `hotkeys`）から登録する。

use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Mutex;

use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut};

use crate::db::{Db, settings};
use crate::error::AppError;
use crate::model::{HotkeyAction, HotkeyBinding, OverlayMode};

pub const SETTINGS_KEY: &str = "hotkeys";
const ACTIONS: [HotkeyAction; 3] = [
    HotkeyAction::Toggle,
    HotkeyAction::Search,
    HotkeyAction::Triage,
];

#[must_use]
pub const fn default_accelerator(action: HotkeyAction) -> &'static str {
    match action {
        HotkeyAction::Toggle => "Ctrl+Shift+M",
        HotkeyAction::Search => "Ctrl+Shift+F",
        HotkeyAction::Triage => "Ctrl+Shift+T",
    }
}

const fn setting_name(action: HotkeyAction) -> &'static str {
    match action {
        HotkeyAction::Toggle => "toggle",
        HotkeyAction::Search => "search",
        HotkeyAction::Triage => "triage",
    }
}

/// 組み合わせを検査し、保存と表示に使う形（`Ctrl+Alt+Shift+Super+M`）にそろえる。
///
/// # Errors
///
/// 解釈できない、または Ctrl / Alt / Win のどれも含まない場合は `InvalidInput`。
/// 修飾キーなしや Shift だけの組み合わせは、ゲームの操作や文字入力のキーを奪ってしまうため受け付けない。
pub fn normalize(accelerator: &str) -> Result<(String, Shortcut), AppError> {
    let shortcut = Shortcut::from_str(accelerator.trim()).map_err(|e| {
        AppError::InvalidInput(format!(
            "キーの組み合わせを解釈できません（{accelerator}）: {e}"
        ))
    })?;
    if !shortcut
        .mods
        .intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER)
    {
        return Err(AppError::InvalidInput(
            "Ctrl・Alt・Win のどれかを含む組み合わせにしてください".to_owned(),
        ));
    }
    let mut parts = Vec::new();
    for (flag, name) in [
        (Modifiers::CONTROL, "Ctrl"),
        (Modifiers::ALT, "Alt"),
        (Modifiers::SHIFT, "Shift"),
        (Modifiers::SUPER, "Super"),
    ] {
        if shortcut.mods.contains(flag) {
            parts.push(name.to_owned());
        }
    }
    let code = shortcut.key.to_string();
    let key = code
        .strip_prefix("Key")
        .or_else(|| code.strip_prefix("Digit"))
        .unwrap_or(&code);
    parts.push(key.to_owned());
    Ok((parts.join("+"), shortcut))
}

/// 保存された設定から、動作ごとのキーを読む。項目ごとに検査し、不正な項目だけ既定値に戻す。
#[must_use]
pub fn parse_config(value: Option<&Value>) -> HashMap<HotkeyAction, String> {
    let record = value.and_then(Value::as_object);
    ACTIONS
        .iter()
        .map(|&action| {
            let saved = record
                .and_then(|r| r.get(setting_name(action)))
                .and_then(Value::as_str)
                .and_then(|s| normalize(s).ok())
                .map(|(accelerator, _)| accelerator);
            (
                action,
                saved.unwrap_or_else(|| default_accelerator(action).to_owned()),
            )
        })
        .collect()
}

fn to_setting(config: &HashMap<HotkeyAction, String>) -> Value {
    let mut map = Map::new();
    for action in ACTIONS {
        if let Some(accelerator) = config.get(&action) {
            map.insert(
                setting_name(action).to_owned(),
                Value::String(accelerator.clone()),
            );
        }
    }
    Value::Object(map)
}

struct Binding {
    accelerator: String,
    /// 登録できたキー。失敗したときは None
    shortcut: Option<Shortcut>,
    error: Option<String>,
}

/// 今のキーと登録の成否。設定画面に失敗を出すため、起動時の失敗も覚えておく。
#[derive(Default)]
pub struct HotkeyState(Mutex<HashMap<HotkeyAction, Binding>>);

/// 状態のロック。登録（メインスレッドの完了を待つ）の間は持たないこと。
/// ホットキーの受け口はメインスレッドでこのロックを取るので、持ったまま待つとデッドロックするため。
fn lock(
    app: &AppHandle,
) -> Result<std::sync::MutexGuard<'_, HashMap<HotkeyAction, Binding>>, AppError> {
    app.state::<HotkeyState>()
        .inner()
        .0
        .lock()
        .map_err(|_| AppError::Internal("ホットキーの状態が壊れています".to_owned()))
}

fn message(error: AppError) -> String {
    match error {
        AppError::InvalidInput(m) => m,
        other => other.to_string(),
    }
}

fn register(app: &AppHandle, accelerator: &str) -> Binding {
    let result = normalize(accelerator).and_then(|(accelerator, shortcut)| {
        match app.global_shortcut().register(shortcut) {
            Ok(()) => Ok((accelerator, shortcut)),
            Err(e) => Err(AppError::InvalidInput(format!(
                "{accelerator} を登録できませんでした。ほかのアプリが使っている可能性があります（{e}）"
            ))),
        }
    });
    match result {
        Ok((accelerator, shortcut)) => Binding {
            accelerator,
            shortcut: Some(shortcut),
            error: None,
        },
        Err(e) => Binding {
            accelerator: accelerator.to_owned(),
            shortcut: None,
            error: Some(message(e)),
        },
    }
}

/// 起動時に保存されたキーを登録する。失敗しても起動は続け、失敗は設定画面に出す。
///
/// # Errors
///
/// 設定を読めない場合（その場合も既定のキーで登録する）。
pub async fn register_saved(app: &AppHandle) -> Result<(), AppError> {
    let saved = app
        .state::<Db>()
        .run(|conn, _| settings::get(conn, SETTINGS_KEY))
        .await;
    let config = parse_config(saved.as_ref().ok().and_then(Option::as_ref));
    for action in ACTIONS {
        let accelerator = config
            .get(&action)
            .map_or(default_accelerator(action), String::as_str);
        let binding = register(app, accelerator);
        lock(app)?.insert(action, binding);
    }
    saved.map(|_| ())
}

/// 押されたキーに当たる動作。
#[must_use]
pub fn action_of(app: &AppHandle, shortcut: &Shortcut) -> Option<HotkeyAction> {
    let bindings = lock(app).ok()?;
    bindings
        .iter()
        .find(|(_, b)| b.shortcut.is_some_and(|s| s.id() == shortcut.id()))
        .map(|(&action, _)| action)
}

#[must_use]
pub const fn overlay_mode(action: HotkeyAction) -> OverlayMode {
    match action {
        HotkeyAction::Toggle => OverlayMode::View,
        HotkeyAction::Search => OverlayMode::Search,
        HotkeyAction::Triage => OverlayMode::Triage,
    }
}

/// # Errors
///
/// 状態が壊れている場合は `Internal`。
pub fn list(app: &AppHandle) -> Result<Vec<HotkeyBinding>, AppError> {
    let bindings = lock(app)?;
    Ok(ACTIONS
        .iter()
        .map(|&action| {
            let binding = bindings.get(&action);
            HotkeyBinding {
                action,
                accelerator: binding.map_or_else(
                    || default_accelerator(action).to_owned(),
                    |b| b.accelerator.clone(),
                ),
                default_accelerator: default_accelerator(action).to_owned(),
                error: binding.and_then(|b| b.error.clone()),
            }
        })
        .collect())
}

/// 動作のキーを変える。新しいキーを登録できたときだけ保存し、できなければ元のキーに戻す。
///
/// # Errors
///
/// 組み合わせが不正、ほかの動作と重なる、登録に失敗した場合は `InvalidInput`。
pub async fn set(app: &AppHandle, action: HotkeyAction, accelerator: &str) -> Result<(), AppError> {
    let (accelerator, shortcut) = normalize(accelerator)?;
    let (old_accelerator, old_shortcut) = {
        let bindings = lock(app)?;
        if bindings.iter().any(|(&other, b)| {
            other != action && b.shortcut.is_some_and(|s| s.id() == shortcut.id())
        }) {
            return Err(AppError::InvalidInput(format!(
                "{accelerator} はほかの動作に割り当て済みです"
            )));
        }
        let old = bindings.get(&action);
        (
            old.map(|b| b.accelerator.clone()),
            old.and_then(|b| b.shortcut),
        )
    };
    let binding = if old_shortcut.is_some_and(|s| s.id() == shortcut.id()) {
        Binding {
            accelerator,
            shortcut: Some(shortcut),
            error: None,
        }
    } else {
        if let Some(old_shortcut) = old_shortcut {
            let _ = app.global_shortcut().unregister(old_shortcut);
        }
        let binding = register(app, &accelerator);
        if let Some(error) = binding.error {
            // 失敗したら元のキーを登録し直し、使えるキーをなくさないようにする
            let restored = register(
                app,
                old_accelerator
                    .as_deref()
                    .unwrap_or(default_accelerator(action)),
            );
            lock(app)?.insert(action, restored);
            return Err(AppError::InvalidInput(error));
        }
        binding
    };
    let value = {
        let mut bindings = lock(app)?;
        bindings.insert(action, binding);
        to_setting(
            &bindings
                .iter()
                .map(|(&a, b)| (a, b.accelerator.clone()))
                .collect(),
        )
    };
    app.state::<Db>()
        .run(move |conn, _| settings::set(conn, SETTINGS_KEY, &value))
        .await
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn normalizes_to_display_form() {
        for (input, expected) in [
            ("ctrl+shift+m", "Ctrl+Shift+M"),
            ("Shift+Control+KeyF", "Ctrl+Shift+F"),
            ("alt+1", "Alt+1"),
            ("Super+Digit2", "Super+2"),
            ("Ctrl+F5", "Ctrl+F5"),
            (
                "ctrl+alt+shift+super+numpad1",
                "Ctrl+Alt+Shift+Super+Numpad1",
            ),
        ] {
            assert_eq!(normalize(input).expect(input).0, expected);
        }
    }

    #[test]
    fn normalized_form_parses_back_to_same_shortcut() {
        let (text, shortcut) = normalize("ctrl+shift+m").expect("解釈できる");
        let (_, again) = normalize(&text).expect("そろえた形も解釈できる");
        assert_eq!(shortcut.id(), again.id());
    }

    #[test]
    fn rejects_bare_or_shift_only_keys() {
        for input in ["M", "Shift+M", "F5", "", "Ctrl+", "Ctrl+Nope"] {
            assert!(
                matches!(normalize(input), Err(AppError::InvalidInput(_))),
                "{input}"
            );
        }
    }

    #[test]
    fn parse_config_falls_back_per_item() {
        let config = parse_config(Some(&json!({
            "toggle": "alt+m",
            "search": "M",
            "triage": 42,
        })));
        assert_eq!(config[&HotkeyAction::Toggle], "Alt+M");
        assert_eq!(config[&HotkeyAction::Search], "Ctrl+Shift+F");
        assert_eq!(config[&HotkeyAction::Triage], "Ctrl+Shift+T");
        let defaults = parse_config(None);
        assert_eq!(defaults[&HotkeyAction::Toggle], "Ctrl+Shift+M");
    }

    #[test]
    fn setting_roundtrips() {
        let config = parse_config(Some(&json!({ "toggle": "Alt+M" })));
        assert_eq!(parse_config(Some(&to_setting(&config))), config);
    }
}
