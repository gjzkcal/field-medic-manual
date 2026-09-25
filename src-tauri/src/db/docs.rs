use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension, Row, Transaction, params};

use super::text::{normalize_tags, strip_marks};
use crate::error::AppError;
use crate::model::{AssetMeta, DocDetail, DocMeta, DocSummary, DocUpsertInput, Section};

const MAX_LEVEL: u8 = 6;

/// ドキュメントを保存する。同じ `source_path` のドキュメントがあれば置き換える。
///
/// 置き換えるときは id と `created_at` を引き継ぐ。後のステップのお気に入り・履歴が document id を参照するため、
/// 取り込み直すたびに id が変わるとリンクが切れる。
///
/// # Errors
///
/// 入力が不正（見出しレベル・anchor の重複・存在しないアセットなど）なら `InvalidInput`。
pub fn upsert(conn: &mut Connection, input: &DocUpsertInput) -> Result<String, AppError> {
    let input = validate(input)?;
    let tx = conn.transaction()?;
    let now = super::now(&tx)?;

    ensure_assets_exist(&tx, &input)?;

    let existing: Option<(String, String)> = match &input.source_path {
        Some(path) => tx
            .query_row(
                "SELECT id, created_at FROM documents WHERE source_path = ?1",
                [path],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?,
        None => None,
    };
    let (id, created_at) = match existing {
        Some((id, created_at)) => {
            // セクション・タグの対応・アセットの対応はカスケードで消え、索引はトリガーで消える
            tx.execute("DELETE FROM documents WHERE id = ?1", [&id])?;
            (id, created_at)
        }
        None => (uuid::Uuid::new_v4().to_string(), now.clone()),
    };

    tx.execute(
        "INSERT INTO documents (id, title, source_type, source_path, source_hash, original_asset_id,
           mod_target, mod_channel, mod_version, verified_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            id,
            input.title,
            input.source_type,
            input.source_path,
            input.source_hash,
            input.original_asset_id,
            input.meta.mod_target,
            input.meta.mod_channel,
            input.meta.mod_version,
            input.meta.verified_at,
            created_at,
            now,
        ],
    )?;

    for tag in &input.meta.tags {
        let tag_id = ensure_tag(&tx, tag)?;
        tx.execute(
            "INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?1, ?2)",
            params![id, tag_id],
        )?;
    }

    insert_sections(&tx, &id, &input)?;

    let asset_ids: HashSet<&String> = input
        .asset_ids
        .iter()
        .chain(input.original_asset_id.as_ref())
        .collect();
    for asset_id in asset_ids {
        tx.execute(
            "INSERT INTO document_assets (document_id, asset_id) VALUES (?1, ?2)",
            params![id, asset_id],
        )?;
    }

    delete_unused_tags(&tx)?;
    tx.commit()?;
    Ok(id)
}

