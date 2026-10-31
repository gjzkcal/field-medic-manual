//! ログの書き方を 1 か所にまとめる。
//!
//! 書くのは利用者の PC のログのフォルダだけで、外には送らない（通信は更新の確認だけという設計のため）。
//! 検索語・お気に入り・履歴・本文は書かない。

use std::fmt::Write as _;

use log::{Level, LevelFilter};
use serde_json::json;
use tauri::Runtime;
use tauri::plugin::TauriPlugin;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

const MAX_FILE_BYTES: u128 = 1024 * 1024;
const KEEP_FILES: usize = 5;
/// 1 件の長さの上限。例外のスタックが入っても足り、長い入力を送り続けてログを埋められないようにする
const MAX_MESSAGE_CHARS: usize = 4096;

#[must_use]
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_log::Builder::new()
        // 既定の出力先には標準出力も入っている。書く先をログのフォルダだけに限る
        .clear_targets()
        .target(Target::new(TargetKind::LogDir { file_name: None }))
        .max_file_size(MAX_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(KEEP_FILES))
        // 依存の Info は通信先の URL などを含み、原因を追う役にも立たない
        .level(LevelFilter::Warn)
        .level_for(env!("CARGO_CRATE_NAME"), LevelFilter::Info)
        .level_for(CLIENT_TARGET, LevelFilter::Info)
        .format(|out, message, record| {
            let timestamp = OffsetDateTime::now_utc()
                .format(&Rfc3339)
                .unwrap_or_default();
            out.finish(format_args!(
                "{}",
                entry(
                    &timestamp,
                    record.level(),
                    record.target(),
                    &message.to_string()
                )
            ));
        })
        .build()
}

/// 1 件を 1 行の JSON にする。改行や引用符は JSON のエスケープに任せるので、入力に改行があっても偽の行を作れない。
fn entry(timestamp: &str, level: Level, target: &str, message: &str) -> String {
    json!({
        "ts": timestamp,
        "level": level.as_str(),
        "target": target,
        "msg": clean(message),
    })
    .to_string()
}

/// 長さを切り、JSON がそのまま通す見えない文字をエスケープする。
/// DEL・C1 制御文字・書字方向の制御文字は、ログを端末やエディタで読むときに表示を偽装できる。
fn clean(message: &str) -> String {
    let mut out = String::with_capacity(message.len().min(MAX_MESSAGE_CHARS));
    for c in message.chars().take(MAX_MESSAGE_CHARS) {
        if matches!(c, '\u{7f}'..='\u{9f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}') {
            let _ = write!(out, "\\u{{{:x}}}", u32::from(c));
        } else {
            out.push(c);
        }
    }
    out
}

/// パニックも記録する。配布版は `panic = "abort"` で、記録しないと原因が何も残らない。
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("パニック: {info}");
        previous(info);
    }));
}

const CLIENT_TARGET: &str = "client";

/// 画面の例外を書く。レベルを固定し、画面から任意のレベルで書かせない。
pub fn client_error(window_label: &str, message: &str) {
    log::error!(target: CLIENT_TARGET, "{window_label}: {message}");
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

    fn parse(line: &str) -> Value {
        serde_json::from_str(line).expect("entry should be JSON")
    }

    #[test]
    fn entry_is_one_line_of_json() {
        let line = entry("2026-10-31T00:00:00Z", Level::Warn, "x::y", "a");
        let value = parse(&line);
        assert_eq!(value["ts"], "2026-10-31T00:00:00Z");
        assert_eq!(value["level"], "WARN");
        assert_eq!(value["target"], "x::y");
        assert_eq!(value["msg"], "a");
    }

    #[test]
    fn newline_in_message_cannot_forge_an_entry() {
        let forged = "a\n{\"level\":\"INFO\",\"msg\":\"偽\"}\r\n";
        let line = entry("t", Level::Error, "client", forged);
        assert!(!line.contains('\n'));
        assert!(!line.contains('\r'));
        assert_eq!(parse(&line)["msg"], forged);
    }

    #[test]
    fn hidden_characters_are_escaped() {
        assert_eq!(clean("a\u{7f}b\u{85}c"), "a\\u{7f}b\\u{85}c");
        assert_eq!(clean("\u{202e}txt.exe"), "\\u{202e}txt.exe");
        assert_eq!(clean("\u{2066}x"), "\\u{2066}x");
    }

    #[test]
    fn long_message_is_cut() {
        let long = "あ".repeat(MAX_MESSAGE_CHARS + 10);
        assert_eq!(clean(&long).chars().count(), MAX_MESSAGE_CHARS);
    }

    #[test]
    fn ordinary_text_is_left_alone() {
        assert_eq!(clean("止血帯を使う (1)"), "止血帯を使う (1)");
    }
}
