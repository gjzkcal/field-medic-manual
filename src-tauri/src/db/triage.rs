//! トリアージフローの保存。フローの形（triage-format.md）の検査は TS の zod と validate.ts で行い、
//! ここでは DB に入れてよい最低限（id・タイトル・JSON として読めること）だけを確かめる。

use rusqlite::{Connection, OptionalExtension, Row, params};

use super::docs::{is_iso_date, non_empty};
use super::text::strip_marks;
use crate::error::AppError;
use crate::model::{ModTarget, TriageDetail, TriageSummary, TriageUpsertInput};

/// フローを保存する。同じ id のフローがあれば置き換える。
///
/// # Errors
///
/// 入力が不正（id がスラッグでない、タイトルが空、JSON として読めないなど）なら `InvalidInput`。
pub fn upsert(conn: &Connection, input: &TriageUpsertInput) -> Result<(), AppError> {
    let input = validate(input)?;
    let now = super::now(conn)?;
    let mod_targets = serde_json::to_string(&input.mod_targets)
        .map_err(|e| AppError::Internal(format!("mod_targets を JSON にできません: {e}")))?;
    conn.execute(
        "INSERT INTO triage_flows (id, title, description, mod_targets, mod_channel, verified_at,
           json, search_text, source_hash, version, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, description = excluded.description,
           mod_targets = excluded.mod_targets, mod_channel = excluded.mod_channel,
           verified_at = excluded.verified_at, json = excluded.json,
           search_text = excluded.search_text, source_hash = excluded.source_hash,
           version = excluded.version, updated_at = excluded.updated_at",
        params![
            input.id,
            input.title,
            input.description,
            mod_targets,
            input.mod_channel,
            input.verified_at,
            input.json,
            input.search_text,
            input.source_hash,
            input.version,
            now,
        ],
    )?;
    Ok(())
}

fn validate(input: &TriageUpsertInput) -> Result<TriageUpsertInput, AppError> {
    let mut input = input.clone();
    if !is_slug(&input.id) {
        return Err(AppError::InvalidInput(format!(
            "フローの id は英小文字・数字・ハイフンにしてください: {}",
            input.id
        )));
    }
    input.title = strip_marks(input.title.trim());
    if input.title.is_empty() {
        return Err(AppError::InvalidInput(format!(
            "フロー {} のタイトルが空です",
            input.id
        )));
    }
    if input.source_hash.trim().is_empty() {
        return Err(AppError::InvalidInput("source_hash が空です".to_owned()));
    }
    // 壊れた JSON を保存すると、実行画面で開くまで気づけないため
    if let Err(e) = serde_json::from_str::<serde_json::Value>(&input.json) {
        return Err(AppError::InvalidInput(format!(
            "フロー {} の JSON を読めません: {e}",
            input.id
        )));
    }
    input.description = non_empty(input.description.as_deref());
    input.verified_at = non_empty(input.verified_at.as_deref());
    if let Some(date) = &input.verified_at
        && !is_iso_date(date)
    {
        return Err(AppError::InvalidInput(format!(
            "verifiedAt は YYYY-MM-DD で書いてください: {date}"
        )));
    }
    // 強調の目印が混ざると検索のスニペットの強調が壊れるため、保存前に取り除く
    input.search_text = strip_marks(&input.search_text);
    let mut targets: Vec<ModTarget> = Vec::new();
    for target in input.mod_targets {
        if !targets.contains(&target) {
            targets.push(target);
        }
    }
    input.mod_targets = targets;
    Ok(input)
}

/// 英小文字・数字を `-` でつないだ形（先頭・末尾・連続の `-` は不可）。URL と原稿のファイル名に使うため。
fn is_slug(s: &str) -> bool {
    !s.is_empty()
        && s.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}

const SUMMARY_COLUMNS: &str = "id, title, description, mod_targets, mod_channel, verified_at,
       version, source_hash, updated_at";

fn read_summary(row: &Row<'_>) -> rusqlite::Result<TriageSummary> {
    let mod_targets: String = row.get(3)?;
    Ok(TriageSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        mod_targets: serde_json::from_str(&mod_targets).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e))
        })?,
        mod_channel: row.get(4)?,
        verified_at: row.get(5)?,
        version: row.get(6)?,
        source_hash: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

/// フローの一覧（タイトル順）。
///
/// # Errors
///
/// DB の読み取りに失敗した場合。
pub fn list(conn: &Connection) -> Result<Vec<TriageSummary>, AppError> {
    Ok(conn
        .prepare(&format!(
            "SELECT {SUMMARY_COLUMNS} FROM triage_flows ORDER BY title COLLATE NOCASE, id"
        ))?
        .query_map([], read_summary)?
        .collect::<rusqlite::Result<_>>()?)
}

