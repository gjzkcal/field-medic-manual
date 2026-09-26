//! アプリの設定（キーと JSON の値）。中身の検査は TS 側で行う（設定の形は画面ごとに決まり、不正なら既定値に戻せばよいため）。

use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;

use crate::error::AppError;

const MAX_KEY_LEN: usize = 64;

/// 値を返す。保存されていなければ `None`。
///
/// # Errors
///
/// キーが不正なら `InvalidInput`。保存された値が JSON として読めなければ `Internal`。
pub fn get(conn: &Connection, key: &str) -> Result<Option<Value>, AppError> {
    let key = validate_key(key)?;
    let text: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()?;
    text.map(|t| {
        serde_json::from_str(&t)
            .map_err(|e| AppError::Internal(format!("設定 {key} の値を読めません: {e}")))
    })
    .transpose()
}

/// 値を保存する（あれば上書き）。
///
/// # Errors
///
/// キーが不正なら `InvalidInput`。
pub fn set(conn: &Connection, key: &str, value: &Value) -> Result<(), AppError> {
    let key = validate_key(key)?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value.to_string()),
    )?;
    Ok(())
}

fn validate_key(key: &str) -> Result<&str, AppError> {
    let key = key.trim();
    if key.is_empty() || key.len() > MAX_KEY_LEN {
        return Err(AppError::InvalidInput(format!(
            "設定のキーは 1〜{MAX_KEY_LEN} バイトにしてください"
        )));
    }
    Ok(key)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::db::test_conn;

    #[test]
    fn missing_key_is_none() {
        let conn = test_conn();
        assert_eq!(get(&conn, "viewer").expect("読める"), None);
    }

    #[test]
    fn set_then_get_roundtrips_and_overwrites() {
        let conn = test_conn();
        set(
            &conn,
            "viewer",
            &json!({ "fontSize": "l", "lineHeight": "relaxed" }),
        )
        .expect("保存できる");
        assert_eq!(
            get(&conn, "viewer").expect("読める"),
            Some(json!({ "fontSize": "l", "lineHeight": "relaxed" }))
        );
        set(&conn, "viewer", &json!({ "fontSize": "xl" })).expect("上書きできる");
        assert_eq!(
            get(&conn, "viewer").expect("読める"),
            Some(json!({ "fontSize": "xl" }))
        );
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM settings", [], |r| r.get(0))
            .expect("数えられる");
        assert_eq!(rows, 1);
    }

    #[test]
    fn rejects_invalid_keys() {
        let conn = test_conn();
        for key in ["", "  ", &"k".repeat(MAX_KEY_LEN + 1)] {
            assert!(matches!(
                set(&conn, key, &json!(1)),
                Err(AppError::InvalidInput(_))
            ));
            assert!(matches!(get(&conn, key), Err(AppError::InvalidInput(_))));
        }
    }

    #[test]
    fn broken_value_is_internal_error() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('viewer', '{壊れた')",
            [],
        )
        .expect("入れられる");
        assert!(matches!(get(&conn, "viewer"), Err(AppError::Internal(_))));
    }
}
