//! セクションの全文検索と、フローの検索。仕様は dev-docs/reference/data-model.md §3。

use rusqlite::types::Value;
use rusqlite::{Connection, params_from_iter};

use super::text::{
    TRIGRAM_MIN_CHARS, char_len, contains_ci, fts_quote, like_pattern, make_snippet,
    normalize_tags, split_terms,
};
use crate::error::AppError;
use crate::model::{FlowHit, SearchFilter, SearchHit, SectionHit};

pub const DEFAULT_LIMIT: u32 = 20;
pub const MAX_LIMIT: u32 = 100;

/// 同義語でだけヒットした行のスコアに掛ける係数。
/// 並び順は別に「元の語でヒットした行が先」と決めているので、これは Step 05 で種類をまたいで並べるときのための値。
const SYNONYM_PENALTY: f64 = 0.8;
/// 同義語の減点で順位が入れ替わる分を見込んで、SQL では多めに取ってから絞る。
const CANDIDATE_FACTOR: u32 = 3;
/// bm25 の列の重み（`title`, `keywords`, `plain_text`）。見出しやタグに出る語ほどその節の主題なので重くする。
const BM25_WEIGHTS: &str = "10.0, 5.0, 1.0";
const SNIPPET_CONTEXT_CHARS: usize = 20;

/// 入力した 1 語と、同義語で広げた候補。
struct TermGroup {
    original: String,
    alternatives: Vec<String>,
}

impl TermGroup {
    /// trigram は 3 文字未満の語を引けないので、候補がすべて 3 文字以上のときだけ FTS で探す。
    fn use_fts(&self) -> bool {
        self.alternatives
            .iter()
            .all(|a| char_len(a) >= TRIGRAM_MIN_CHARS)
    }

    fn found_in(&self, text: &str) -> bool {
        self.alternatives.iter().any(|a| contains_ci(text, a))
    }
}

impl Candidate {
    fn contains(&self, term: &str) -> bool {
        contains_ci(&self.title, term)
            || contains_ci(&self.keywords, term)
            || contains_ci(&self.plain_text, term)
    }
}

struct Candidate {
    id: i64,
    title: String,
    keywords: String,
    plain_text: String,
    anchor: String,
    document_id: String,
    document_title: String,
    fts: Option<(String, f64)>,
}

