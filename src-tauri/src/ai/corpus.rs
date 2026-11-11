//! AI に渡す原稿の写し。会話を始めるときに DB から 1 回だけ読み、その会話の間は同じものを使う。
//!
//! 索引（system プロンプト）は thinking の署名に結び付くので、会話の途中で作り直すと次の要求が 400 になる。
//! 原稿は起動時の同期が終わってからしか変わらないので、写しを持っても古くならない。

use std::collections::{HashMap, HashSet, VecDeque};

use rusqlite::Connection;
use serde_json::Value;

use crate::db::{dict, docs, quickref, triage};
use crate::error::AppError;
use crate::model::{ModTarget, QuickrefRow};

/// 同梱した原稿の sourcePath の接頭辞（TS の `manualSourcePath` と同じ形）
const MANUAL_PREFIX: &str = "bundle://manuals/";

#[derive(Debug, Clone)]
pub struct CorpusSection {
    pub id: i64,
    pub level: u8,
    pub title: String,
    pub anchor: String,
    pub text: String,
    pub tags: Vec<String>,
    pub mods: Vec<ModTarget>,
    pub without_mods: Vec<ModTarget>,
    /// グラフ・フローチャート・画像がある
    pub has_figure: bool,
}

#[derive(Debug, Clone)]
pub struct CorpusDoc {
    /// 原稿のファイル名（`hemorrhage.md`）
    pub file: String,
    pub title: String,
    pub sections: Vec<CorpusSection>,
}

/// トリアージのフロー。AI が作者の手順で答えられるよう、手順を読める行にして持つ。
#[derive(Debug, Clone)]
pub struct CorpusFlow {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    /// この MOD をすべて入れているときのフロー
    pub mods: Vec<ModTarget>,
    /// 始まりから辿った順の手順（1 行 1 ノード）
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Corpus {
    pub docs: Vec<CorpusDoc>,
    pub quickref: Vec<QuickrefRow>,
    pub flows: Vec<CorpusFlow>,
    pub synonyms: Vec<Vec<String>>,
    by_id: HashMap<i64, (usize, usize)>,
    by_source: HashMap<String, (usize, usize)>,
}

/// 節を指す文字列。原稿の内部リンク・フローのリンクと同じ `doc:<ファイル名>#<アンカー>` の形にする。
/// 見出しの前の導入部（アンカーなし）は `doc:<ファイル名>` にする。
#[must_use]
pub fn section_source(file: &str, anchor: &str) -> String {
    if anchor.is_empty() {
        format!("doc:{file}")
    } else {
        format!("doc:{file}#{anchor}")
    }
}

#[must_use]
pub fn quickref_source(id: &str) -> String {
    format!("quickref:{id}")
}

#[must_use]
pub fn flow_source(id: &str) -> String {
    format!("flow:{id}")
}

impl Corpus {
    #[must_use]
    pub fn new(
        docs: Vec<CorpusDoc>,
        quickref: Vec<QuickrefRow>,
        synonyms: Vec<Vec<String>>,
    ) -> Self {
        let mut by_id = HashMap::new();
        let mut by_source = HashMap::new();
        for (d, doc) in docs.iter().enumerate() {
            for (s, section) in doc.sections.iter().enumerate() {
                by_id.insert(section.id, (d, s));
                by_source.insert(section_source(&doc.file, &section.anchor), (d, s));
            }
        }
        Self {
            docs,
            quickref,
            flows: Vec::new(),
            synonyms,
            by_id,
            by_source,
        }
    }

    #[must_use]
    pub fn section_by_id(&self, id: i64) -> Option<(&CorpusDoc, &CorpusSection)> {
        self.by_id.get(&id).map(|&(d, s)| self.at(d, s))
    }

    #[must_use]
    pub fn section_by_source(&self, source: &str) -> Option<(&CorpusDoc, &CorpusSection)> {
        self.locate(source).map(|(d, s)| self.at(d, s))
    }

    /// 節と、その配下の節（見出しのレベルが深いもの）を本文の順に返す。
    #[must_use]
    pub fn section_with_descendants(
        &self,
        source: &str,
    ) -> Option<(&CorpusDoc, Vec<&CorpusSection>)> {
        let (d, s) = self.locate(source)?;
        let doc = &self.docs[d];
        let head = &doc.sections[s];
        let mut list = vec![head];
        // 導入部（level 0）は配下を持たない。文書の全体を返さないため
        if head.level > 0 {
            list.extend(
                doc.sections[s + 1..]
                    .iter()
                    .take_while(|c| c.level > head.level),
            );
        }
        Some((doc, list))
    }

