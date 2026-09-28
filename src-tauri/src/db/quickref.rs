//! 症状→処置 クイック表の保存。行の形（content-guide.md §8）の検査は TS の zod で行い、
//! ここでは DB に入れてよい最低限（id・必須の文字列・重症度・id の重複）だけを確かめる。

use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;
use serde::de::DeserializeOwned;

use super::docs::{is_iso_date, non_empty};
use super::text::{is_slug, strip_marks};
use crate::error::AppError;
use crate::model::{ModTarget, QuickrefReplaceInput, QuickrefRow, QuickrefTable};

/// 全行と同梱ファイルの情報を置き換える。1 つのトランザクションで行い、失敗したら前の内容を残す。
///
/// # Errors
///
/// 入力が不正（id がスラッグでない・重複している、必須の文字列が空、重症度が 1〜4 でないなど）なら `InvalidInput`。
pub fn replace_all(conn: &mut Connection, input: &QuickrefReplaceInput) -> Result<(), AppError> {
    let input = validate(input)?;
    let tx = conn.transaction()?;
    let now = super::now(&tx)?;
    tx.execute("DELETE FROM quickref_rows", [])?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO quickref_rows (id, category, symptom, severity, treatment, items, notes,
               links, mods, without_mods, mod_targets, mod_channel, search_text, order_index)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        )?;
        for (index, row) in input.rows.iter().enumerate() {
            // 条件のない行はどの組み合わせでも出るので、検索の絞り込みでは Core の行として扱う
            let mod_targets = if row.mods.is_empty() {
                vec![ModTarget::Core]
            } else {
                row.mods.clone()
            };
            stmt.execute(params![
                row.id,
                row.category,
                row.symptom,
                row.severity,
                to_json(&row.treatment)?,
                to_json(&row.items)?,
                row.notes,
                to_json(&row.links)?,
                to_json(&row.mods)?,
                to_json(&row.without_mods)?,
                to_json(&mod_targets)?,
                input.mod_channel,
                search_text(row),
                i64::try_from(index)
                    .map_err(|_| AppError::InvalidInput("行が多すぎます".to_owned()))?,
            ])?;
        }
    }
    tx.execute(
        "INSERT INTO quickref_meta (id, source_hash, mod_channel, verified_at, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
           source_hash = excluded.source_hash, mod_channel = excluded.mod_channel,
           verified_at = excluded.verified_at, updated_at = excluded.updated_at",
        params![input.source_hash, input.mod_channel, input.verified_at, now],
    )?;
    tx.commit()?;
    Ok(())
}

fn validate(input: &QuickrefReplaceInput) -> Result<QuickrefReplaceInput, AppError> {
    let mut input = input.clone();
    if input.source_hash.trim().is_empty() {
        return Err(AppError::InvalidInput("source_hash が空です".to_owned()));
    }
    input.verified_at = non_empty(input.verified_at.as_deref());
    if let Some(date) = &input.verified_at
        && !is_iso_date(date)
    {
        return Err(AppError::InvalidInput(format!(
            "verifiedAt は YYYY-MM-DD で書いてください: {date}"
        )));
    }
    let mut seen = HashSet::new();
    for row in &mut input.rows {
        if !is_slug(&row.id) {
            return Err(AppError::InvalidInput(format!(
                "クイック表の id は英小文字・数字・ハイフンにしてください: {}",
                row.id
            )));
        }
        // id はお気に入りとリンクの行き先なので、重なると別の行を開いてしまう
        if !seen.insert(row.id.clone()) {
            return Err(AppError::InvalidInput(format!(
                "クイック表の id が重複しています: {}",
                row.id
            )));
        }
        if !(1..=4).contains(&row.severity) {
            return Err(AppError::InvalidInput(format!(
                "行 {} の重症度は 1〜4 です: {}",
                row.id, row.severity
            )));
        }
        // 強調の目印が混ざると検索のスニペットの強調が壊れるため、保存前に取り除く
        row.category = required(&row.category, &row.id, "カテゴリ")?;
        row.symptom = required(&row.symptom, &row.id, "症状")?;
        row.treatment = clean_list(&row.treatment);
        if row.treatment.is_empty() {
            return Err(AppError::InvalidInput(format!(
                "行 {} の手順が空です",
                row.id
            )));
        }
        row.items = clean_list(&row.items);
        row.links = clean_list(&row.links);
        row.notes = non_empty(row.notes.as_deref()).map(|n| strip_marks(&n));
        row.mods = dedup(&row.mods);
        row.without_mods = dedup(&row.without_mods);
    }
    Ok(input)
}