fn insert_sections(
    tx: &Transaction<'_>,
    document_id: &str,
    input: &DocUpsertInput,
) -> Result<(), AppError> {
    let mut insert = tx.prepare_cached(
        "INSERT INTO sections (document_id, parent_id, level, title, anchor, order_index, html, plain_text, keywords, page)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )?;
    let mut link_tag = tx.prepare_cached(
        "INSERT OR IGNORE INTO section_tags (section_id, tag_id) VALUES (?1, ?2)",
    )?;
    // 直前までの見出しを (level, id) で積み、自分より浅い最後の見出しを親にする
    let mut ancestors: Vec<(u8, i64)> = Vec::new();
    for (order_index, section) in input.sections.iter().enumerate() {
        let parent_id = if section.level == 0 {
            // 導入部は見出しの外にあるので親を持たず、親にもならない
            None
        } else {
            while ancestors
                .last()
                .is_some_and(|&(level, _)| level >= section.level)
            {
                ancestors.pop();
            }
            ancestors.last().map(|&(_, id)| id)
        };
        let order_index = u32::try_from(order_index)
            .map_err(|_| AppError::InvalidInput("セクションが多すぎます".to_owned()))?;
        insert.execute(params![
            document_id,
            parent_id,
            section.level,
            section.title,
            section.anchor,
            order_index,
            section.html,
            section.plain_text,
            section.tags.join(" "),
            section.page,
        ])?;
        let section_id = tx.last_insert_rowid();
        if section.level > 0 {
            ancestors.push((section.level, section_id));
        }
        for tag in &section.tags {
            let tag_id = ensure_tag(tx, tag)?;
            link_tag.execute(params![section_id, tag_id])?;
        }
    }
    Ok(())
}

/// 前後の空白などを整えた入力を返す。不正なら `InvalidInput`。
fn validate(input: &DocUpsertInput) -> Result<DocUpsertInput, AppError> {
    let mut input = input.clone();
    input.title = strip_marks(input.title.trim());
    if input.title.is_empty() {
        return Err(AppError::InvalidInput("タイトルが空です".to_owned()));
    }
    if input.source_hash.trim().is_empty() {
        return Err(AppError::InvalidInput("source_hash が空です".to_owned()));
    }
    input.source_path = non_empty(input.source_path.as_deref());
    input.meta.mod_version = non_empty(input.meta.mod_version.as_deref());
    input.meta.verified_at = non_empty(input.meta.verified_at.as_deref());
    if let Some(date) = &input.meta.verified_at
        && !is_iso_date(date)
    {
        return Err(AppError::InvalidInput(format!(
            "verified_at は YYYY-MM-DD で書いてください: {date}"
        )));
    }
    input.meta.tags = normalize_tags(&input.meta.tags);

    let mut anchors = HashSet::new();
    for section in &mut input.sections {
        if section.level > MAX_LEVEL {
            return Err(AppError::InvalidInput(format!(
                "見出しレベルは 0〜{MAX_LEVEL} です: {}",
                section.level
            )));
        }
        section.anchor = section.anchor.trim().to_owned();
        if section.anchor.is_empty() {
            return Err(AppError::InvalidInput(format!(
                "anchor が空のセクションがあります: {}",
                section.title
            )));
        }
        if !anchors.insert(section.anchor.clone()) {
            return Err(AppError::InvalidInput(format!(
                "anchor が重複しています: {}",
                section.anchor
            )));
        }
        // 強調の目印が本文に混ざるとスニペットの強調が壊れるため、保存前に取り除く
        section.title = strip_marks(section.title.trim());
        section.plain_text = strip_marks(&section.plain_text);
        section.tags = normalize_tags(&section.tags);
    }
    Ok(input)
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
}

fn is_iso_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            _ => c.is_ascii_digit(),
        })
}

/// FK 違反を DB のエラーのまま返すと原因が分かりにくいため、先に確かめて分かる言葉で返す。
fn ensure_assets_exist(tx: &Transaction<'_>, input: &DocUpsertInput) -> Result<(), AppError> {
    let mut exists = tx.prepare_cached("SELECT 1 FROM assets WHERE id = ?1")?;
    for asset_id in input
        .asset_ids
        .iter()
        .chain(input.original_asset_id.as_ref())
    {
        if !exists.exists([asset_id])? {
            return Err(AppError::InvalidInput(format!(
                "アセットが見つかりません（先に asset_put してください）: {asset_id}"
            )));
        }
    }
    Ok(())
}

fn ensure_tag(tx: &Transaction<'_>, name: &str) -> Result<i64, AppError> {
    tx.prepare_cached("INSERT OR IGNORE INTO tags (name) VALUES (?1)")?
        .execute([name])?;
    // NOCASE なので、大文字小文字だけ違う既存のタグがあればそれを使う
    Ok(tx
        .prepare_cached("SELECT id FROM tags WHERE name = ?1")?
        .query_row([name], |r| r.get(0))?)
}

/// どこからも使われなくなったタグを消す。残すとタグの一覧に中身のない候補が並ぶため。
fn delete_unused_tags(conn: &Connection) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM tags
         WHERE id NOT IN (SELECT tag_id FROM document_tags)
           AND id NOT IN (SELECT tag_id FROM section_tags)",
        [],
    )?;
    Ok(())
}