    #[must_use]
    pub fn with_flows(mut self, flows: Vec<CorpusFlow>) -> Self {
        self.flows = flows;
        self
    }

    #[must_use]
    pub fn flow(&self, id: &str) -> Option<&CorpusFlow> {
        self.flows.iter().find(|f| f.id == id)
    }

    #[must_use]
    pub fn quickref_row(&self, id: &str) -> Option<&QuickrefRow> {
        self.quickref.iter().find(|r| r.id == id)
    }

    fn locate(&self, source: &str) -> Option<(usize, usize)> {
        self.by_source.get(source).copied()
    }

    fn at(&self, d: usize, s: usize) -> (&CorpusDoc, &CorpusSection) {
        let doc = &self.docs[d];
        (doc, &doc.sections[s])
    }

    /// 見つからなかった source に近い節（同じ文書の見出し、または見出しに語を含む節）。
    #[must_use]
    pub fn suggestions(&self, source: &str, limit: usize) -> Vec<String> {
        let rest = source.strip_prefix("doc:").unwrap_or(source);
        let (file, anchor) = rest.split_once('#').unwrap_or((rest, ""));
        let mut out = Vec::new();
        for doc in &self.docs {
            for section in &doc.sections {
                let same_doc = doc.file == file;
                let similar = !anchor.is_empty()
                    && (section.title.contains(anchor) || anchor.contains(section.title.as_str()));
                if (same_doc && section.level > 0) || similar {
                    out.push(section_source(&doc.file, &section.anchor));
                }
                if out.len() >= limit {
                    return out;
                }
            }
        }
        out
    }
}

/// DB から原稿の写しを作る。同梱の原稿（`bundle://manuals/`）だけを対象にし、開発用のダミーは含めない。
///
/// # Errors
///
/// DB の読み取りに失敗した場合。
pub fn load(conn: &Connection) -> Result<Corpus, AppError> {
    let mut sections: HashMap<String, Vec<CorpusSection>> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT document_id, id, level, title, anchor, plain_text, keywords, mods, without_mods,
           instr(html, 'data-chart') > 0 OR instr(html, 'data-flowchart') > 0
             OR instr(html, 'data-asset-id') > 0
         FROM sections ORDER BY document_id, order_index",
    )?;
    let rows = stmt.query_map([], |r| {
        let keywords: String = r.get(6)?;
        Ok((
            r.get::<_, String>(0)?,
            CorpusSection {
                id: r.get(1)?,
                level: r.get(2)?,
                title: r.get(3)?,
                anchor: r.get(4)?,
                text: r.get(5)?,
                tags: keywords.split_whitespace().map(str::to_owned).collect(),
                mods: json_column(r, 7)?,
                without_mods: json_column(r, 8)?,
                has_figure: r.get(9)?,
            },
        ))
    })?;
    for row in rows {
        let (doc_id, section) = row?;
        sections.entry(doc_id).or_default().push(section);
    }