fn required(value: &str, id: &str, name: &str) -> Result<String, AppError> {
    let value = strip_marks(value.trim());
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("行 {id} の{name}が空です")));
    }
    Ok(value)
}

fn clean_list(values: &[String]) -> Vec<String> {
    values
        .iter()
        .map(|v| strip_marks(v.trim()))
        .filter(|v| !v.is_empty())
        .collect()
}

fn dedup(mods: &[ModTarget]) -> Vec<ModTarget> {
    let mut out: Vec<ModTarget> = Vec::new();
    for m in mods {
        if !out.contains(m) {
            out.push(*m);
        }
    }
    out
}

/// 検索用の本文。症状とカテゴリは列を分けて探す（症状に当たった行を先頭に出すため）。
fn search_text(row: &QuickrefRow) -> String {
    let mut parts: Vec<&str> = row.treatment.iter().map(String::as_str).collect();
    parts.extend(row.items.iter().map(String::as_str));
    if let Some(notes) = &row.notes {
        parts.push(notes);
    }
    parts.join("\n")
}

fn to_json<T: Serialize + ?Sized>(value: &T) -> Result<String, AppError> {
    serde_json::to_string(value).map_err(|e| AppError::Internal(format!("JSON にできません: {e}")))
}

fn from_json<T: DeserializeOwned>(row: &Row<'_>, index: usize) -> rusqlite::Result<T> {
    let text: String = row.get(index)?;
    serde_json::from_str(&text).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, Box::new(e))
    })
}

fn read_row(row: &Row<'_>) -> rusqlite::Result<QuickrefRow> {
    Ok(QuickrefRow {
        id: row.get(0)?,
        category: row.get(1)?,
        symptom: row.get(2)?,
        severity: row.get(3)?,
        treatment: from_json(row, 4)?,
        items: from_json(row, 5)?,
        notes: row.get(6)?,
        links: from_json(row, 7)?,
        mods: from_json(row, 8)?,
        without_mods: from_json(row, 9)?,
    })
}

