//! AI が呼ぶツールの中身。結果は AI の種類に依らない形（出典・題・段落）で返し、
//! API の形（Claude なら `search_result` ブロック）への変換は各 AI のモジュールで行う。

use serde::Deserialize;

use crate::ai::corpus::{
    Corpus, CorpusDoc, CorpusSection, condition_label, meets_mod_conditions, quickref_source,
    section_source,
};
use crate::ai::types::ClientRequest;
use crate::db::{Db, search};
use crate::error::AppError;
use crate::model::{ModTarget, QuickrefRow, SearchFilter, SearchHit};

pub const SEARCH_MANUAL: &str = "search_manual";
pub const READ_SECTION: &str = "read_section";
pub const ASK_USER: &str = "ask_user";

/// 検索で返す節の数。多いと入力が増え、少ないと言い換えの取りこぼしが増える
const MAX_SECTION_HITS: usize = 6;
const MAX_QUICKREF_HITS: usize = 3;
/// MOD で絞ると落ちる分を見込んで、検索からは多めに取る
const SEARCH_CANDIDATES: u32 = 100;
/// 検索の結果の 1 節あたりの上限（文字数）。長い節は `read_section` で全文を読ませる
const MAX_HIT_CHARS: usize = 3000;
/// `read_section` で返す上限（文字数）。配下の節まで含めると長くなるため
const MAX_READ_CHARS: usize = 12000;
/// 1 節を分ける段落の上限。引用の単位を細かくしつつ、ブロックの数を増やしすぎない
const MAX_PARAGRAPHS: usize = 40;
const MAX_QUERY_CHARS: usize = 200;
const MAX_QUESTION_CHARS: usize = 300;
const MAX_OPTION_CHARS: usize = 100;
const MIN_OPTIONS: usize = 2;
const MAX_OPTIONS: usize = 4;

/// 根拠になる文書 1 つ分（節 1 つ、またはクイック表の 1 行）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceDoc {
    pub source: String,
    pub title: String,
    pub paragraphs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolOutput {
    Sources(Vec<SourceDoc>),
    /// 根拠ではない知らせ（0 件だった、など）
    Text(String),
    /// 入力が不正・見つからない。AI に `is_error` で返し、やり直させる
    Error(String),
}

#[derive(Debug, Deserialize)]
struct SearchInput {
    query: String,
    include_other_mods: bool,
}

#[derive(Debug, Deserialize)]
struct ReadInput {
    source: String,
}

#[derive(Debug, Deserialize)]
struct AskInput {
    question: String,
    options: Vec<String>,
    multi_select: bool,
}

/// `search_manual` を実行する。
///
/// # Errors
///
/// DB の読み取りに失敗した場合。入力の誤りは `ToolOutput::Error` で返す。
pub async fn search_manual(
    db: &Db,
    corpus: &Corpus,
    active: &[ModTarget],
    input: &serde_json::Value,
) -> Result<ToolOutput, AppError> {
    let Ok(input) = serde_json::from_value::<SearchInput>(input.clone()) else {
        return Ok(ToolOutput::Error(
            "入力の形が違います（query と include_other_mods が要ります）".to_owned(),
        ));
    };
    let query = input.query.trim().to_owned();
    if query.is_empty() || query.chars().count() > MAX_QUERY_CHARS {
        return Ok(ToolOutput::Error(format!(
            "query は 1〜{MAX_QUERY_CHARS} 文字にしてください"
        )));
    }
    let q = query.clone();
    let hits = db
        .run(move |conn, _| {
            search::search(conn, &q, Some(SEARCH_CANDIDATES), &SearchFilter::default())
        })
        .await?;
    let docs = pick_hits(corpus, &hits, active, input.include_other_mods);
    if docs.is_empty() {
        return Ok(ToolOutput::Text(format!(
            "「{query}」に当たる節は見つかりませんでした。全文検索は文字が一致しないと当たりません。原稿の語に言い換えて探すか、索引から節を選んで read_section で読んでください。"
        )));
    }
    Ok(ToolOutput::Sources(docs))
}

/// 検索の結果から、AI に渡す節とクイック表の行を選ぶ。
fn pick_hits(
    corpus: &Corpus,
    hits: &[SearchHit],
    active: &[ModTarget],
    include_other_mods: bool,
) -> Vec<SourceDoc> {
    let fits = |mods: &[ModTarget], without: &[ModTarget]| {
        include_other_mods || meets_mod_conditions(mods, without, active)
    };
    let sections = hits
        .iter()
        .filter_map(|hit| match hit {
            SearchHit::Section(s) => corpus.section_by_id(s.id),
            _ => None,
        })
        .filter(|(_, s)| fits(&s.mods, &s.without_mods))
        .take(MAX_SECTION_HITS)
        .map(|(doc, s)| section_doc(doc, s, MAX_HIT_CHARS));
    let rows = hits
        .iter()
        .filter_map(|hit| match hit {
            SearchHit::Quickref(q) => corpus.quickref_row(&q.id),
            _ => None,
        })
        .filter(|row| fits(&row.mods, &row.without_mods))
        .take(MAX_QUICKREF_HITS)
        .map(quickref_doc);
    sections.chain(rows).collect()
}