    let docs = docs::list(conn)?
        .into_iter()
        .filter_map(|doc| {
            let file = doc
                .source_path
                .as_deref()?
                .strip_prefix(MANUAL_PREFIX)?
                .to_owned();
            Some(CorpusDoc {
                file,
                title: doc.title,
                sections: sections.remove(&doc.id).unwrap_or_default(),
            })
        })
        .collect();
    let quickref = quickref::list(conn)?.rows;
    let synonyms = dict::synonym_list(conn)?
        .into_iter()
        .map(|g| g.terms)
        .filter(|terms| terms.len() > 1)
        .collect();
    let flows = triage::list(conn)?
        .into_iter()
        .map(|summary| {
            let detail = triage::get(conn, &summary.id)?;
            // 形は保存のときに検査済み。読めなければ手順なしで題だけ渡す
            let json: Value = serde_json::from_str(&detail.json).unwrap_or(Value::Null);
            Ok(CorpusFlow {
                id: summary.id,
                title: summary.title,
                description: summary.description,
                // core と general は常に有効なので、条件として AI に見せない（どのフローにも「Core あり」が付くため）
                mods: summary
                    .mod_targets
                    .into_iter()
                    .filter(|m| !ALWAYS_ACTIVE.contains(m))
                    .collect(),
                lines: flow_lines(&json),
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    Ok(Corpus::new(docs, quickref, synonyms).with_flows(flows))
}

/// フローの JSON を、始まりから辿った順の行にする。どのノードからどこへ進むかを AI が追えるよう、行の頭に id を付ける。
fn flow_lines(flow: &Value) -> Vec<String> {
    let Some(nodes) = flow.get("nodes").and_then(Value::as_object) else {
        return Vec::new();
    };
    let start = flow
        .get("start")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut order: Vec<&str> = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();
    let mut queue = VecDeque::from([start]);
    while let Some(id) = queue.pop_front() {
        let Some(node) = nodes.get(id) else {
            continue;
        };
        if !seen.insert(id) {
            continue;
        }
        order.push(id);
        queue.extend(node_targets(node));
    }
    // 始まりから辿れないノードも落とさない
    order.extend(
        nodes
            .keys()
            .map(String::as_str)
            .filter(|id| !seen.contains(id)),
    );
    order
        .into_iter()
        .filter_map(|id| nodes.get(id).map(|node| node_line(id, node)))
        .collect()
}

fn str_field<'a>(node: &'a Value, key: &str) -> &'a str {
    node.get(key).and_then(Value::as_str).unwrap_or_default()
}

fn node_targets(node: &Value) -> Vec<&str> {
    let mut out = Vec::new();
    for key in ["next", "else"] {
        if let Some(next) = node.get(key).and_then(Value::as_str) {
            out.push(next);
        }
    }
    if let Some(next) = node
        .get("ifMissing")
        .and_then(|m| m.get("next"))
        .and_then(Value::as_str)
    {
        out.push(next);
    }
    for key in ["choices", "cases"] {
        if let Some(list) = node.get(key).and_then(Value::as_array) {
            out.extend(
                list.iter()
                    .filter_map(|c| c.get("next").and_then(Value::as_str)),
            );
        }
    }
    out
}

fn node_line(id: &str, node: &Value) -> String {
    let text = str_field(node, "text");
    let help = str_field(node, "help");
    let help = if help.is_empty() {
        String::new()
    } else {
        format!(" 補足: {help}")
    };
    let next = node
        .get("next")
        .and_then(Value::as_str)
        .map(|n| format!(" 次 → {n}"))
        .unwrap_or_default();
    match str_field(node, "type") {
        "question" => {
            let choices: Vec<String> = node
                .get("choices")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .map(|c| format!("{} → {}", str_field(c, "label"), str_field(c, "next")))
                        .collect()
                })
                .unwrap_or_default();
            format!("[{id}] 質問: {text}{help} 選択肢: {}", choices.join(" / "))
        }
        "action" => {
            let items: Vec<&str> = node
                .get("items")
                .and_then(Value::as_array)
                .map(|list| list.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            let items = if items.is_empty() {
                String::new()
            } else {
                format!(" 物品: {}", items.join("、"))
            };
            let missing = node
                .get("ifMissing")
                .and_then(|m| m.get("next"))
                .and_then(Value::as_str)
                .map(|n| format!(" 物品がなければ → {n}"))
                .unwrap_or_default();
            format!("[{id}] 処置: {text}{help}{items}{missing}{next}")
        }
        "end" => format!(
            "[{id}] 終わり（{}）: {text}{help}",
            str_field(node, "outcome")
        ),
        "subflow" => format!(
            "[{id}] 別のフロー {} を行う。終わったら{next}",
            flow_source(str_field(node, "flowId"))
        ),
        "branch" => {
            let cases: Vec<String> = node
                .get("cases")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .map(|c| {
                            let mods: Vec<ModTarget> = c
                                .get("mods")
                                .cloned()
                                .and_then(|m| serde_json::from_value(m).ok())
                                .unwrap_or_default();
                            format!(
                                "{}なら → {}",
                                condition_label(&mods, &[]).unwrap_or_default(),
                                str_field(c, "next")
                            )
                        })
                        .collect()
                })
                .unwrap_or_default();
            format!(
                "[{id}] 分岐: {}、それ以外 → {}",
                cases.join("、"),
                str_field(node, "else")
            )
        }
        other => format!("[{id}] {other}: {text}{help}{next}"),
    }
}