/// セクションとフローを検索する。
///
/// 並びは「タイトルに当たったフロー → 節 → ノードの文だけに当たったフロー」。
/// フローの LIKE と節の bm25 は点数を比べられないので、当たった場所で段を分ける（data-model.md §3）。
///
/// # Errors
///
/// DB の読み取りに失敗した場合。クエリの記号は語として扱うので、構文エラーにはならない。
pub fn search(
    conn: &Connection,
    query: &str,
    limit: Option<u32>,
    filter: &SearchFilter,
) -> Result<Vec<SearchHit>, AppError> {
    let terms = split_terms(query);
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let groups = terms
        .into_iter()
        .map(|t| expand(conn, t))
        .collect::<Result<Vec<_>, _>>()?;

    let candidates = if groups.iter().any(TermGroup::use_fts) {
        query_fts(conn, &groups, filter, limit * CANDIDATE_FACTOR)?
    } else {
        query_like(conn, &groups, filter, limit * CANDIDATE_FACTOR)?
    };

    let all_alternatives: Vec<String> = groups
        .iter()
        .flat_map(|g| g.alternatives.iter().cloned())
        .collect();
    let mut hits: Vec<SectionHit> = candidates
        .into_iter()
        .map(|c| {
            let synonym_only = groups.iter().any(|g| !c.contains(&g.original));
            let mut matched_terms: Vec<String> = Vec::new();
            for term in all_alternatives.iter().filter(|a| c.contains(a)) {
                // 語をまたいで同じ候補が出ることがある（「止血 止血帯」と同義語の展開など）
                if !matched_terms.iter().any(|m| m.eq_ignore_ascii_case(term)) {
                    matched_terms.push(term.clone());
                }
            }
            let (snippet, base_score) = match c.fts {
                // bm25 は小さいほど良いので、符号を反転して「大きいほど上位」に揃える
                Some((snippet, bm25)) => (snippet, -bm25),
                None => (
                    make_snippet(&c.plain_text, &all_alternatives, SNIPPET_CONTEXT_CHARS),
                    like_score(&groups, &c),
                ),
            };
            SectionHit {
                id: c.id,
                title: c.title,
                snippet,
                score: if synonym_only {
                    base_score * SYNONYM_PENALTY
                } else {
                    base_score
                },
                document_id: c.document_id,
                document_title: c.document_title,
                anchor: c.anchor,
                synonym_only,
                matched_terms,
            }
        })
        .collect();
    // bm25 はタイトルの重みが大きく、係数を掛けるだけでは同義語だけの行が元の語の行より上に来うる。
    // 利用者が打った語そのものを含む行を必ず先に見せるため、段を分けて並べる
    hits.sort_by(|a, b| {
        a.synonym_only
            .cmp(&b.synonym_only)
            .then(b.score.total_cmp(&a.score))
    });
    let limit = usize::try_from(limit).unwrap_or(usize::MAX);
    hits.truncate(limit);

    let (title_flows, body_flows): (Vec<_>, Vec<_>) =
        search_flows(conn, &groups, &all_alternatives, filter, limit)?
            .into_iter()
            .partition(|(title_match, _)| *title_match);
    let mut out: Vec<SearchHit> = title_flows
        .into_iter()
        .map(|(_, hit)| SearchHit::Flow(hit))
        .collect();
    out.extend(hits.into_iter().map(SearchHit::Section));
    out.extend(body_flows.into_iter().map(|(_, hit)| SearchHit::Flow(hit)));
    out.truncate(limit);
    Ok(out)
}

/// フローをタイトルとノードの文（`search_text`）の LIKE で探す。フローは数本なので FTS は使わない。
/// 返す bool は、すべての語がタイトルに当たったか。
fn search_flows(
    conn: &Connection,
    groups: &[TermGroup],
    alternatives: &[String],
    filter: &SearchFilter,
    limit: usize,
) -> Result<Vec<(bool, FlowHit)>, AppError> {
    // フローにタグはないので、タグで絞り込んでいるときは出さない
    if !normalize_tags(filter.tags.as_deref().unwrap_or_default()).is_empty() {
        return Ok(Vec::new());
    }
    let mut params = Vec::new();
    let mut conditions: Vec<String> = groups
        .iter()
        .map(|g| like_condition(g, &["f.title", "f.search_text"], &mut params))
        .collect();
    if let Some(targets) = filter.mod_targets.as_ref().filter(|t| !t.is_empty()) {
        let placeholders = vec!["?"; targets.len()].join(", ");
        conditions.push(format!(
            "EXISTS (SELECT 1 FROM json_each(f.mod_targets) WHERE value IN ({placeholders}))"
        ));
        params.extend(targets.iter().map(|t| Value::Text(t.as_str().to_owned())));
    }
    if let Some(channel) = filter.mod_channel {
        conditions.push("(f.mod_channel = ? OR f.mod_channel IS NULL)".to_owned());
        params.push(Value::Text(channel.as_str().to_owned()));
    }
    let sql = format!(
        "SELECT f.id, f.title, f.search_text FROM triage_flows f
         WHERE {} ORDER BY f.title COLLATE NOCASE, f.id",
        conditions.join(" AND ")
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(params), |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })?;
    let mut flows = Vec::new();
    for row in rows {
        let (id, title, search_text) = row?;
        let title_match = groups.iter().all(|g| g.found_in(&title));
        let synonym_only = groups
            .iter()
            .any(|g| !contains_ci(&title, &g.original) && !contains_ci(&search_text, &g.original));
        let base_score = if title_match { 3.0 } else { 1.0 };
        flows.push((
            title_match,
            FlowHit {
                id,
                snippet: make_snippet(&search_text, alternatives, SNIPPET_CONTEXT_CHARS),
                title,
                score: if synonym_only {
                    base_score * SYNONYM_PENALTY
                } else {
                    base_score
                },
                synonym_only,
            },
        ));
    }
    flows.sort_by(|(_, a), (_, b)| {
        a.synonym_only
            .cmp(&b.synonym_only)
            .then(b.score.total_cmp(&a.score))
    });
    flows.truncate(limit);
    Ok(flows)
}

