//! 検索を補助する辞書（タグの一覧と同義語）。

use std::collections::HashMap;

use rusqlite::{Connection, OptionalExtension, params};

use super::text::normalize_terms;
use crate::error::AppError;
use crate::model::{SynonymGroup, SynonymGroupInput, TagCount};

/// タグと、それを使っているドキュメント・セクションの数（名前順）。
///
/// # Errors
///
/// DB の読み取りに失敗した場合。
pub fn tag_list(conn: &Connection) -> Result<Vec<TagCount>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT t.name,
                (SELECT COUNT(*) FROM document_tags dt WHERE dt.tag_id = t.id),
                (SELECT COUNT(*) FROM section_tags st WHERE st.tag_id = t.id)
         FROM tags t ORDER BY t.name",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(TagCount {
            name: r.get(0)?,
            document_count: r.get(1)?,
            section_count: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// 同義語グループの一覧（id 順）。
///
/// # Errors
///
/// DB の読み取りに失敗した場合。
pub fn synonym_list(conn: &Connection) -> Result<Vec<SynonymGroup>, AppError> {
    let mut terms: HashMap<i64, Vec<String>> = HashMap::new();
    let mut stmt = conn.prepare("SELECT group_id, term FROM synonyms ORDER BY group_id, rowid")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))? {
        let (group_id, term) = row?;
        terms.entry(group_id).or_default().push(term);
    }
    let mut stmt = conn.prepare("SELECT id, note, updated_at FROM synonym_groups ORDER BY id")?;
    let groups = stmt
        .query_map([], |r| {
            Ok(SynonymGroup {
                id: r.get(0)?,
                terms: Vec::new(),
                note: r.get(1)?,
                updated_at: r.get(2)?,
            })
        })?
        .map(|g| {
            g.map(|mut g| {
                g.terms = terms.remove(&g.id).unwrap_or_default();
                g
            })
        })
        .collect::<rusqlite::Result<_>>()?;
    Ok(groups)
}

/// 同義語グループを保存する。`id` があれば語を丸ごと置き換える。
///
/// # Errors
///
/// 語が 2 つ未満なら `InvalidInput`（1 語では言い換えにならない）。`id` のグループがなければ `NotFound`。
pub fn synonym_save(
    conn: &mut Connection,
    input: &SynonymGroupInput,
) -> Result<SynonymGroup, AppError> {
    let terms = normalize_terms(input.terms.iter().map(String::as_str));
    if terms.len() < 2 {
        return Err(AppError::InvalidInput(
            "同義語は 2 語以上で登録してください".to_owned(),
        ));
    }
    let note = input
        .note
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty());

    let tx = conn.transaction()?;
    let now = super::now(&tx)?;
    let id = if let Some(id) = input.id {
        let updated = tx.execute(
            "UPDATE synonym_groups SET note = ?1, updated_at = ?2 WHERE id = ?3",
            params![note, now, id],
        )?;
        if updated == 0 {
            return Err(AppError::NotFound(format!("同義語グループ {id}")));
        }
        tx.execute("DELETE FROM synonyms WHERE group_id = ?1", [id])?;
        id
    } else {
        tx.execute(
            "INSERT INTO synonym_groups (note, updated_at) VALUES (?1, ?2)",
            params![note, now],
        )?;
        tx.last_insert_rowid()
    };
    {
        let mut insert = tx.prepare("INSERT INTO synonyms (group_id, term) VALUES (?1, ?2)")?;
        for term in &terms {
            insert.execute(params![id, term])?;
        }
    }
    let saved = tx
        .query_row(
            "SELECT note, updated_at FROM synonym_groups WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
        .map(|(note, updated_at)| SynonymGroup {
            id,
            terms,
            note,
            updated_at,
        })
        .ok_or_else(|| AppError::Internal(format!("保存した同義語グループ {id} を読めません")))?;
    tx.commit()?;
    Ok(saved)
}