fn json_column(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<Vec<ModTarget>> {
    let text: String = row.get(index)?;
    serde_json::from_str(&text).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, Box::new(e))
    })
}

/// core と general は常に有効（TS の `ALWAYS_ACTIVE_MODS` と同じ）
const ALWAYS_ACTIVE: [ModTarget; 2] = [ModTarget::Core, ModTarget::General];

fn mods_active(required: &[ModTarget], active: &[ModTarget]) -> bool {
    required
        .iter()
        .all(|m| ALWAYS_ACTIVE.contains(m) || active.contains(m))
}

/// 設定の「使っている MOD」に合うか（TS の `meetsModConditions` と同じ判定）。
#[must_use]
pub fn meets_mod_conditions(
    mods: &[ModTarget],
    without_mods: &[ModTarget],
    active: &[ModTarget],
) -> bool {
    mods_active(mods, active) && !without_mods.iter().any(|m| mods_active(&[*m], active))
}

/// 「Circulation あり・Breathing なし」の形。条件がなければ None。
#[must_use]
pub fn condition_label(mods: &[ModTarget], without_mods: &[ModTarget]) -> Option<String> {
    let parts: Vec<String> = mods
        .iter()
        .map(|m| format!("{} あり", mod_label(*m)))
        .chain(
            without_mods
                .iter()
                .map(|m| format!("{} なし", mod_label(*m))),
        )
        .collect();
    (!parts.is_empty()).then(|| parts.join("・"))
}

/// TS の `MOD_TARGET_LABELS` と同じ表記
#[must_use]
pub const fn mod_label(m: ModTarget) -> &'static str {
    match m {
        ModTarget::Core => "Core",
        ModTarget::Hitzones => "Hitzones",
        ModTarget::Circulation => "Circulation",
        ModTarget::Breathing => "Breathing",
        ModTarget::Defibrillation => "Defibrillation",
        ModTarget::Ai => "AI",
        ModTarget::General => "一般",
    }
}

#[cfg(test)]
pub mod fixtures {
    use super::*;

    #[must_use]
    pub fn section(id: i64, level: u8, title: &str, text: &str) -> CorpusSection {
        CorpusSection {
            id,
            level,
            title: title.to_owned(),
            anchor: if level == 0 {
                String::new()
            } else {
                title.to_owned()
            },
            text: text.to_owned(),
            tags: Vec::new(),
            mods: Vec::new(),
            without_mods: Vec::new(),
            has_figure: false,
        }
    }