/// `read_summary` が読む列。`documents d` を FROM に置いて使う。
const SUMMARY_COLUMNS: &str =
    "d.id, d.title, d.source_type, d.source_path, d.mod_target, d.mod_channel,
       d.mod_version, d.verified_at, d.created_at, d.updated_at,
       (SELECT COUNT(*) FROM sections s WHERE s.document_id = d.id)";

fn read_summary(row: &Row<'_>) -> rusqlite::Result<DocSummary> {
    Ok(DocSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        source_type: row.get(2)?,
        source_path: row.get(3)?,
        meta: DocMeta {
            mod_target: row.get(4)?,
            mod_channel: row.get(5)?,
            mod_version: row.get(6)?,
            verified_at: row.get(7)?,
            tags: Vec::new(),
        },
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        section_count: row.get(10)?,
    })
}

/// ドキュメントの一覧（タイトル順）。
///
/// # Errors
///
/// DB の読み取りに失敗した場合。
pub fn list(conn: &Connection) -> Result<Vec<DocSummary>, AppError> {
    let mut docs = conn
        .prepare(&format!(
            "SELECT {SUMMARY_COLUMNS} FROM documents d ORDER BY d.title COLLATE NOCASE, d.id"
        ))?
        .query_map([], read_summary)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut tags: HashMap<String, Vec<String>> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT dt.document_id, t.name FROM document_tags dt JOIN tags t ON t.id = dt.tag_id
         ORDER BY t.name",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (doc_id, name) = row?;
        tags.entry(doc_id).or_default().push(name);
    }
    for doc in &mut docs {
        doc.meta.tags = tags.remove(&doc.id).unwrap_or_default();
    }
    Ok(docs)
}