/// 同義語グループを消す。
///
/// # Errors
///
/// 見つからなければ `NotFound`。
pub fn synonym_delete(conn: &Connection, id: i64) -> Result<(), AppError> {
    if conn.execute("DELETE FROM synonym_groups WHERE id = ?1", [id])? == 0 {
        return Err(AppError::NotFound(format!("同義語グループ {id}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{docs, fixtures, search, test_conn};
    use crate::model::{SearchFilter, SearchHit};

    fn hit_anchors(conn: &Connection, query: &str) -> Vec<String> {
        search::search(conn, query, None, &SearchFilter::default())
            .expect("検索できる")
            .into_iter()
            .filter_map(|hit| match hit {
                SearchHit::Section(h) => Some(h.anchor),
                SearchHit::Flow(_) => None,
            })
            .collect()
    }

    #[test]
    fn seed_synonyms_are_listed() {
        let conn = test_conn();
        let groups = synonym_list(&conn).expect("一覧を取れる");
        let tourniquet = groups
            .iter()
            .find(|g| g.terms.iter().any(|t| t == "止血帯"))
            .expect("止血帯のグループがある");
        assert!(tourniquet.terms.iter().any(|t| t == "TQ"));
        assert!(groups.iter().all(|g| g.terms.len() >= 2));
    }

    #[test]
    fn saved_synonyms_affect_search() {
        let mut conn = test_conn();
        docs::upsert(&mut conn, &fixtures::cpr()).expect("保存できる");
        assert!(hit_anchors(&conn, "胸骨圧迫").is_empty());

        let group = synonym_save(
            &mut conn,
            &SynonymGroupInput {
                id: None,
                terms: vec![" 胸骨圧迫 ".to_owned(), "CPR".to_owned(), "cpr".to_owned()],
                note: Some("  ".to_owned()),
            },
        )
        .expect("保存できる");
        assert_eq!(group.terms, ["胸骨圧迫", "CPR"]);
        assert_eq!(group.note, None);
        assert_eq!(hit_anchors(&conn, "胸骨圧迫"), ["cpr-steps"]);

        synonym_delete(&conn, group.id).expect("削除できる");
        assert!(hit_anchors(&conn, "胸骨圧迫").is_empty());
        assert!(matches!(
            synonym_delete(&conn, group.id),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn update_replaces_terms() {
        let mut conn = test_conn();
        let group = synonym_save(
            &mut conn,
            &SynonymGroupInput {
                id: None,
                terms: vec!["あ".to_owned(), "い".to_owned()],
                note: None,
            },
        )
        .expect("保存できる");
        let updated = synonym_save(
            &mut conn,
            &SynonymGroupInput {
                id: Some(group.id),
                terms: vec!["う".to_owned(), "え".to_owned()],
                note: Some("メモ".to_owned()),
            },
        )
        .expect("更新できる");
        assert_eq!(updated.terms, ["う", "え"]);
        let listed = synonym_list(&conn).expect("一覧を取れる");
        let found = listed.iter().find(|g| g.id == group.id).expect("ある");
        assert_eq!(found.terms, ["う", "え"]);
        assert_eq!(found.note.as_deref(), Some("メモ"));
    }

    #[test]
    fn rejects_invalid_groups() {
        let mut conn = test_conn();
        let one = SynonymGroupInput {
            id: None,
            terms: vec!["止血帯".to_owned(), " ".to_owned(), "止血帯".to_owned()],
            note: None,
        };
        assert!(matches!(
            synonym_save(&mut conn, &one),
            Err(AppError::InvalidInput(_))
        ));
        let missing = SynonymGroupInput {
            id: Some(9999),
            terms: vec!["a".to_owned(), "b".to_owned()],
            note: None,
        };
        assert!(matches!(
            synonym_save(&mut conn, &missing),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn tag_list_counts_usage() {
        let mut conn = test_conn();
        docs::upsert(&mut conn, &fixtures::bleeding()).expect("保存できる");
        docs::upsert(&mut conn, &fixtures::tourniquet()).expect("保存できる");
        let tags = tag_list(&conn).expect("一覧を取れる");
        let find = |name: &str| tags.iter().find(|t| t.name == name).expect(name);
        assert_eq!(find("出血").document_count, 1);
        assert_eq!(find("圧迫止血").section_count, 1);
        assert_eq!(find("止血帯").document_count, 1);
    }
}