/// `read_section` を実行する。MOD では絞らない（AI が節を名指しで求めたため）。
#[must_use]
pub fn read_section(corpus: &Corpus, input: &serde_json::Value) -> ToolOutput {
    let Ok(input) = serde_json::from_value::<ReadInput>(input.clone()) else {
        return ToolOutput::Error("入力の形が違います（source が要ります）".to_owned());
    };
    let source = input.source.trim();
    if let Some(id) = source.strip_prefix("quickref:") {
        return corpus.quickref_row(id).map_or_else(
            || ToolOutput::Error(format!("クイック表に {source} はありません")),
            |row| ToolOutput::Sources(vec![quickref_doc(row)]),
        );
    }
    let Some((doc, list)) = corpus.section_with_descendants(source) else {
        let near = corpus.suggestions(source, 10);
        return ToolOutput::Error(if near.is_empty() {
            format!("{source} という節はありません。索引の source をそのまま使ってください")
        } else {
            format!(
                "{source} という節はありません。索引の source をそのまま使ってください。近い節: {}",
                near.join("、")
            )
        });
    };
    let mut budget = MAX_READ_CHARS;
    let mut docs = Vec::new();
    for section in list {
        if budget == 0 {
            break;
        }
        let item = section_doc(doc, section, budget);
        budget = budget.saturating_sub(item.paragraphs.iter().map(|p| p.chars().count()).sum());
        docs.push(item);
    }
    ToolOutput::Sources(docs)
}

/// `ask_user` の入力を検査して、画面への要求にする。
///
/// # Errors
///
/// 入力の形が違う・長さが範囲外のとき、AI に返す文面。
pub fn ask_user_request(input: &serde_json::Value) -> Result<ClientRequest, String> {
    let input = serde_json::from_value::<AskInput>(input.clone()).map_err(|_| {
        "入力の形が違います（question・options・multi_select が要ります）".to_owned()
    })?;
    let question = input.question.trim().to_owned();
    if question.is_empty() || question.chars().count() > MAX_QUESTION_CHARS {
        return Err(format!(
            "question は 1〜{MAX_QUESTION_CHARS} 文字にしてください"
        ));
    }
    let options: Vec<String> = input
        .options
        .iter()
        .map(|o| o.trim().to_owned())
        .filter(|o| !o.is_empty())
        .collect();
    if !(MIN_OPTIONS..=MAX_OPTIONS).contains(&options.len())
        || options.iter().any(|o| o.chars().count() > MAX_OPTION_CHARS)
    {
        return Err(format!(
            "options は {MIN_OPTIONS}〜{MAX_OPTIONS} 個、それぞれ {MAX_OPTION_CHARS} 文字までにしてください"
        ));
    }
    Ok(ClientRequest::AskUser {
        question,
        options,
        multi_select: input.multi_select,
    })
}

// title は引用の見出しとして画面にそのまま出るので、AI 向けのメモ（MOD の条件・図あり）は本文の頭に置く
fn section_doc(doc: &CorpusDoc, section: &CorpusSection, max_chars: usize) -> SourceDoc {
    let title = if section.level == 0 {
        doc.title.clone()
    } else {
        format!("{} > {}", doc.title, section.title)
    };
    let mut notes = Vec::new();
    if let Some(label) = condition_label(&section.mods, &section.without_mods) {
        notes.push(label);
    }
    if section.has_figure {
        notes.push("図あり".to_owned());
    }
    let mut lines = paragraphs(&section.text, max_chars);
    if !notes.is_empty() {
        lines.insert(0, format!("（この節: {}）", notes.join("・")));
    }
    SourceDoc {
        source: section_source(&doc.file, &section.anchor),
        title,
        paragraphs: lines,
    }
}

fn quickref_doc(row: &QuickrefRow) -> SourceDoc {
    let title = format!("クイック表 > {}", row.symptom);
    let mut lines = vec![format!("分類: {}", row.category)];
    if let Some(label) = condition_label(&row.mods, &row.without_mods) {
        lines.push(format!("条件: {label}"));
    }
    lines.push(format!("重症度: {}（1=軽度〜4=致命的）", row.severity));
    lines.extend(
        row.treatment
            .iter()
            .enumerate()
            .map(|(i, step)| format!("手順 {}: {step}", i + 1)),
    );
    if !row.items.is_empty() {
        lines.push(format!("物品: {}", row.items.join("、")));
    }
    if let Some(notes) = row.notes.as_deref().filter(|n| !n.trim().is_empty()) {
        lines.push(format!("備考: {notes}"));
    }
    if !row.links.is_empty() {
        lines.push(format!("関連: {}", row.links.join("、")));
    }
    SourceDoc {
        source: quickref_source(&row.id),
        title,
        paragraphs: lines,
    }
}