/// # Errors
///
/// 見つからなければ `NotFound`。
pub fn get(conn: &Connection, id: &str) -> Result<TriageDetail, AppError> {
    conn.query_row(
        &format!("SELECT {SUMMARY_COLUMNS}, json FROM triage_flows WHERE id = ?1"),
        [id],
        |r| {
            Ok(TriageDetail {
                summary: read_summary(r)?,
                json: r.get(9)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("フロー {id}")))
}

/// # Errors
///
/// 見つからなければ `NotFound`。
pub fn delete(conn: &Connection, id: &str) -> Result<(), AppError> {
    if conn.execute("DELETE FROM triage_flows WHERE id = ?1", [id])? == 0 {
        return Err(AppError::NotFound(format!("フロー {id}")));
    }
    Ok(())
}

#[cfg(test)]
pub mod fixtures {
    use crate::model::{ModChannel, ModTarget, TriageUpsertInput};

    #[must_use]
    pub fn flow(id: &str, title: &str, search_text: &str) -> TriageUpsertInput {
        TriageUpsertInput {
            id: id.to_owned(),
            title: title.to_owned(),
            description: None,
            mod_targets: vec![ModTarget::Core],
            mod_channel: None,
            verified_at: Some("2026-09-26".to_owned()),
            version: 1,
            json: format!(r#"{{"id":"{id}"}}"#),
            search_text: search_text.to_owned(),
            source_hash: format!("hash-{id}"),
        }
    }

    #[must_use]
    pub fn dev_flow(id: &str, title: &str, search_text: &str) -> TriageUpsertInput {
        TriageUpsertInput {
            mod_targets: vec![ModTarget::Circulation, ModTarget::Breathing],
            mod_channel: Some(ModChannel::Dev),
            ..flow(id, title, search_text)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::{dev_flow, flow};
    use super::*;
    use crate::db::test_conn;
    use crate::model::ModChannel;

    #[test]
    fn upsert_then_list_and_get() {
        let conn = test_conn();
        upsert(&conn, &dev_flow("b-flow", "B", "本文")).expect("保存できる");
        upsert(&conn, &flow("a-flow", "A", "")).expect("保存できる");
        let flows = list(&conn).expect("一覧を読める");
        assert_eq!(
            flows.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
            ["a-flow", "b-flow"]
        );
        let detail = get(&conn, "b-flow").expect("読める");
        assert_eq!(
            detail.summary.mod_targets,
            [ModTarget::Circulation, ModTarget::Breathing]
        );
        assert_eq!(detail.summary.mod_channel, Some(ModChannel::Dev));
        assert_eq!(detail.summary.source_hash, "hash-b-flow");
        assert_eq!(detail.json, r#"{"id":"b-flow"}"#);
    }

    #[test]
    fn upsert_replaces_same_id() {
        let conn = test_conn();
        upsert(&conn, &flow("a-flow", "旧", "")).expect("保存できる");
        let mut input = flow("a-flow", "新", "");
        input.source_hash = "hash-2".to_owned();
        input.mod_targets = vec![ModTarget::Core, ModTarget::Core];
        upsert(&conn, &input).expect("置き換えられる");
        let flows = list(&conn).expect("一覧を読める");
        assert_eq!(flows.len(), 1);
        assert_eq!(flows[0].title, "新");
        assert_eq!(flows[0].source_hash, "hash-2");
        assert_eq!(flows[0].mod_targets, [ModTarget::Core], "重複はまとめる");
    }

    #[test]
    fn rejects_invalid_input() {
        let conn = test_conn();
        for id in ["", "A-flow", "a_flow", "-a", "a-", "a--b", "日本語"] {
            assert!(
                matches!(
                    upsert(&conn, &flow(id, "t", "")),
                    Err(AppError::InvalidInput(_))
                ),
                "{id}"
            );
        }
        assert!(matches!(
            upsert(&conn, &flow("a", " ", "")),
            Err(AppError::InvalidInput(_))
        ));
        let mut broken = flow("a", "t", "");
        broken.json = "{壊れた".to_owned();
        assert!(matches!(
            upsert(&conn, &broken),
            Err(AppError::InvalidInput(_))
        ));
        let mut bad_date = flow("a", "t", "");
        bad_date.verified_at = Some("2026/09/26".to_owned());
        assert!(matches!(
            upsert(&conn, &bad_date),
            Err(AppError::InvalidInput(_))
        ));
    }

    #[test]
    fn delete_removes_and_missing_is_not_found() {
        let conn = test_conn();
        upsert(&conn, &flow("a-flow", "A", "")).expect("保存できる");
        delete(&conn, "a-flow").expect("削除できる");
        assert!(list(&conn).expect("一覧を読める").is_empty());
        assert!(matches!(
            delete(&conn, "a-flow"),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(get(&conn, "a-flow"), Err(AppError::NotFound(_))));
    }
}