/// LIKE には関連度がないので、どこに当たったかで点を付ける（タイトル一致を優先する仕様のため）。
fn like_score(groups: &[TermGroup], c: &Candidate) -> f64 {
    let mut score = 1.0;
    if groups.iter().all(|g| g.found_in(&c.title)) {
        score += 2.0;
    }
    if groups.iter().all(|g| g.found_in(&c.keywords)) {
        score += 1.0;
    }
    score
}

/// 同義語辞書で語を広げる。
fn expand(conn: &Connection, term: String) -> Result<TermGroup, AppError> {
    let mut stmt = conn.prepare_cached(
        "SELECT DISTINCT s2.term FROM synonyms s1
         JOIN synonyms s2 ON s2.group_id = s1.group_id
         WHERE s1.term = ?1
         ORDER BY s2.term",
    )?;
    let synonyms = stmt
        .query_map([&term], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let original_is_short = char_len(&term) < TRIGRAM_MIN_CHARS;
    let mut alternatives = vec![term.clone()];
    for synonym in synonyms {
        // 3 文字以上の語で探しているのに「CA」のような短い候補を足すと、LIKE で無関係な語（cardiac など）に大量に当たる
        if !original_is_short && char_len(&synonym) < TRIGRAM_MIN_CHARS {
            continue;
        }
        if !alternatives
            .iter()
            .any(|a| a.eq_ignore_ascii_case(&synonym))
        {
            alternatives.push(synonym);
        }
    }
    Ok(TermGroup {
        original: term,
        alternatives,
    })
}

/// 語ごとの LIKE 条件（候補の OR）。
fn like_condition(group: &TermGroup, columns: &[&str], params: &mut Vec<Value>) -> String {
    let mut ors = Vec::new();
    for alternative in &group.alternatives {
        for column in columns {
            ors.push(format!("{column} LIKE ? ESCAPE '\\'"));
            params.push(Value::Text(like_pattern(alternative)));
        }
    }
    format!("({})", ors.join(" OR "))
}

fn filter_conditions(filter: &SearchFilter, params: &mut Vec<Value>) -> Vec<String> {
    let mut conditions = Vec::new();
    // 空の配列は「条件なし」として扱う（何も選んでいない絞り込み UI から来るため）
    if let Some(targets) = filter.mod_targets.as_ref().filter(|t| !t.is_empty()) {
        let placeholders = vec!["?"; targets.len()].join(", ");
        conditions.push(format!("d.mod_target IN ({placeholders})"));
        params.extend(targets.iter().map(|t| Value::Text(t.as_str().to_owned())));
    }
    if let Some(channel) = filter.mod_channel {
        // 版を問わない原稿（NULL）はどちらの版でも読めるので含める
        conditions.push("(d.mod_channel = ? OR d.mod_channel IS NULL)".to_owned());
        params.push(Value::Text(channel.as_str().to_owned()));
    }
    for tag in normalize_tags(filter.tags.as_deref().unwrap_or_default()) {
        conditions.push(
            "(EXISTS (SELECT 1 FROM document_tags dt JOIN tags t ON t.id = dt.tag_id
                      WHERE dt.document_id = d.id AND t.name = ?)
              OR EXISTS (SELECT 1 FROM section_tags st JOIN tags t ON t.id = st.tag_id
                         WHERE st.section_id = s.id AND t.name = ?))"
                .to_owned(),
        );
        params.push(Value::Text(tag.clone()));
        params.push(Value::Text(tag));
    }
    conditions
}

const CANDIDATE_COLUMNS: &str = "s.id, s.title, s.keywords, s.plain_text, s.anchor, d.id, d.title";