/// 本文を行ごとに分ける。引用（`cited_text`）を節全体ではなく該当の行にするため。
fn paragraphs(text: &str, max_chars: usize) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    let mut used = 0;
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let len = line.chars().count();
        if used + len > max_chars {
            let rest = max_chars.saturating_sub(used);
            if rest > 0 {
                lines.push(format!(
                    "{}…（以下略。read_section で続きを読めます）",
                    line.chars().take(rest).collect::<String>()
                ));
            }
            break;
        }
        used += len;
        lines.push(line.to_owned());
    }
    if lines.len() > MAX_PARAGRAPHS {
        let tail = lines.split_off(MAX_PARAGRAPHS - 1).join("\n");
        lines.push(tail);
    }
    if lines.is_empty() {
        // 本文のない見出し（配下の節だけを持つ入れ物）も、読んだことが分かるように 1 行入れる
        lines.push("（この見出しの直下に本文はありません）".to_owned());
    }
    lines
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::ai::corpus::fixtures;
    use crate::model::SectionHit;

    fn section_hit(id: i64) -> SearchHit {
        SearchHit::Section(SectionHit {
            id,
            title: String::new(),
            snippet: String::new(),
            score: 0.0,
            document_id: String::new(),
            document_title: String::new(),
            anchor: String::new(),
            synonym_only: false,
            matched_terms: Vec::new(),
        })
    }

    #[test]
    fn hits_are_filtered_by_the_active_mods() {
        let corpus = fixtures::corpus();
        let hits: Vec<SearchHit> = [2, 4, 5, 99].into_iter().map(section_hit).collect();
        let with_circ = pick_hits(&corpus, &hits, &[ModTarget::Circulation], false);
        let titles: Vec<&str> = with_circ.iter().map(|d| d.title.as_str()).collect();
        assert_eq!(
            titles,
            vec!["出血 > 止血帯を使う", "出血 > Circulation の止血"]
        );
        let all = pick_hits(&corpus, &hits, &[ModTarget::Circulation], true);
        assert_eq!(
            all.len(),
            3,
            "include_other_mods なら条件の合わない節も返す"
        );
    }

    #[test]
    fn section_source_and_paragraphs() {
        let corpus = fixtures::corpus();
        let docs = pick_hits(&corpus, &[section_hit(2)], &[], false);
        assert_eq!(docs[0].source, "doc:hemorrhage.md#止血帯を使う");
        // 図ありのメモは、画面に引用の見出しとして出る title ではなく、本文の頭に置く
        assert_eq!(docs[0].title, "出血 > 止血帯を使う");
        assert_eq!(
            docs[0].paragraphs,
            vec![
                "（この節: 図あり）",
                "腕か脚に巻く。",
                "巻いた時刻を覚える。"
            ]
        );
    }

    #[test]
    fn read_section_includes_descendants() {
        let corpus = fixtures::corpus();
        let ToolOutput::Sources(docs) = read_section(
            &corpus,
            &json!({"source": "doc:hemorrhage.md#止血帯を使う"}),
        ) else {
            panic!("節を読める");
        };
        let sources: Vec<&str> = docs.iter().map(|d| d.source.as_str()).collect();
        assert_eq!(
            sources,
            vec![
                "doc:hemorrhage.md#止血帯を使う",
                "doc:hemorrhage.md#巻く位置",
                "doc:hemorrhage.md#Circulation の止血",
                "doc:hemorrhage.md#Circulation なしの止血",
            ]
        );
    }

    #[test]
    fn read_section_suggests_near_sections() {
        let corpus = fixtures::corpus();
        let ToolOutput::Error(message) =
            read_section(&corpus, &json!({"source": "doc:hemorrhage.md#止血帯"}))
        else {
            panic!("見つからない");
        };
        assert!(message.contains("doc:hemorrhage.md#止血帯を使う"));
        assert!(matches!(
            read_section(&corpus, &json!({})),
            ToolOutput::Error(_)
        ));
    }

    #[test]
    fn long_text_is_cut_with_a_note() {
        let text = format!("{}\n{}", "あ".repeat(10), "い".repeat(10));
        let lines = paragraphs(&text, 15);
        assert_eq!(lines.len(), 2);
        assert!(lines[1].starts_with("いいいいい…"));
    }

    #[test]
    fn many_lines_are_merged_into_the_last_paragraph() {
        let text = (0..50)
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        let lines = paragraphs(&text, 10_000);
        assert_eq!(lines.len(), MAX_PARAGRAPHS);
        assert!(lines.last().expect("ある").contains("49"));
    }

    #[test]
    fn ask_user_input_is_checked() {
        let ok = ask_user_request(
            &json!({"question": "呼吸は？", "options": ["ある", "ない"], "multi_select": false}),
        );
        assert_eq!(
            ok,
            Ok(ClientRequest::AskUser {
                question: "呼吸は？".to_owned(),
                options: vec!["ある".to_owned(), "ない".to_owned()],
                multi_select: false
            })
        );
        assert!(
            ask_user_request(&json!({"question": "x", "options": ["a"], "multi_select": false}))
                .is_err()
        );
        assert!(
            ask_user_request(
                &json!({"question": "", "options": ["a", "b"], "multi_select": false})
            )
            .is_err()
        );
        assert!(ask_user_request(&json!({"question": "x"})).is_err());
    }
}