/// 全行（ファイルに書いた順）と同梱ファイルの情報。
///
/// # Errors
///
/// DB の読み取りに失敗した場合。
pub fn list(conn: &Connection) -> Result<QuickrefTable, AppError> {
    let meta = conn
        .query_row(
            "SELECT source_hash, mod_channel, verified_at FROM quickref_meta WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let rows = conn
        .prepare(
            "SELECT id, category, symptom, severity, treatment, items, notes, links, mods,
               without_mods
             FROM quickref_rows ORDER BY order_index",
        )?
        .query_map([], read_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let (source_hash, mod_channel, verified_at) = meta.unwrap_or((None, None, None));
    Ok(QuickrefTable {
        source_hash,
        mod_channel,
        verified_at,
        rows,
    })
}

#[cfg(test)]
pub mod fixtures {
    use crate::model::{ModChannel, ModTarget, QuickrefReplaceInput, QuickrefRow};

    #[must_use]
    pub fn row(id: &str, category: &str, symptom: &str, severity: u8) -> QuickrefRow {
        QuickrefRow {
            id: id.to_owned(),
            category: category.to_owned(),
            symptom: symptom.to_owned(),
            severity,
            treatment: vec!["包帯を巻く".to_owned()],
            items: vec!["包帯".to_owned()],
            notes: None,
            links: vec!["doc:hemorrhage.md#包帯を巻く".to_owned()],
            mods: Vec::new(),
            without_mods: Vec::new(),
        }
    }

    /// 気胸（Breathing）・大出血・意識不明（Circulation の有無で 2 行）の 4 行。
    #[must_use]
    pub fn table(hash: &str) -> QuickrefReplaceInput {
        QuickrefReplaceInput {
            source_hash: hash.to_owned(),
            mod_channel: Some(ModChannel::Dev),
            verified_at: Some("2026-09-28".to_owned()),
            rows: vec![
                QuickrefRow {
                    treatment: vec!["NCD キットで脱気する".to_owned()],
                    items: vec!["NCD キット".to_owned()],
                    notes: Some("診察で Tension pneumothorax と出る".to_owned()),
                    mods: vec![ModTarget::Breathing],
                    ..row("tension-ptx", "気道・呼吸", "緊張性気胸", 4)
                },
                QuickrefRow {
                    treatment: vec![
                        "包帯を巻く".to_owned(),
                        "止まらなければ止血帯を使う".to_owned(),
                    ],
                    ..row("limb-bleeding", "出血", "手足から大量に出血している", 4)
                },
                QuickrefRow {
                    treatment: vec!["炭酸アンモニウムを嗅がせる".to_owned()],
                    items: vec!["炭酸アンモニウム".to_owned()],
                    mods: vec![ModTarget::Circulation],
                    ..row("unconscious-circulation", "意識", "意識不明", 3)
                },
                QuickrefRow {
                    treatment: vec!["エピネフリンを注射する".to_owned()],
                    items: vec!["エピネフリン".to_owned()],
                    without_mods: vec![ModTarget::Circulation],
                    ..row("unconscious-core", "意識", "意識不明", 3)
                },
            ],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::{row, table};
    use super::*;
    use crate::db::test_conn;
    use crate::model::{ModChannel, ModTarget};

    fn ids(table: &QuickrefTable) -> Vec<&str> {
        table.rows.iter().map(|r| r.id.as_str()).collect()
    }

    #[test]
    fn empty_until_first_sync() {
        let conn = test_conn();
        let table = list(&conn).expect("読める");
        assert!(table.source_hash.is_none());
        assert!(table.rows.is_empty());
    }

    #[test]
    fn replace_all_keeps_file_order_and_meta() {
        let mut conn = test_conn();
        let input = table("hash-1");
        replace_all(&mut conn, &input).expect("保存できる");
        let saved = list(&conn).expect("読める");
        assert_eq!(saved.source_hash.as_deref(), Some("hash-1"));
        assert_eq!(saved.mod_channel, Some(ModChannel::Dev));
        assert_eq!(saved.verified_at.as_deref(), Some("2026-09-28"));
        assert_eq!(
            ids(&saved),
            [
                "tension-ptx",
                "limb-bleeding",
                "unconscious-circulation",
                "unconscious-core"
            ]
        );
        assert_eq!(saved.rows, input.rows, "行の中身がそのまま戻る");
    }

    #[test]
    fn replace_all_replaces_everything() {
        let mut conn = test_conn();
        replace_all(&mut conn, &table("hash-1")).expect("保存できる");
        let mut next = table("hash-2");
        next.rows = vec![row("only", "出血", "出血", 1)];
        next.mod_channel = None;
        replace_all(&mut conn, &next).expect("置き換えられる");
        let saved = list(&conn).expect("読める");
        assert_eq!(saved.source_hash.as_deref(), Some("hash-2"));
        assert_eq!(saved.mod_channel, None);
        assert_eq!(ids(&saved), ["only"]);

        next.rows.clear();
        next.source_hash = "hash-3".to_owned();
        replace_all(&mut conn, &next).expect("空にできる");
        let saved = list(&conn).expect("読める");
        assert_eq!(
            saved.source_hash.as_deref(),
            Some("hash-3"),
            "0 件でも記録する"
        );
        assert!(saved.rows.is_empty());
    }

    #[test]
    fn rejects_invalid_input_and_keeps_previous() {
        let mut conn = test_conn();
        replace_all(&mut conn, &table("hash-1")).expect("保存できる");
        let invalid: Vec<fn(&mut QuickrefReplaceInput)> = vec![
            |t| t.rows[0].id = "Bad_Id".to_owned(),
            |t| t.rows[1].id = t.rows[0].id.clone(),
            |t| t.rows[0].symptom = " ".to_owned(),
            |t| t.rows[0].category = String::new(),
            |t| t.rows[0].severity = 0,
            |t| t.rows[0].severity = 5,
            |t| t.rows[0].treatment.clear(),
            |t| t.rows[0].treatment = vec![" ".to_owned()],
            |t| t.source_hash = String::new(),
            |t| t.verified_at = Some("2026/09/28".to_owned()),
        ];
        for (i, change) in invalid.iter().enumerate() {
            let mut input = table("hash-2");
            change(&mut input);
            assert!(
                matches!(
                    replace_all(&mut conn, &input),
                    Err(AppError::InvalidInput(_))
                ),
                "{i} 番目の変更が通ってしまう"
            );
        }
        let saved = list(&conn).expect("読める");
        assert_eq!(
            saved.source_hash.as_deref(),
            Some("hash-1"),
            "前の内容が残る"
        );
        assert_eq!(saved.rows.len(), 4);
    }

    #[test]
    fn strips_marks_and_duplicate_mods() {
        let mut conn = test_conn();
        let mut input = table("hash-1");
        input.rows[0].symptom = "緊張性\u{E000}気胸\u{E001}".to_owned();
        input.rows[0].mods = vec![ModTarget::Breathing, ModTarget::Breathing];
        input.rows[0].notes = Some("  ".to_owned());
        replace_all(&mut conn, &input).expect("保存できる");
        let saved = list(&conn).expect("読める");
        assert_eq!(saved.rows[0].symptom, "緊張性気胸");
        assert_eq!(saved.rows[0].mods, [ModTarget::Breathing]);
        assert_eq!(saved.rows[0].notes, None, "空の備考は null");
    }
}