fn query_fts(
    conn: &Connection,
    groups: &[TermGroup],
    filter: &SearchFilter,
    limit: u32,
) -> Result<Vec<Candidate>, AppError> {
    let match_expr = groups
        .iter()
        .filter(|g| g.use_fts())
        .map(|g| {
            let ors: Vec<String> = g.alternatives.iter().map(|a| fts_quote(a)).collect();
            format!("({})", ors.join(" OR "))
        })
        .collect::<Vec<_>>()
        .join(" AND ");

    let mut params = vec![Value::Text(match_expr)];
    let mut conditions = vec!["fts_sections MATCH ?".to_owned()];
    // 短い語は FTS で引けないので、同じ行に LIKE の条件として足す
    for group in groups.iter().filter(|g| !g.use_fts()) {
        conditions.push(like_condition(
            group,
            &["s.title", "s.keywords", "s.plain_text"],
            &mut params,
        ));
    }
    conditions.extend(filter_conditions(filter, &mut params));
    params.push(Value::Integer(i64::from(limit)));

    let sql = format!(
        "SELECT {CANDIDATE_COLUMNS},
                snippet(fts_sections, -1, char(57344), char(57345), '…', {SNIPPET_CONTEXT_CHARS}),
                bm25(fts_sections, {BM25_WEIGHTS}) AS rank_score
         FROM fts_sections
         JOIN sections s ON s.id = fts_sections.rowid
         JOIN documents d ON d.id = s.document_id
         WHERE {}
         ORDER BY rank_score
         LIMIT ?",
        conditions.join(" AND ")
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(params), |r| {
        Ok(Candidate {
            id: r.get(0)?,
            title: r.get(1)?,
            keywords: r.get(2)?,
            plain_text: r.get(3)?,
            anchor: r.get(4)?,
            document_id: r.get(5)?,
            document_title: r.get(6)?,
            fts: Some((r.get(7)?, r.get(8)?)),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn query_like(
    conn: &Connection,
    groups: &[TermGroup],
    filter: &SearchFilter,
    limit: u32,
) -> Result<Vec<Candidate>, AppError> {
    let mut params = Vec::new();
    let mut conditions: Vec<String> = groups
        .iter()
        .map(|g| like_condition(g, &["s.title", "s.keywords", "s.plain_text"], &mut params))
        .collect();
    conditions.extend(filter_conditions(filter, &mut params));
    // LIMIT の前にタイトル一致を上に寄せる（後で Rust 側でも点を付けるが、切り捨てで落とさないため）
    let title_match = groups
        .iter()
        .map(|g| like_condition(g, &["s.title"], &mut params))
        .collect::<Vec<_>>()
        .join(" AND ");
    params.push(Value::Integer(i64::from(limit)));

    let sql = format!(
        "SELECT {CANDIDATE_COLUMNS}
         FROM sections s
         JOIN documents d ON d.id = s.document_id
         WHERE {}
         ORDER BY ({title_match}) DESC, d.title, s.order_index
         LIMIT ?",
        conditions.join(" AND ")
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(params), |r| {
        Ok(Candidate {
            id: r.get(0)?,
            title: r.get(1)?,
            keywords: r.get(2)?,
            plain_text: r.get(3)?,
            anchor: r.get(4)?,
            document_id: r.get(5)?,
            document_title: r.get(6)?,
            fts: None,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::fixtures::{self, section};
    use crate::db::text::{MARK_END, MARK_START};
    use crate::db::{docs, test_conn, triage};
    use crate::model::{ModChannel, ModTarget};

    fn seeded() -> Connection {
        let mut conn = test_conn();
        for doc in [
            fixtures::bleeding(),
            fixtures::cpr(),
            fixtures::tourniquet(),
        ] {
            docs::upsert(&mut conn, &doc).expect("サンプルを保存できる");
        }
        conn
    }

    fn hits(conn: &Connection, query: &str) -> Vec<SectionHit> {
        hits_with(conn, query, &SearchFilter::default())
    }

    fn hits_with(conn: &Connection, query: &str, filter: &SearchFilter) -> Vec<SectionHit> {
        search(conn, query, None, filter)
            .unwrap_or_else(|e| panic!("「{query}」で検索できない: {e}"))
            .into_iter()
            .filter_map(|hit| match hit {
                SearchHit::Section(h) => Some(h),
                SearchHit::Flow(_) => None,
            })
            .collect()
    }

    fn anchors(hits: &[SectionHit]) -> Vec<&str> {
        hits.iter().map(|h| h.anchor.as_str()).collect()
    }

    fn flow_seeded() -> Connection {
        let conn = seeded();
        for flow in [
            triage::fixtures::flow(
                "casualty-first-contact",
                "負傷者を見つけたら",
                "最初の 60 秒でやること\n周囲は安全？\n止血帯で止血する",
            ),
            triage::fixtures::dev_flow("cpr-flow", "心停止の対応", "CPR を始める"),
        ] {
            triage::upsert(&conn, &flow).expect("フローを保存できる");
        }
        conn
    }

    /// 結果の並びを「種類:id または anchor」で返す。
    fn kinds(conn: &Connection, query: &str, filter: &SearchFilter) -> Vec<String> {
        search(conn, query, None, filter)
            .unwrap_or_else(|e| panic!("「{query}」で検索できない: {e}"))
            .into_iter()
            .map(|hit| match hit {
                SearchHit::Section(h) => format!("section:{}", h.anchor),
                SearchHit::Flow(h) => format!("flow:{}", h.id),
            })
            .collect()
    }

    fn first_flow(conn: &Connection, query: &str) -> FlowHit {
        search(conn, query, None, &SearchFilter::default())
            .expect("検索できる")
            .into_iter()
            .find_map(|h| match h {
                SearchHit::Flow(f) => Some(f),
                SearchHit::Section(_) => None,
            })
            .unwrap_or_else(|| panic!("「{query}」でフローが当たらない"))
    }

    #[test]
    fn flow_title_match_comes_first() {
        let conn = flow_seeded();
        assert_eq!(
            kinds(&conn, "負傷者", &SearchFilter::default()),
            ["flow:casualty-first-contact"]
        );
        let found = kinds(&conn, "心停止", &SearchFilter::default());
        assert_eq!(found[0], "flow:cpr-flow", "{found:?}");
        assert!(found.contains(&"section:cpr-steps".to_owned()));
    }

    #[test]
    fn flow_body_match_comes_after_sections() {
        let conn = flow_seeded();
        assert_eq!(
            kinds(&conn, "止血帯", &SearchFilter::default()),
            ["section:use-tourniquet", "flow:casualty-first-contact"]
        );
        let hit = first_flow(&conn, "止血帯");
        assert!(hit.snippet.contains(MARK_START), "{}", hit.snippet);
        assert!(!hit.synonym_only);
    }

    #[test]
    fn flows_use_synonyms() {
        let conn = flow_seeded();
        let hit = first_flow(&conn, "TQ");
        assert_eq!(hit.id, "casualty-first-contact");
        assert!(hit.synonym_only);
    }

    #[test]
    fn flows_follow_filters() {
        let conn = flow_seeded();
        let release = SearchFilter {
            mod_channel: Some(ModChannel::Release),
            ..SearchFilter::default()
        };
        assert!(!kinds(&conn, "心停止", &release).contains(&"flow:cpr-flow".to_owned()));
        let breathing = SearchFilter {
            mod_targets: Some(vec![ModTarget::Breathing]),
            ..SearchFilter::default()
        };
        assert_eq!(kinds(&conn, "心停止", &breathing), ["flow:cpr-flow"]);
        let tagged = SearchFilter {
            tags: Some(vec!["止血帯".to_owned()]),
            ..SearchFilter::default()
        };
        assert_eq!(
            kinds(&conn, "止血帯", &tagged),
            ["section:use-tourniquet"],
            "タグで絞るとフローは出ない"
        );
    }

    #[test]
    fn three_char_japanese_uses_fts_with_snippet() {
        let conn = seeded();
        let result = hits(&conn, "止血帯");
        assert_eq!(anchors(&result), ["use-tourniquet"]);
        let hit = &result[0];
        assert_eq!(hit.document_title, "止血帯");
        assert!(!hit.synonym_only);
        assert!(
            hit.snippet.contains(MARK_START) && hit.snippet.contains(MARK_END),
            "{}",
            hit.snippet
        );
    }

    #[test]
    fn ascii_term_is_case_insensitive() {
        let conn = seeded();
        assert_eq!(anchors(&hits(&conn, "CPR")), ["cpr-steps"]);
        assert_eq!(anchors(&hits(&conn, "cpr")), ["cpr-steps"]);
    }

    #[test]
    fn two_char_term_uses_like_and_prefers_title() {
        let conn = seeded();
        let result = hits(&conn, "出血");
        let found = anchors(&result);
        assert!(found.contains(&"bleeding") && found.contains(&"bleeding-signs"));
        assert!(
            found.contains(&"use-tourniquet"),
            "本文の「大量出血」にも当たる"
        );
        // タイトルに「出血」を含むセクションが、本文だけのものより上
        assert_eq!(*found.last().expect("結果がある"), "use-tourniquet");
        assert!(result[0].snippet.contains('\u{E000}'));
    }

    #[test]
    fn one_char_term_uses_like() {
        let conn = seeded();
        assert_eq!(hits(&conn, "血").len(), 3);
        assert!(hits(&conn, "鯨").is_empty());
    }

    #[test]
    fn symbols_do_not_break_the_query() {
        let conn = seeded();
        for query in [
            "\"",
            "*",
            "(",
            ")",
            "AND",
            "OR",
            "NOT",
            "NEAR(",
            "-",
            "^",
            ":",
            "%",
            "_",
            "\\",
            "\"止血帯",
            "止血帯*",
            "止血帯\"",
            "(止血帯)",
            "-出血",
            "title:止血帯",
            "【要確認】",
        ] {
            search(&conn, query, None, &SearchFilter::default())
                .unwrap_or_else(|e| panic!("「{query}」でエラー: {e}"));
        }
        // ワイルドカードとして解釈されず、文字として探す
        assert!(hits(&conn, "%").is_empty());
        assert!(hits(&conn, "_").is_empty());
        assert_eq!(hits(&conn, "【要確認】").len(), 4);
    }

    #[test]
    fn multiple_terms_are_anded() {
        let conn = seeded();
        assert_eq!(anchors(&hits(&conn, "止血帯 四肢")), ["use-tourniquet"]);
        assert_eq!(
            anchors(&hits(&conn, "止血帯\u{3000}四肢")),
            ["use-tourniquet"]
        );
        assert!(hits(&conn, "止血帯 CPR").is_empty());
    }

    #[test]
    fn long_and_short_terms_are_combined() {
        let conn = seeded();
        // 「心停止」は FTS、「行う」は LIKE で、同じ行に両方の条件を掛ける
        assert_eq!(anchors(&hits(&conn, "心停止 行う")), ["cpr-steps"]);
        assert!(hits(&conn, "心停止 四肢").is_empty());
    }

    #[test]
    fn empty_query_returns_nothing() {
        let conn = seeded();
        assert!(hits(&conn, "").is_empty());
        assert!(hits(&conn, " \u{3000} ").is_empty());
    }

    #[test]
    fn limit_is_respected() {
        let conn = seeded();
        let result =
            search(&conn, "要確認", Some(2), &SearchFilter::default()).expect("検索できる");
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn synonyms_expand_the_query() {
        let conn = seeded();
        for query in ["TQ", "tq", "ターニケット", "Tourniquet"] {
            let result = hits(&conn, query);
            assert_eq!(anchors(&result), ["use-tourniquet"], "{query}");
            assert!(result[0].synonym_only, "{query}");
        }
    }

    #[test]
    fn matched_terms_include_synonyms_found_in_the_section() {
        let conn = seeded();
        let result = hits(&conn, "TQ");
        // TQ そのものは節に無いので含めず、節に含まれる同義語（止血帯）を返す
        assert!(result[0].matched_terms.iter().any(|t| t == "止血帯"));
        assert!(
            !result[0]
                .matched_terms
                .iter()
                .any(|t| t.eq_ignore_ascii_case("tq"))
        );

        let result = hits(&conn, "止血帯 止血帯");
        assert_eq!(
            result[0]
                .matched_terms
                .iter()
                .filter(|t| *t == "止血帯")
                .count(),
            1
        );
    }

    #[test]
    fn literal_hits_rank_above_synonym_only_hits() {
        let mut conn = seeded();
        let literal = fixtures::doc(
            "ターニケットの呼び方",
            "sample://tq-name",
            None,
            None,
            &[],
            vec![section(
                1,
                "呼び方",
                "tq-name",
                "【要確認】ターニケットと呼ぶこともある。",
                &[],
            )],
        );
        docs::upsert(&mut conn, &literal).expect("保存できる");
        let result = hits(&conn, "ターニケット");
        assert_eq!(anchors(&result), ["tq-name", "use-tourniquet"]);
        assert!(!result[0].synonym_only);
        assert!(result[1].synonym_only);
    }

    #[test]
    fn short_synonyms_are_not_used_for_long_terms() {
        let mut conn = seeded();
        // 「心停止」の同義語「CA」を LIKE にすると、この本文に当たってしまう
        let noise = fixtures::doc(
            "無関係",
            "sample://noise",
            None,
            None,
            &[],
            vec![section(1, "Cascade", "noise", "cascade", &[])],
        );
        docs::upsert(&mut conn, &noise).expect("保存できる");
        assert_eq!(anchors(&hits(&conn, "心停止")), ["cpr-steps"]);
    }

    #[test]
    fn section_tags_are_searchable() {
        let conn = seeded();
        let result = hits(&conn, "圧迫止血");
        assert_eq!(anchors(&result), ["bleeding-signs"]);
    }

    #[test]
    fn filters_by_mod_target() {
        let conn = seeded();
        let filter = SearchFilter {
            mod_targets: Some(vec![ModTarget::Circulation]),
            ..SearchFilter::default()
        };
        assert_eq!(anchors(&hits_with(&conn, "要確認", &filter)), ["cpr-steps"]);
        let empty = SearchFilter {
            mod_targets: Some(Vec::new()),
            ..SearchFilter::default()
        };
        assert_eq!(
            hits_with(&conn, "要確認", &empty).len(),
            4,
            "空の配列は条件なし"
        );
    }

    #[test]
    fn channel_filter_keeps_channel_agnostic_docs() {
        let conn = seeded();
        let release = SearchFilter {
            mod_channel: Some(ModChannel::Release),
            ..SearchFilter::default()
        };
        let found = hits_with(&conn, "要確認", &release);
        assert_eq!(found.len(), 3);
        assert!(
            !anchors(&found).contains(&"cpr-steps"),
            "Dev だけの原稿は除く"
        );
        let dev = SearchFilter {
            mod_channel: Some(ModChannel::Dev),
            ..SearchFilter::default()
        };
        assert_eq!(hits_with(&conn, "要確認", &dev).len(), 4);
    }

    #[test]
    fn filters_by_document_or_section_tags() {
        let conn = seeded();
        let doc_tag = SearchFilter {
            tags: Some(vec!["止血帯".to_owned()]),
            ..SearchFilter::default()
        };
        assert_eq!(
            anchors(&hits_with(&conn, "要確認", &doc_tag)),
            ["use-tourniquet"]
        );
        let section_tag = SearchFilter {
            tags: Some(vec!["#圧迫止血".to_owned()]),
            ..SearchFilter::default()
        };
        assert_eq!(
            anchors(&hits_with(&conn, "出血", &section_tag)),
            ["bleeding-signs"]
        );
        let both = SearchFilter {
            tags: Some(vec!["出血".to_owned(), "圧迫止血".to_owned()]),
            ..SearchFilter::default()
        };
        assert_eq!(
            anchors(&hits_with(&conn, "要確認", &both)),
            ["bleeding-signs"]
        );
    }
}