    #[must_use]
    pub fn corpus() -> Corpus {
        let mut circ = section(4, 2, "Circulation の止血", "点滴で補う。");
        circ.mods = vec![ModTarget::Circulation];
        let mut no_circ = section(5, 2, "Circulation なしの止血", "包帯だけで止める。");
        no_circ.without_mods = vec![ModTarget::Circulation];
        let mut tq = section(
            2,
            1,
            "止血帯を使う",
            "腕か脚に巻く。\n\n巻いた時刻を覚える。",
        );
        tq.tags = vec!["止血".to_owned()];
        tq.has_figure = true;
        Corpus::new(
            vec![CorpusDoc {
                file: "hemorrhage.md".to_owned(),
                title: "出血".to_owned(),
                sections: vec![
                    section(1, 0, "出血", "出血の止め方。"),
                    tq,
                    section(3, 2, "巻く位置", "傷より心臓に近い側。"),
                    circ,
                    no_circ,
                    section(6, 1, "包帯", "傷に巻く。"),
                ],
            }],
            Vec::new(),
            vec![vec!["止血帯".to_owned(), "TQ".to_owned()]],
        )
        .with_flows(vec![
            CorpusFlow {
                id: "pain".to_owned(),
                title: "痛みを抑える".to_owned(),
                description: Some("モルヒネを打つ".to_owned()),
                mods: Vec::new(),
                lines: vec!["[q] 質問: 痛い？ 選択肢: はい → a / いいえ → e".to_owned()],
            },
            CorpusFlow {
                id: "circulation".to_owned(),
                title: "循環".to_owned(),
                description: None,
                mods: vec![ModTarget::Circulation],
                lines: Vec::new(),
            },
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_sections_by_source_and_id() {
        let corpus = fixtures::corpus();
        let (doc, s) = corpus
            .section_by_source("doc:hemorrhage.md#止血帯を使う")
            .expect("ある");
        assert_eq!(doc.title, "出血");
        assert_eq!(s.id, 2);
        assert_eq!(corpus.section_by_id(1).expect("ある").1.level, 0);
        assert!(corpus.section_by_source("doc:hemorrhage.md").is_some());
        assert!(corpus.section_by_source("doc:nothing.md#x").is_none());
    }

    #[test]
    fn descendants_stop_at_the_next_sibling() {
        let corpus = fixtures::corpus();
        let (_, list) = corpus
            .section_with_descendants("doc:hemorrhage.md#止血帯を使う")
            .expect("ある");
        let ids: Vec<i64> = list.iter().map(|s| s.id).collect();
        assert_eq!(ids, vec![2, 3, 4, 5]);
        let (_, intro) = corpus
            .section_with_descendants("doc:hemorrhage.md")
            .expect("導入部");
        assert_eq!(intro.len(), 1);
    }

    #[test]
    fn mod_conditions_match_the_ts_rules() {
        let active = [ModTarget::Circulation, ModTarget::Breathing];
        assert!(meets_mod_conditions(&[], &[], &active));
        assert!(meets_mod_conditions(
            &[ModTarget::Circulation],
            &[],
            &active
        ));
        assert!(!meets_mod_conditions(&[ModTarget::Hitzones], &[], &active));
        assert!(!meets_mod_conditions(
            &[],
            &[ModTarget::Circulation],
            &active
        ));
        assert!(meets_mod_conditions(&[], &[ModTarget::Hitzones], &active));
        // core は常に有効なので「core なし」の節は出ない
        assert!(meets_mod_conditions(&[ModTarget::Core], &[], &[]));
        assert!(!meets_mod_conditions(&[], &[ModTarget::Core], &[]));
    }

    #[test]
    fn condition_label_lists_with_and_without() {
        assert_eq!(
            condition_label(&[ModTarget::Circulation], &[ModTarget::Breathing]).as_deref(),
            Some("Circulation あり・Breathing なし")
        );
        assert_eq!(condition_label(&[], &[]), None);
    }

    #[test]
    fn suggestions_list_headings_of_the_same_document() {
        let corpus = fixtures::corpus();
        let list = corpus.suggestions("doc:hemorrhage.md#止血帯の巻き方", 3);
        assert_eq!(list.len(), 3);
        assert!(list.iter().all(|s| s.starts_with("doc:hemorrhage.md#")));
    }

    #[test]
    fn flow_lines_follow_the_steps_from_the_start() {
        let flow = serde_json::json!({
            "start": "q",
            "nodes": {
                "a": {"type": "action", "text": "打つ", "items": ["モルヒネ注射器"], "ifMissing": {"next": "e"}, "next": "e"},
                "b": {"type": "branch", "cases": [{"mods": ["breathing"], "next": "s"}], "else": "e"},
                "e": {"type": "end", "outcome": "ok", "text": "終わり"},
                "q": {"type": "question", "text": "痛い？", "help": "白く点滅する", "choices": [
                    {"label": "はい", "tone": "yes", "next": "a"},
                    {"label": "いいえ", "tone": "no", "next": "b"}
                ]},
                "s": {"type": "subflow", "flowId": "pneumothorax", "next": "e"}
            }
        });
        assert_eq!(
            flow_lines(&flow),
            vec![
                "[q] 質問: 痛い？ 補足: 白く点滅する 選択肢: はい → a / いいえ → b",
                "[a] 処置: 打つ 物品: モルヒネ注射器 物品がなければ → e 次 → e",
                "[b] 分岐: Breathing ありなら → s、それ以外 → e",
                "[e] 終わり（ok）: 終わり",
                "[s] 別のフロー flow:pneumothorax を行う。終わったら 次 → e",
            ]
        );
    }

    #[test]
    fn load_reads_bundled_manuals_only() {
        let conn = crate::db::test_conn();
        let corpus = load(&conn).expect("空の DB でも読める");
        assert!(corpus.docs.is_empty());
    }
}
