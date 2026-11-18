//! AI が呼ぶツールの中身。結果は AI の種類に依らない形（出典・題・段落）で返し、
//! API の形（Claude なら `search_result` ブロック）への変換は各 AI のモジュールで行う。

use serde::Deserialize;

use crate::ai::corpus::{
    Corpus, CorpusDoc, CorpusFlow, CorpusSection, condition_label, flow_source,
    meets_mod_conditions, quickref_source, section_source,
};
use crate::ai::types::{ChartRequest, ChartSection, ChartValues, ClientRequest, ProposedOp};
use crate::db::{Db, search};
use crate::error::AppError;
use crate::model::{ModTarget, QuickrefRow, SearchFilter, SearchHit};

pub const SEARCH_MANUAL: &str = "search_manual";
pub const READ_SECTION: &str = "read_section";
pub const ASK_USER: &str = "ask_user";
pub const CASUALTY_READ: &str = "casualty_read";
pub const CASUALTY_PROPOSE: &str = "casualty_propose";
pub const CHART_CREATE: &str = "chart_create";
/// 同じ提案の中で直前に作った負傷者を指す
pub const NEW_CASUALTY: &str = "new";

/// 検索で返す節の数。多いと入力が増え、少ないと言い換えの取りこぼしが増える
const MAX_SECTION_HITS: usize = 4;
const MAX_QUICKREF_HITS: usize = 3;
const MAX_FLOW_HITS: usize = 2;
/// MOD で絞ると落ちる分を見込んで、検索からは多めに取る
const SEARCH_CANDIDATES: u32 = 100;
/// 検索の結果の 1 節あたりの上限（文字数）。当たりを見極める分だけ返し、本文は `read_section` で読ませる
/// （6 節 × 3000 字では 1 回の検索で 1 万トークン以上が履歴に残り、会話の間ずっと再送されるため）
const MAX_HIT_CHARS: usize = 800;
/// `read_section` で返す上限（文字数）。配下の節まで含めると長くなるため
const MAX_READ_CHARS: usize = 12000;
/// 1 節を分ける段落の上限。引用の単位を細かくしつつ、ブロックの数を増やしすぎない
const MAX_PARAGRAPHS: usize = 40;
const MAX_QUERY_CHARS: usize = 200;
const MAX_QUESTION_CHARS: usize = 300;
const MAX_OPTION_CHARS: usize = 100;
const MIN_OPTIONS: usize = 2;
const MAX_OPTIONS: usize = 4;
const MAX_SUMMARY_CHARS: usize = 300;
/// 1 回の提案の操作の数。承認のカードで見て確かめられる数にする
const MAX_PROPOSED_OPS: usize = 20;
// 記録の保存の上限（db/casualties.rs）と同じ
const MAX_CASUALTY_NAME_CHARS: usize = 40;
const MAX_NOTE_CHARS: usize = 100;
const MAX_ID_BYTES: usize = 64;
const MAX_CHART_TITLE_CHARS: usize = 60;
const MAX_CHART_LABEL_CHARS: usize = 40;
const MAX_CHART_UNIT_CHARS: usize = 10;
/// 節の線の名前（表の列の見出し）の上限。原稿の見出しが収まる長さ
const MAX_CHART_COLUMN_CHARS: usize = 60;
/// 1 つのグラフに描ける線の数（色が 5 色）。種類ごとの数もこれを超えない
const MAX_CHART_PARTS: usize = 5;
const MAX_CHART_DOSES: usize = 20;
/// 仮の投与の時刻の上限（秒）。薬が体内から消えるまでを足しても、点の数が画面で描ける範囲に収まる
const MAX_CHART_DOSE_SECONDS: u32 = 3600;
const MIN_CHART_POINTS: usize = 2;
const MAX_CHART_POINTS: usize = 200;
/// 利用者の数値の絶対値の上限。目盛りの計算が桁あふれしない範囲にする
const MAX_CHART_VALUE: f64 = 1e9;

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
    let flows = hits
        .iter()
        .filter_map(|hit| match hit {
            SearchHit::Flow(f) => corpus.flow(&f.id),
            _ => None,
        })
        .filter(|flow| fits(&flow.mods, &[]))
        .take(MAX_FLOW_HITS)
        .map(flow_doc);
    sections.chain(rows).chain(flows).collect()
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
    if let Some(id) = source.strip_prefix("flow:") {
        return corpus.flow(id).map_or_else(
            || ToolOutput::Error(format!("{source} というフローはありません")),
            |flow| ToolOutput::Sources(vec![flow_doc(flow)]),
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

/// フロー 1 本。手順の行をそのまま段落にする（引用をノード単位にするため）。
fn flow_doc(flow: &CorpusFlow) -> SourceDoc {
    let mut lines = Vec::new();
    if let Some(label) = condition_label(&flow.mods, &[]) {
        lines.push(format!("（このフロー: {label}）"));
    }
    if let Some(description) = flow.description.as_deref().filter(|d| !d.is_empty()) {
        lines.push(format!("概要: {description}"));
    }
    lines.extend(flow.lines.iter().cloned());
    SourceDoc {
        source: flow_source(&flow.id),
        title: format!("フロー > {}", flow.title),
        // 長いフローでも、段落（引用の単位）の数と文字数の上限は節と同じにする
        paragraphs: paragraphs(&lines.join("\n"), MAX_READ_CHARS),
    }
}

#[derive(Debug, Deserialize)]
struct ProposeInput {
    summary: String,
    ops: Vec<ProposedOp>,
}

/// `casualty_propose` の入力を検査して、画面への要求にする。
/// 長さの上限は記録の保存と同じ（超えると承認した後に保存で失敗するので、先に AI にやり直させる）。
///
/// # Errors
///
/// 入力の形が違う・範囲外のとき、AI に返す文面。
pub fn casualty_propose_request(input: &serde_json::Value) -> Result<ClientRequest, String> {
    let input = serde_json::from_value::<ProposeInput>(input.clone())
        .map_err(|e| format!("入力の形が違います（summary と ops が要ります）: {e}"))?;
    let summary = input.summary.trim().to_owned();
    if summary.is_empty() || summary.chars().count() > MAX_SUMMARY_CHARS {
        return Err(format!(
            "summary は 1〜{MAX_SUMMARY_CHARS} 文字にしてください"
        ));
    }
    if input.ops.is_empty() || input.ops.len() > MAX_PROPOSED_OPS {
        return Err(format!("ops は 1〜{MAX_PROPOSED_OPS} 個にしてください"));
    }
    let mut created = false;
    for (i, op) in input.ops.iter().enumerate() {
        let n = i + 1;
        let target = match op {
            ProposedOp::AddCasualty { name } => {
                if name.trim().chars().count() > MAX_CASUALTY_NAME_CHARS {
                    return Err(format!(
                        "{n} 個目: name は {MAX_CASUALTY_NAME_CHARS} 文字までにしてください"
                    ));
                }
                created = true;
                None
            }
            ProposedOp::ClearAll => None,
            ProposedOp::AddNote { casualty, text } => {
                let len = text.trim().chars().count();
                if len == 0 || len > MAX_NOTE_CHARS {
                    return Err(format!(
                        "{n} 個目: メモは 1〜{MAX_NOTE_CHARS} 文字にしてください"
                    ));
                }
                Some(casualty)
            }
            ProposedOp::RemoveRecord { casualty, record } => {
                if record.trim().is_empty() {
                    return Err(format!("{n} 個目: record（記録の id）が空です"));
                }
                Some(casualty)
            }
            ProposedOp::RemoveCasualty { casualty }
            | ProposedOp::SetPain { casualty, .. }
            | ProposedOp::GiveDrug { casualty, .. }
            | ProposedOp::GiveSaline { casualty }
            | ProposedOp::TourniquetOn { casualty, .. }
            | ProposedOp::TourniquetOff { casualty, .. } => Some(casualty),
        };
        if let Some(casualty) = target {
            let id = casualty.trim();
            if id.is_empty() || id.len() > MAX_ID_BYTES {
                return Err(format!(
                    "{n} 個目: casualty は casualty_read の id か \"new\" にしてください"
                ));
            }
            if id == NEW_CASUALTY && !created {
                return Err(format!(
                    "{n} 個目: \"new\" は、同じ ops の中で前に add_casualty があるときだけ使えます"
                ));
            }
        }
    }
    Ok(ClientRequest::CasualtyPropose {
        summary,
        ops: input.ops,
    })
}

/// `chart_create` の入力を検査して、画面への要求にする。
/// このツールは strict でないので、形・数・範囲のすべてをここで確かめ、理由を返して AI にやり直させる。
///
/// # Errors
///
/// 入力の形が違う・範囲外のとき、AI に返す文面。
pub fn chart_create_request(
    corpus: &Corpus,
    input: &serde_json::Value,
) -> Result<ClientRequest, String> {
    let mut chart = serde_json::from_value::<ChartRequest>(input.clone()).map_err(|e| {
        format!(
            "入力の形が違います（title・scenarios・casualties・sections・values が要ります）: {e}"
        )
    })?;
    chart.title = chart.title.trim().to_owned();
    if chart.title.is_empty() || chart.title.chars().count() > MAX_CHART_TITLE_CHARS {
        return Err(format!(
            "title は 1〜{MAX_CHART_TITLE_CHARS} 文字にしてください"
        ));
    }
    let parts =
        chart.scenarios.len() + chart.casualties.len() + chart.sections.len() + chart.values.len();
    if parts == 0 || parts > MAX_CHART_PARTS {
        return Err(format!(
            "scenarios・casualties・sections・values は、合わせて 1〜{MAX_CHART_PARTS} 個にしてください"
        ));
    }
    for (i, scenario) in chart.scenarios.iter_mut().enumerate() {
        let n = i + 1;
        scenario.label = scenario.label.trim().to_owned();
        if !chart_label_ok(&scenario.label) {
            return Err(format!(
                "scenarios の {n} 個目: label は 1〜{MAX_CHART_LABEL_CHARS} 文字にしてください"
            ));
        }
        if scenario.doses.is_empty() || scenario.doses.len() > MAX_CHART_DOSES {
            return Err(format!(
                "scenarios の {n} 個目: doses は 1〜{MAX_CHART_DOSES} 本にしてください"
            ));
        }
        if scenario
            .doses
            .iter()
            .any(|d| d.seconds > MAX_CHART_DOSE_SECONDS)
        {
            return Err(format!(
                "scenarios の {n} 個目: seconds は 0〜{MAX_CHART_DOSE_SECONDS} にしてください"
            ));
        }
    }
    for (i, casualty) in chart.casualties.iter_mut().enumerate() {
        casualty.casualty = casualty.casualty.trim().to_owned();
        if casualty.casualty.is_empty() || casualty.casualty.len() > MAX_ID_BYTES {
            return Err(format!(
                "casualties の {} 個目: casualty は casualty_read の id にしてください",
                i + 1
            ));
        }
    }
    for (i, section) in chart.sections.iter_mut().enumerate() {
        check_chart_section(corpus, i + 1, section)?;
    }
    for (i, values) in chart.values.iter_mut().enumerate() {
        check_chart_values(i + 1, values)?;
    }
    Ok(ClientRequest::ChartCreate { chart })
}

fn chart_label_ok(label: &str) -> bool {
    let len = label.chars().count();
    len > 0 && len <= MAX_CHART_LABEL_CHARS
}

/// 原稿の節の線の指定を整えて確かめる。節があるかは、画面に頼む前にここで確かめる。
fn check_chart_section(
    corpus: &Corpus,
    n: usize,
    section: &mut ChartSection,
) -> Result<(), String> {
    section.source = section.source.trim().to_owned();
    section.x = section.x.trim().to_owned();
    section.lines = section
        .lines
        .iter()
        .map(|l| l.trim().to_owned())
        .filter(|l| !l.is_empty())
        .collect();
    // 近い節の名前を返せるのは、索引を持つこちらだけ
    // 見出しのない導入部（doc:<ファイル名> だけ）は受けない。画面は見出しのある節から配下を探す
    let anchored = section
        .source
        .split_once('#')
        .is_some_and(|(file, anchor)| file.starts_with("doc:") && !anchor.is_empty());
    if !anchored || corpus.section_by_source(&section.source).is_none() {
        let near = corpus.suggestions(&section.source, 10);
        return Err(format!(
            "sections の {n} 個目: {} という節はありません。見出しのある節の、索引の source（doc:<ファイル名>#<アンカー>）をそのまま使ってください{}",
            section.source,
            if near.is_empty() {
                String::new()
            } else {
                format!("。近い節: {}", near.join("、"))
            }
        ));
    }
    if section.lines.len() > MAX_CHART_PARTS
        || section
            .lines
            .iter()
            .chain(std::iter::once(&section.x))
            .any(|name| name.chars().count() > MAX_CHART_COLUMN_CHARS)
    {
        return Err(format!(
            "sections の {n} 個目: lines は {MAX_CHART_PARTS} 個まで、名前は {MAX_CHART_COLUMN_CHARS} 文字までにしてください"
        ));
    }
    if !section.x.is_empty() && section.lines.is_empty() {
        return Err(format!(
            "sections の {n} 個目: x（表の横軸の列）を書いたときは、lines に縦にする列の見出しを書いてください"
        ));
    }
    Ok(())
}

/// 利用者の数値の線を整えて確かめる。点は x の小さい順に並べ直す。
fn check_chart_values(n: usize, values: &mut ChartValues) -> Result<(), String> {
    values.label = values.label.trim().to_owned();
    values.unit = values.unit.trim().to_owned();
    if !chart_label_ok(&values.label) {
        return Err(format!(
            "values の {n} 個目: label は 1〜{MAX_CHART_LABEL_CHARS} 文字にしてください"
        ));
    }
    if values.unit.chars().count() > MAX_CHART_UNIT_CHARS {
        return Err(format!(
            "values の {n} 個目: unit は {MAX_CHART_UNIT_CHARS} 文字までにしてください"
        ));
    }
    if !(MIN_CHART_POINTS..=MAX_CHART_POINTS).contains(&values.points.len()) {
        return Err(format!(
            "values の {n} 個目: points は {MIN_CHART_POINTS}〜{MAX_CHART_POINTS} 点にしてください"
        ));
    }
    let in_range = |v: f64| v.is_finite() && v.abs() <= MAX_CHART_VALUE;
    if values
        .points
        .iter()
        .any(|p| !in_range(p.x) || !in_range(p.y))
    {
        return Err(format!(
            "values の {n} 個目: x と y は絶対値が {MAX_CHART_VALUE:e} までの数にしてください"
        ));
    }
    // -0.0 を 0.0 にそろえる。total_cmp は 2 つを別の値として並べるが、画面は同じ x として扱うので、
    // そろえないと下の重複の検査をすり抜けて、片方の点が消える
    for point in &mut values.points {
        point.x += 0.0;
    }
    values.points.sort_by(|a, b| a.x.total_cmp(&b.x));
    // 同じ x に 2 つの値があると、線がどちらを通るか決まらない
    if values
        .points
        .windows(2)
        .any(|w| w[0].x.total_cmp(&w[1].x).is_eq())
    {
        return Err(format!(
            "values の {n} 個目: 同じ x の点が 2 つあります。x ごとに 1 点にしてください"
        ));
    }
    Ok(())
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
    if section.has_chart {
        notes.push("グラフあり".to_owned());
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

    fn flow_hit(id: &str) -> SearchHit {
        SearchHit::Flow(crate::model::FlowHit {
            id: id.to_owned(),
            title: String::new(),
            snippet: String::new(),
            score: 0.0,
            synonym_only: false,
        })
    }

    #[test]
    fn flows_are_searched_filtered_and_read_by_source() {
        let corpus = fixtures::corpus();
        let hits = [flow_hit("pain"), flow_hit("circulation")];
        let found = pick_hits(&corpus, &hits, &[], false);
        let sources: Vec<&str> = found.iter().map(|d| d.source.as_str()).collect();
        assert_eq!(
            sources,
            vec!["flow:pain"],
            "Circulation なしでは循環のフローを返さない"
        );
        let ToolOutput::Sources(docs) = read_section(&corpus, &json!({"source": "flow:pain"}))
        else {
            panic!("フローを読める");
        };
        assert_eq!(docs[0].title, "フロー > 痛みを抑える");
        assert_eq!(
            docs[0].paragraphs,
            vec![
                "概要: モルヒネを打つ",
                "[q] 質問: 痛い？ 選択肢: はい → a / いいえ → e"
            ]
        );
        assert!(matches!(
            read_section(&corpus, &json!({"source": "flow:none"})),
            ToolOutput::Error(_)
        ));
    }

    #[test]
    fn casualty_proposals_are_checked_before_asking() {
        let ok = casualty_propose_request(&json!({"summary": " A に打った ", "ops": [
            {"action": "add_casualty", "name": "A"},
            {"action": "give_drug", "casualty": "new", "drug": "morphine"},
            {"action": "tourniquet_on", "casualty": "c1", "site": "left_arm"},
            {"action": "set_pain", "casualty": "c1", "pain": true},
            {"action": "remove_record", "casualty": "c1", "record": "r1"},
            {"action": "remove_casualty", "casualty": "c2"},
            {"action": "clear_all"}
        ]}));
        let Ok(ClientRequest::CasualtyPropose { summary, ops }) = ok else {
            panic!("正しい提案は通る: {ok:?}");
        };
        assert_eq!(summary, "A に打った");
        assert_eq!(ops.len(), 7);
        let err = |input: serde_json::Value| casualty_propose_request(&input).unwrap_err();
        assert!(err(json!({"summary": "x", "ops": []})).contains("ops"));
        assert!(
            err(json!({"summary": "x", "ops": [{"action": "set_pain", "casualty": "new", "pain": true}]}))
                .contains("\"new\"")
        );
        assert!(
            err(json!({"summary": "x", "ops": [{"action": "add_casualty", "name": "あ".repeat(41)}]}))
                .contains("40")
        );
        assert!(
            err(json!({"summary": "x", "ops": [{"action": "add_note", "casualty": "c1", "text": " "}]}))
                .contains("メモ")
        );
        assert!(
            err(json!({"summary": "x", "ops": [{"action": "give_drug", "casualty": "c1", "drug": "aspirin"}]}))
                .contains("形が違います")
        );
    }

    #[test]
    fn chart_requests_are_checked_before_asking() {
        let base = || {
            json!({
                "title": " 比べる ",
                "scenarios": [{"label": " 2 本 ", "metric": "effect", "doses": [
                    {"drug": "morphine", "seconds": 0},
                    {"drug": "naloxone", "seconds": 3600}
                ]}],
                "casualties": [{"casualty": " c1 ", "metric": "concentration"}],
                "sections": [{"source": " doc:hemorrhage.md#止血帯を使う ", "x": "", "lines": [" 血液 ", ""]}],
                "values": [{"label": "心拍数", "unit": " bpm ", "minutes": true, "points": [
                    {"x": 2, "y": 80.5}, {"x": 0, "y": 60}
                ]}]
            })
        };
        let corpus = fixtures::corpus();
        let ok = chart_create_request(&corpus, &base());
        let Ok(ClientRequest::ChartCreate { chart }) = ok else {
            panic!("正しい条件は通る: {ok:?}");
        };
        assert_eq!(chart.title, "比べる");
        assert_eq!(chart.scenarios[0].label, "2 本");
        assert_eq!(chart.casualties[0].casualty, "c1");
        assert_eq!(chart.values[0].unit, "bpm");
        assert_eq!(chart.sections[0].source, "doc:hemorrhage.md#止血帯を使う");
        assert_eq!(chart.sections[0].lines, vec!["血液"]);
        let xs: Vec<f64> = chart.values[0].points.iter().map(|p| p.x).collect();
        assert_eq!(xs, vec![0.0, 2.0], "点は x の小さい順に並べ直す");

        let err = |edit: &dyn Fn(&mut serde_json::Value)| {
            let mut input = base();
            edit(&mut input);
            chart_create_request(&corpus, &input).unwrap_err()
        };
        assert!(err(&|v| v["title"] = json!(" ")).contains("title"));
        assert!(err(&|v| v["scenarios"][0]["doses"][1]["seconds"] = json!(3601)).contains("3600"));
        assert!(err(&|v| v["scenarios"][0]["doses"] = json!([])).contains("doses"));
        assert!(
            err(&|v| v["scenarios"][0]["doses"][0]["drug"] = json!("ammonium_carbonate"))
                .contains("形が違います")
        );
        assert!(err(&|v| v["casualties"][0]["casualty"] = json!("")).contains("casualty"));
        assert!(
            err(&|v| v["sections"][0]["source"] = json!("doc:hemorrhage.md#止血帯"))
                .contains("近い節: doc:hemorrhage.md#止血帯を使う"),
            "ない節は、近い節を添えて止める"
        );
        assert!(
            err(&|v| v["sections"][0]["source"] = json!("quickref:tq")).contains("節はありません")
        );
        assert!(
            err(&|v| v["sections"][0]["source"] = json!("doc:hemorrhage.md"))
                .contains("見出しのある節"),
            "見出しのない導入部は、画面が配下を探せないので止める"
        );
        assert!(
            err(&|v| {
                v["sections"][0]["x"] = json!("経過");
                v["sections"][0]["lines"] = json!([]);
            })
            .contains("lines に縦にする列")
        );
        assert!(err(&|v| v["values"][0]["points"] = json!([{"x": 0, "y": 1}])).contains("points"));
        assert!(
            err(&|v| v["values"][0]["points"] = json!([{"x": 1, "y": 1}, {"x": 1, "y": 2}]))
                .contains("同じ x")
        );
        assert!(
            err(&|v| v["values"][0]["points"] = json!([{"x": -0.0, "y": 1}, {"x": 0.0, "y": 2}]))
                .contains("同じ x"),
            "符号の違うゼロも同じ x として止める"
        );
        assert!(err(&|v| v["values"][0]["points"][0]["y"] = json!(1e10)).contains("絶対値"));
        assert!(
            err(&|v| {
                v["scenarios"] = json!([]);
                v["casualties"] = json!([]);
                v["sections"] = json!([]);
                v["values"] = json!([]);
            })
            .contains("合わせて")
        );
        assert!(
            err(&|v| {
                let one = v["casualties"][0].clone();
                v["casualties"] = serde_json::Value::Array(vec![one; 4]);
            })
            .contains("合わせて")
        );
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