/// ドキュメントの全体（セクション・アセット込み）。
///
/// # Errors
///
/// 見つからなければ `NotFound`。
pub fn get(conn: &Connection, id: &str) -> Result<DocDetail, AppError> {
    let (mut summary, source_hash, original_asset_id) = conn
        .query_row(
            &format!(
                "SELECT {SUMMARY_COLUMNS}, d.source_hash, d.original_asset_id
                 FROM documents d WHERE d.id = ?1"
            ),
            [id],
            |r| Ok((read_summary(r)?, r.get(11)?, r.get(12)?)),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("ドキュメント {id}")))?;

    summary.meta.tags = conn
        .prepare(
            "SELECT t.name FROM document_tags dt JOIN tags t ON t.id = dt.tag_id
             WHERE dt.document_id = ?1 ORDER BY t.name",
        )?
        .query_map([id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;

    let mut section_tags: HashMap<i64, Vec<String>> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT st.section_id, t.name FROM section_tags st
         JOIN tags t ON t.id = st.tag_id
         JOIN sections s ON s.id = st.section_id
         WHERE s.document_id = ?1 ORDER BY t.name",
    )?;
    for row in stmt.query_map([id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))? {
        let (section_id, name) = row?;
        section_tags.entry(section_id).or_default().push(name);
    }

    let sections = conn
        .prepare(
            "SELECT id, parent_id, level, title, anchor, order_index, html, plain_text, page
             FROM sections WHERE document_id = ?1 ORDER BY order_index",
        )?
        .query_map([id], |r| {
            Ok(Section {
                id: r.get(0)?,
                parent_id: r.get(1)?,
                level: r.get(2)?,
                title: r.get(3)?,
                anchor: r.get(4)?,
                order_index: r.get(5)?,
                html: r.get(6)?,
                plain_text: r.get(7)?,
                page: r.get(8)?,
                tags: Vec::new(),
            })
        })?
        .map(|s| {
            s.map(|mut s| {
                s.tags = section_tags.remove(&s.id).unwrap_or_default();
                s
            })
        })
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let assets = conn
        .prepare(
            "SELECT a.id, a.mime, a.file_name, a.size FROM document_assets da
             JOIN assets a ON a.id = da.asset_id
             WHERE da.document_id = ?1 ORDER BY a.file_name, a.id",
        )?
        .query_map([id], |r| {
            Ok(AssetMeta {
                id: r.get(0)?,
                mime: r.get(1)?,
                file_name: r.get(2)?,
                size: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    Ok(DocDetail {
        summary,
        source_hash,
        original_asset_id,
        assets,
        sections,
    })
}

/// ドキュメントを消す。セクション・索引・タグの対応はカスケードとトリガーで消える。
/// アセットのファイルは他のドキュメントと共有しうるので消さない。
///
/// # Errors
///
/// 見つからなければ `NotFound`。
pub fn delete(conn: &mut Connection, id: &str) -> Result<(), AppError> {
    let tx = conn.transaction()?;
    if tx.execute("DELETE FROM documents WHERE id = ?1", [id])? == 0 {
        return Err(AppError::NotFound(format!("ドキュメント {id}")));
    }
    delete_unused_tags(&tx)?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::fixtures::{self, section};
    use crate::db::test_conn;

    type Mutation = Box<dyn Fn(&mut DocUpsertInput)>;

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).expect("数えられる")
    }

    fn fts_count(conn: &Connection, query: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM fts_sections WHERE fts_sections MATCH ?1",
            [query],
            |r| r.get(0),
        )
        .expect("FTS を引ける")
    }

    #[test]
    fn upsert_then_get_roundtrips() {
        let mut conn = test_conn();
        let id = upsert(&mut conn, &fixtures::cpr()).expect("保存できる");
        let doc = get(&conn, &id).expect("取得できる");
        assert_eq!(doc.summary.title, "心停止と CPR");
        assert_eq!(doc.summary.meta.mod_version.as_deref(), Some("1.5.36"));
        assert_eq!(doc.summary.meta.tags, ["循環"]);
        assert_eq!(doc.summary.section_count, 1);
        assert_eq!(doc.sections[0].anchor, "cpr-steps");
        assert!(doc.summary.created_at.ends_with('Z'));
    }

    #[test]
    fn upsert_computes_parents_from_levels() {
        let mut conn = test_conn();
        let mut input = fixtures::bleeding();
        input.sections = vec![
            section(0, "", "intro", "導入", &[]),
            section(1, "A", "a", "a", &[]),
            section(2, "A-1", "a-1", "a1", &[]),
            section(3, "A-1-x", "a-1-x", "a1x", &[]),
            section(2, "A-2", "a-2", "a2", &[]),
            section(1, "B", "b", "b", &[]),
        ];
        let id = upsert(&mut conn, &input).expect("保存できる");
        let doc = get(&conn, &id).expect("取得できる");
        let ids: HashMap<&str, i64> = doc
            .sections
            .iter()
            .map(|s| (s.anchor.as_str(), s.id))
            .collect();
        let parent = |anchor: &str| {
            doc.sections
                .iter()
                .find(|s| s.anchor == anchor)
                .and_then(|s| s.parent_id)
        };
        assert_eq!(parent("intro"), None);
        assert_eq!(parent("a"), None);
        assert_eq!(parent("a-1"), Some(ids["a"]));
        assert_eq!(parent("a-1-x"), Some(ids["a-1"]));
        assert_eq!(parent("a-2"), Some(ids["a"]));
        assert_eq!(parent("b"), None);
    }

    #[test]
    fn upsert_same_source_path_replaces_and_keeps_id() {
        let mut conn = test_conn();
        let first = upsert(&mut conn, &fixtures::tourniquet()).expect("保存できる");
        let created_at = get(&conn, &first).expect("取得できる").summary.created_at;

        let mut changed = fixtures::tourniquet();
        changed.sections = vec![section(
            1,
            "外し方",
            "remove",
            "【要確認】緩めるときの注意。",
            &[],
        )];
        let second = upsert(&mut conn, &changed).expect("置き換えられる");

        assert_eq!(first, second, "id が変わっている");
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM documents"), 1);
        let doc = get(&conn, &second).expect("取得できる");
        assert_eq!(doc.summary.created_at, created_at);
        assert_eq!(doc.sections.len(), 1);
        // 古いセクションは索引からも消えている
        assert_eq!(fts_count(&conn, "\"大量出血\""), 0);
        assert_eq!(fts_count(&conn, "\"緩める\""), 1);
    }

    #[test]
    fn documents_without_source_path_are_not_merged() {
        let mut conn = test_conn();
        let mut input = fixtures::cpr();
        input.source_path = None;
        let a = upsert(&mut conn, &input).expect("保存できる");
        let b = upsert(&mut conn, &input).expect("保存できる");
        assert_ne!(a, b);
    }

    #[test]
    fn rejects_invalid_input() {
        let mut conn = test_conn();
        let cases: Vec<(&str, Mutation)> = vec![
            ("空のタイトル", Box::new(|d| d.title = "  ".to_owned())),
            ("レベル 7", Box::new(|d| d.sections[0].level = 7)),
            (
                "anchor の重複",
                Box::new(|d| d.sections[1].anchor = d.sections[0].anchor.clone()),
            ),
            (
                "日付の形式",
                Box::new(|d| d.meta.verified_at = Some("2026/09/25".to_owned())),
            ),
            (
                "存在しないアセット",
                Box::new(|d| d.asset_ids = vec!["0".repeat(64)]),
            ),
        ];
        for (name, mutate) in cases {
            let mut input = fixtures::bleeding();
            mutate(&mut input);
            let err = upsert(&mut conn, &input).expect_err(name);
            assert!(matches!(err, AppError::InvalidInput(_)), "{name}: {err}");
        }
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM documents"), 0);
    }

    #[test]
    fn tags_are_normalized_and_shared() {
        let mut conn = test_conn();
        let mut a = fixtures::cpr();
        a.meta.tags = vec!["#CPR".to_owned(), "cpr".to_owned()];
        let mut b = fixtures::tourniquet();
        b.meta.tags = vec!["Cpr".to_owned()];
        let id = upsert(&mut conn, &a).expect("保存できる");
        upsert(&mut conn, &b).expect("保存できる");
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM tags"), 1);
        assert_eq!(
            get(&conn, &id).expect("取得できる").summary.meta.tags,
            ["CPR"]
        );
    }

    #[test]
    fn list_includes_tags_and_counts() {
        let mut conn = test_conn();
        upsert(&mut conn, &fixtures::bleeding()).expect("保存できる");
        upsert(&mut conn, &fixtures::cpr()).expect("保存できる");
        let docs = list(&conn).expect("一覧を取れる");
        assert_eq!(docs.len(), 2);
        let bleeding = docs.iter().find(|d| d.title == "出血").expect("出血がある");
        assert_eq!(bleeding.section_count, 2);
        assert_eq!(bleeding.meta.tags, ["出血"]);
    }

    #[test]
    fn section_update_is_reflected_in_index() {
        let mut conn = test_conn();
        upsert(&mut conn, &fixtures::cpr()).expect("保存できる");
        conn.execute(
            "UPDATE sections SET plain_text = '【要確認】胸骨圧迫を続ける。' WHERE anchor = 'cpr-steps'",
            [],
        )
        .expect("更新できる");
        assert_eq!(fts_count(&conn, "\"胸骨圧迫\""), 1);
        assert_eq!(fts_count(&conn, "\"心停止\""), 0);
    }

    #[test]
    fn delete_cascades_everything() {
        let mut conn = test_conn();
        conn.execute(
            "INSERT INTO assets (id, mime, file_name, rel_path, size) VALUES ('a1', 'image/png', 'x.png', 'assets/a1.png', 1)",
            [],
        )
        .expect("アセットを入れられる");
        let mut input = fixtures::bleeding();
        input.asset_ids = vec!["a1".to_owned()];
        let id = upsert(&mut conn, &input).expect("保存できる");
        assert_eq!(fts_count(&conn, "\"見分け方\""), 1);

        delete(&mut conn, &id).expect("削除できる");
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM sections"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM section_tags"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM document_tags"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM document_assets"), 0);
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM tags"),
            0,
            "使われないタグが残っている"
        );
        assert_eq!(fts_count(&conn, "\"見分け方\""), 0);
        // アセット本体は共有されうるので残す
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM assets"), 1);

        assert!(matches!(delete(&mut conn, &id), Err(AppError::NotFound(_))));
        assert!(matches!(get(&conn, &id), Err(AppError::NotFound(_))));
    }
}
