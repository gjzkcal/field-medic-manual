//! API キーの保管。Windows の資格情報マネージャーに置き、画面（WebView）・DB・ログには出さない。
//!
//! 資格情報の名前（service）にはアプリの identifier を使う。開発版は identifier が違うので、
//! 開発版が配布版のキーを読み書きしない。

use crate::ai::types::AiKeyStatus;
use crate::error::AppError;

/// 資格情報の user の部分。target は `<user>.<service>` になる
const KEY_USER: &str = "anthropic-api-key";
const KEY_PREFIX: &str = "sk-ant-";
/// 今のキーは 100 文字ほど。桁違いに長い値は貼り間違いとみなす
const MAX_KEY_LEN: usize = 512;

/// 貼り付けたキーを検査し、前後の空白を除いた値を返す。
///
/// # Errors
///
/// 形が API キーでないとき `InvalidInput`。
pub fn validate(raw: &str) -> Result<String, AppError> {
    let key = raw.trim();
    if key.is_empty() {
        return Err(AppError::InvalidInput(
            "API キーを入力してください".to_owned(),
        ));
    }
    if key.len() > MAX_KEY_LEN {
        return Err(AppError::InvalidInput("API キーが長すぎます".to_owned()));
    }
    if !key.starts_with(KEY_PREFIX) {
        return Err(AppError::InvalidInput(format!(
            "Anthropic の API キー（{KEY_PREFIX} で始まるもの）を入力してください"
        )));
    }
    // HTTP のヘッダに載せるので、空白や制御文字を含む値はヘッダの書き換えに使われうる
    if !key.bytes().all(|b| b.is_ascii_graphic()) {
        return Err(AppError::InvalidInput(
            "API キーに使えない文字が含まれています".to_owned(),
        ));
    }
    Ok(key.to_owned())
}

#[cfg(windows)]
mod store {
    use std::sync::{Mutex, OnceLock};

    use keyring_core::{Entry, Error};

    use super::KEY_USER;
    use crate::error::AppError;

    /// 既定のストアの設定は 1 回だけ。失敗したら、その理由を覚えておく
    static STORE: OnceLock<Result<(), String>> = OnceLock::new();
    /// 資格情報マネージャーは、同じ項目を別のスレッドから同時に触ると順番が保たれない（windows-native-keyring-store の文書）
    static LOCK: Mutex<()> = Mutex::new(());

    fn unavailable(detail: &str) -> AppError {
        AppError::AiAuth(format!("資格情報マネージャーを使えません（{detail}）"))
    }

    fn entry(service: &str) -> Result<Entry, AppError> {
        let ready = STORE.get_or_init(|| {
            windows_native_keyring_store::Store::new()
                // 関数をそのまま渡すと Arc<Store> から dyn のストアへの変換が起きないので、クロージャで包む
                .map(|store| keyring_core::set_default_store(store))
                .map_err(|e| e.to_string())
        });
        if let Err(e) = ready {
            return Err(unavailable(e));
        }
        Entry::new(service, KEY_USER).map_err(|e| unavailable(&e.to_string()))
    }

    pub fn get(service: &str) -> Result<Option<String>, AppError> {
        let _guard = LOCK.lock().map_err(|_| unavailable("ロック"))?;
        match entry(service)?.get_password() {
            Ok(key) => Ok(Some(key)),
            Err(Error::NoEntry) => Ok(None),
            Err(e) => Err(unavailable(&e.to_string())),
        }
    }

    pub fn set(service: &str, key: &str) -> Result<(), AppError> {
        let _guard = LOCK.lock().map_err(|_| unavailable("ロック"))?;
        entry(service)?
            .set_password(key)
            .map_err(|e| unavailable(&e.to_string()))
    }

    pub fn clear(service: &str) -> Result<(), AppError> {
        let _guard = LOCK.lock().map_err(|_| unavailable("ロック"))?;
        match entry(service)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(e) => Err(unavailable(&e.to_string())),
        }
    }
}

#[cfg(not(windows))]
mod store {
    use crate::error::AppError;

    fn unsupported() -> AppError {
        AppError::AiAuth("この OS では API キーを保存できません".to_owned())
    }

    pub fn get(_service: &str) -> Result<Option<String>, AppError> {
        Err(unsupported())
    }

    pub fn set(_service: &str, _key: &str) -> Result<(), AppError> {
        Err(unsupported())
    }

    pub fn clear(_service: &str) -> Result<(), AppError> {
        Err(unsupported())
    }
}

/// 保存したキー。資格情報マネージャーは同期の API なので、非同期のコマンドからは `spawn_blocking` で呼ぶ。
///
/// # Errors
///
/// 資格情報マネージャーを使えないとき `AiAuth`。
pub fn load(service: &str) -> Result<Option<String>, AppError> {
    store::get(service)
}

/// # Errors
///
/// 資格情報マネージャーを使えないとき `AiAuth`。
pub fn save(service: &str, key: &str) -> Result<(), AppError> {
    store::set(service, key)
}

/// # Errors
///
/// 資格情報マネージャーを使えないとき `AiAuth`。
pub fn clear(service: &str) -> Result<(), AppError> {
    store::clear(service)
}

#[must_use]
pub fn status(service: &str) -> AiKeyStatus {
    match store::get(service) {
        Ok(Some(_)) => AiKeyStatus::Set,
        Ok(None) => AiKeyStatus::Missing,
        Err(_) => AiKeyStatus::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_trimmed_key() {
        assert_eq!(
            validate("  sk-ant-api03-abcDEF_123  \n").expect("正しい形"),
            "sk-ant-api03-abcDEF_123"
        );
    }

    #[test]
    fn rejects_values_that_are_not_keys() {
        for bad in [
            "",
            "   ",
            "sk-proj-abc",
            "sk-ant-abc def",
            "sk-ant-abc\r\nX: y",
        ] {
            assert!(
                matches!(validate(bad), Err(AppError::InvalidInput(_))),
                "{bad:?} は弾く"
            );
        }
        let long = format!("{KEY_PREFIX}{}", "a".repeat(MAX_KEY_LEN));
        assert!(matches!(validate(&long), Err(AppError::InvalidInput(_))));
    }
}
