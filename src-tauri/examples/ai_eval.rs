//! AI チャットの評価（開発用）。固定の質問を本物の API に流し、答え・引用・トークン数を記録する。
//! 画面を介さず `turn::run` を使うので、本番と同じ system・tools・往復で測れる。
//!
//! ```text
//! cargo run --example ai_eval -- --count-only
//! cargo run --example ai_eval -- --summary eval/results/baseline/results.jsonl --summary eval/results/<日時>/results.jsonl
//! cargo run --example ai_eval -- --models sonnet --efforts medium --dry-run
//! cargo run --example ai_eval -- --models sonnet,haiku --efforts low,medium --cases tq-synonym,pain-flow
//! ```
//!
//! - 原稿は、開発版アプリが同期した DB（`%APPDATA%\com.gjzkcal.fieldmedicmanual.dev`）の写しから読む。先にアプリを一度起動しておく。
//! - キーは環境変数 `ANTHROPIC_API_KEY`、なければ資格情報マネージャー（開発版 → 配布版の順）。出力には書かない。
//! - 本物の API を呼ぶので費用がかかる。`--dry-run` で件数を確かめてから流す。
//! - 結果は `eval/results/<日時>/` に JSONL（1 行 1 実行）・CSV（本文なし）・Markdown（目視の比較用）で出す。

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use field_medic_manual_lib::ai::claude::http::{self, HttpTransport, Transport};
use field_medic_manual_lib::ai::conversation::AiState;
use field_medic_manual_lib::ai::corpus::{self, Corpus};
use field_medic_manual_lib::ai::types::{
    AiEffort, AiModel, ChatCitation, ChatEvent, ChatSendInput, ChatTurnResult, ChatUsage,
    ClientRequest, ClientToolResult, ToolKind, ToolState, TurnStatus,
};
use field_medic_manual_lib::ai::{claude, key, prompt, turn};
use field_medic_manual_lib::db::{DB_FILE_NAME, Db};
use field_medic_manual_lib::error::AppError;
use field_medic_manual_lib::model::ModTarget;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

const DEV_IDENTIFIER: &str = "com.gjzkcal.fieldmedicmanual.dev";
const RELEASE_IDENTIFIER: &str = "com.gjzkcal.fieldmedicmanual";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(600);
/// 答えに「載っていない」と書いたとみなす言い方
const NOT_LISTED_MARKS: [&str; 3] = ["載っていません", "載っていない", "載ってません"];

fn main() {
    let args = match Args::parse(std::env::args().skip(1)) {
        Ok(args) => args,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };
    if let Err(e) = tauri::async_runtime::block_on(run(args)) {
        eprintln!("失敗: {e}");
        std::process::exit(1);
    }
}

struct Args {
    count_only: bool,
    /// 各問の後に、キャッシュの保温の要求（`max_tokens: 0`）を送って使用量を出す
    keep_alive_check: bool,
    /// 各問の後に、同じ会話で 2 問目をこの effort で送る（会話の途中の effort の変更を API が受け付けるかの確認）
    effort_change: Option<AiEffort>,
    /// 集計だけする JSONL（結果のフォルダの results.jsonl）。複数なら、索引を変える前後の比較に使う
    summary: Vec<PathBuf>,
    dry_run: bool,
    models: Vec<AiModel>,
    efforts: Vec<AiEffort>,
    cases: Option<Vec<String>>,
    repeat: u32,
    data_dir: Option<PathBuf>,
    questions: PathBuf,
    out: Option<PathBuf>,
    timeout: Duration,
}

impl Args {
    fn parse(args: impl Iterator<Item = String>) -> Result<Self, String> {
        let mut out = Self {
            count_only: false,
            keep_alive_check: false,
            effort_change: None,
            summary: Vec::new(),
            dry_run: false,
            models: vec![AiModel::ClaudeSonnet55],
            efforts: vec![AiEffort::Medium],
            cases: None,
            repeat: 1,
            data_dir: None,
            questions: Path::new(env!("CARGO_MANIFEST_DIR")).join("eval/questions.v1.json"),
            out: None,
            timeout: DEFAULT_TIMEOUT,
        };
        let mut args = args.peekable();
        while let Some(arg) = args.next() {
            let mut value = || args.next().ok_or_else(|| format!("{arg} には値が要ります"));
            match arg.as_str() {
                "--count-only" => out.count_only = true,
                "--keep-alive-check" => out.keep_alive_check = true,
                "--effort-change" => out.effort_change = Some(parse_effort(&value()?)?),
                "--summary" => out.summary.push(PathBuf::from(value()?)),
                "--dry-run" => out.dry_run = true,
                "--models" => {
                    out.models = value()?
                        .split(',')
                        .map(parse_model)
                        .collect::<Result<_, _>>()?;
                }
                "--efforts" => {
                    out.efforts = value()?
                        .split(',')
                        .map(parse_effort)
                        .collect::<Result<_, _>>()?;
                }
                "--cases" => out.cases = Some(value()?.split(',').map(str::to_owned).collect()),
                "--repeat" => {
                    out.repeat = value()?
                        .parse()
                        .map_err(|_| "--repeat は整数にしてください".to_owned())?;
                }
                "--data-dir" => out.data_dir = Some(PathBuf::from(value()?)),
                "--questions" => out.questions = PathBuf::from(value()?),
                "--out" => out.out = Some(PathBuf::from(value()?)),
                "--timeout-secs" => {
                    out.timeout = Duration::from_secs(
                        value()?
                            .parse()
                            .map_err(|_| "--timeout-secs は整数にしてください".to_owned())?,
                    );
                }
                other => return Err(format!("知らない引数: {other}")),
            }
        }
        Ok(out)
    }
}

fn parse_model(name: &str) -> Result<AiModel, String> {
    let id = match name.trim() {
        "opus" => "claude-opus-5-5",
        "sonnet" => "claude-sonnet-5-5",
        "haiku" => "claude-haiku-5-5",
        other => other,
    };
    serde_json::from_value(Value::String(id.to_owned()))
        .map_err(|_| format!("知らないモデル: {name}（opus / sonnet / haiku かモデル ID）"))
}

fn parse_effort(name: &str) -> Result<AiEffort, String> {
    serde_json::from_value(Value::String(name.trim().to_owned()))
        .map_err(|_| format!("知らない effort: {name}（low / medium / high / xhigh / max）"))
}

#[derive(Deserialize)]
struct QuestionFile {
    version: u32,
    cases: Vec<Case>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Case {
    id: String,
    question: String,
    #[serde(default)]
    mods: Vec<ModTarget>,
    #[serde(default)]
    tags: Vec<String>,
    /// AI が聞き返したときに返す答え。なければ空（「利用者は答えませんでした」になる）
    #[serde(default)]
    ask_answer: Option<String>,
    #[serde(default)]
    expect: Expect,
}

/// 期待。`Some(true)` は必須、`Some(false)` は禁止、`None` は不問。
#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct Expect {
    citations: Option<bool>,
    /// 回答に `[題](flow:<id>)` のリンクを期待するフローの id
    flow: Option<String>,
    not_listed: Option<bool>,
    figure: Option<bool>,
    /// 画面で実行するツール（聞き返し・負傷者の記録）を使うか
    client_calls: Option<bool>,
    /// 引用か読んだ節のどれかに含まれていれば合格
    #[serde(default)]
    sources: Vec<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Checks {
    citations: Option<bool>,
    flow: Option<bool>,
    not_listed: Option<bool>,
    figure: Option<bool>,
    client_calls: Option<bool>,
    sources: Option<bool>,
}

impl Checks {
    fn pass(&self) -> Option<bool> {
        let all = [
            self.citations,
            self.flow,
            self.not_listed,
            self.figure,
            self.client_calls,
            self.sources,
        ];
        if all.iter().all(Option::is_none) {
            None
        } else {
            Some(all.iter().flatten().all(|ok| *ok))
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    run_at: String,
    model: &'static str,
    effort: &'static str,
    case_id: String,
    rep: u32,
    status: String,
    error: Option<String>,
    duration_ms: u128,
    duration_secs: f64,
    api_calls: u32,
    tool_rounds: u32,
    searches: Vec<String>,
    read_sources: Vec<String>,
    web_searches: u32,
    client_calls: u32,
    notices: Vec<String>,
    thinking_chars: usize,
    usage: ChatUsage,
    /// 接頭辞をキャッシュから読めたか（同じモデルの 2 問目以降は true のはず）
    warm: bool,
    citations_manual: usize,
    citations_web: u32,
    cited_sources: Vec<String>,
    flow_ids: Vec<String>,
    not_listed: bool,
    has_figure: bool,
    checks: Checks,
    pass: Option<bool>,
    answer: String,
    system_sha256: String,
    section_count: usize,
}

/// 回答の途中のイベントから集める。
#[derive(Default)]
struct Collector {
    /// API 呼び出しごとの本文と引用。最後のものが最終回答
    segments: Vec<Segment>,
    current: Segment,
    api_calls: u32,
    searches: Vec<String>,
    reads: Vec<String>,
    web_searches: u32,
    client_calls: u32,
    notices: Vec<String>,
    thinking_chars: usize,
}

#[derive(Default, Clone)]
struct Segment {
    text: String,
    manual_sources: Vec<String>,
    web_citations: u32,
}

/// 画面の代わりに答える。聞き返しは case の答え、記録は空、提案は却下。
fn client_answer(request: &ClientRequest, ask_answer: Option<&str>) -> ClientToolResult {
    match request {
        ClientRequest::AskUser { .. } => ClientToolResult::AskUser {
            answer: ask_answer.unwrap_or_default().to_owned(),
        },
        ClientRequest::CasualtyRead => ClientToolResult::CasualtyRead {
            text: "負傷者の記録はありません。".to_owned(),
        },
        ClientRequest::CasualtyPropose { .. } => ClientToolResult::CasualtyPropose {
            approved: false,
            error: None,
        },
    }
}

fn collect(
    collector: &Mutex<Collector>,
    state: &AiState,
    ask_answer: Option<&str>,
    event: ChatEvent,
) {
    let mut c = collector.lock().expect("ロックできる");
    match event {
        ChatEvent::Text { text, .. } => c.current.text.push_str(&text),
        ChatEvent::Thinking { text, .. } => c.thinking_chars += text.chars().count(),
        ChatEvent::Citation { citation, .. } => match citation {
            ChatCitation::Manual { source, .. } => c.current.manual_sources.push(source),
            ChatCitation::Web { .. } => c.current.web_citations += 1,
        },
        ChatEvent::ToolActivity {
            tool,
            detail,
            state: ToolState::Running,
            ..
        } => match tool {
            ToolKind::SearchManual => c.searches.push(detail),
            ToolKind::ReadSection => c.reads.push(detail),
            ToolKind::WebSearch => c.web_searches += 1,
            ToolKind::CasualtyRead => {}
        },
        ChatEvent::ToolActivity { .. } => {}
        ChatEvent::ClientRequest {
            tool_use_id,
            request,
        } => {
            c.client_calls += 1;
            let result = client_answer(&request, ask_answer);
            drop(c);
            if let Err(e) = state.resolve_pending(&tool_use_id, result) {
                eprintln!("画面の代わりの答えを渡せませんでした: {e}");
            }
        }
        ChatEvent::Notice { notice } => c.notices.push(format!("{notice:?}")),
        ChatEvent::Usage { .. } => {
            c.api_calls += 1;
            let segment = std::mem::take(&mut c.current);
            c.segments.push(segment);
        }
    }
}

async fn run(args: Args) -> Result<(), AppError> {
    if !args.summary.is_empty() {
        return summarize(&args.summary);
    }
    let file: QuestionFile = serde_json::from_str(&fs::read_to_string(&args.questions)?)
        .map_err(|e| AppError::InvalidInput(format!("評価セットを読めません: {e}")))?;
    if file.version != 1 {
        return Err(AppError::InvalidInput(format!(
            "評価セットの version {} には対応していません",
            file.version
        )));
    }
    let cases: Vec<Case> = match &args.cases {
        None => file.cases,
        Some(ids) => {
            let picked: Vec<Case> = file
                .cases
                .into_iter()
                .filter(|c| ids.contains(&c.id))
                .collect();
            if picked.len() != ids.len() {
                return Err(AppError::InvalidInput(
                    "--cases に評価セットにない id があります".to_owned(),
                ));
            }
            picked
        }
    };

    let (db, _temp) = open_db_copy(args.data_dir.as_deref())?;
    let corpus = Arc::new(db.run(|conn, _| corpus::load(conn)).await?);
    if corpus.docs.is_empty() {
        return Err(AppError::InvalidInput(
            "DB に原稿がありません。先に開発版のアプリを起動して同期してください".to_owned(),
        ));
    }
    validate_sources(&corpus, &cases)?;
    let section_count: usize = corpus.docs.iter().map(|d| d.sections.len()).sum();
    println!(
        "原稿: {} 文書・{} 節・クイック表 {} 行・フロー {} 件、索引 {} 文字",
        corpus.docs.len(),
        section_count,
        corpus.quickref.len(),
        corpus.flows.len(),
        prompt::index(&corpus).chars().count()
    );

    let runs = args.models.len() * args.efforts.len() * cases.len() * args.repeat as usize;
    if args.dry_run {
        println!(
            "実行の数: {} モデル × {} effort × {} 問 × {} 回 = {runs} 回（本物の API を呼びます）",
            args.models.len(),
            args.efforts.len(),
            cases.len(),
            args.repeat
        );
        for case in &cases {
            println!("- {} [{}] {}", case.id, case.tags.join(","), case.question);
        }
        return Ok(());
    }

    let api_key = load_key()?;
    if args.count_only {
        return count_only(&api_key, &corpus, &args.models).await;
    }

    let out = args.out.clone().unwrap_or_else(|| {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("eval/results")
            .join(stamp())
    });
    fs::create_dir_all(&out)?;
    println!("結果: {}（{runs} 回）", out.display());
    let records = run_all(&args, &api_key, &db, &corpus, &cases, section_count, &out).await?;
    fs::write(out.join("results.csv"), csv(&records))?;
    fs::write(out.join("compare.md"), markdown(&records, &cases))?;
    println!("書き出しました: {}", out.display());
    Ok(())
}

/// model → effort → 質問の順に逐次で流す（レート制限を避け、同じモデルの 2 問目からキャッシュを効かせるため）。
async fn run_all(
    args: &Args,
    api_key: &str,
    db: &Db,
    corpus: &Arc<Corpus>,
    cases: &[Case],
    section_count: usize,
    out: &Path,
) -> Result<Vec<Record>, AppError> {
    let mut records = Vec::new();
    for &model in &args.models {
        let mut first = true;
        for &effort in &args.efforts {
            for rep in 1..=args.repeat {
                for case in cases {
                    let record = run_case(
                        api_key,
                        db,
                        corpus,
                        model,
                        effort,
                        case,
                        rep,
                        args.timeout,
                        args.keep_alive_check,
                        args.effort_change,
                        section_count,
                    )
                    .await;
                    if !first && record.api_calls > 0 && !record.warm {
                        eprintln!(
                            "警告: {} の 2 問目以降なのにキャッシュから読めていません（{}）。プロンプトの組み立てが毎回変わっていないか確かめてください",
                            model.id(),
                            case.id
                        );
                    }
                    first = false;
                    println!(
                        "[{}/{}] {} {} input {} cache_read {} cache_write {} output {} 往復 {} {:.1}s",
                        model.id(),
                        effort.as_str(),
                        case.id,
                        record
                            .pass
                            .map_or("-", |ok| if ok { "pass" } else { "FAIL" }),
                        record.usage.input_tokens,
                        record.usage.cache_read_tokens,
                        record.usage.cache_write_tokens,
                        record.usage.output_tokens,
                        record.tool_rounds,
                        record.duration_secs
                    );
                    append_jsonl(&out.join("results.jsonl"), &record)?;
                    records.push(record);
                }
            }
        }
    }
    Ok(records)
}

/// 本物の DB を直接開かない（`Db::open` がマイグレーションと WAL の設定で書き換えるため）。一時フォルダに写して開く。
fn open_db_copy(data_dir: Option<&Path>) -> Result<(Db, tempfile::TempDir), AppError> {
    let data_dir = match data_dir {
        Some(dir) => dir.to_path_buf(),
        None => PathBuf::from(std::env::var_os("APPDATA").ok_or_else(|| {
            AppError::InvalidInput("APPDATA がありません。--data-dir で指定してください".to_owned())
        })?)
        .join(DEV_IDENTIFIER),
    };
    let temp = tempfile::tempdir()?;
    for suffix in ["", "-wal", "-shm"] {
        let name = format!("{DB_FILE_NAME}{suffix}");
        let from = data_dir.join(&name);
        if from.exists() {
            fs::copy(&from, temp.path().join(&name))?;
        } else if suffix.is_empty() {
            return Err(AppError::NotFound(format!("DB {}", from.display())));
        }
    }
    Ok((Db::open(temp.path())?, temp))
}

fn load_key() -> Result<String, AppError> {
    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY")
        && !key.trim().is_empty()
    {
        return key::validate(&key);
    }
    for service in [DEV_IDENTIFIER, RELEASE_IDENTIFIER] {
        if let Some(key) = key::load(service)? {
            return Ok(key);
        }
    }
    Err(AppError::AiAuth(
        "API キーがありません。ANTHROPIC_API_KEY か、開発版の設定でキーを登録してください"
            .to_owned(),
    ))
}

/// 評価セットの source が原稿に実在するかを、お金を使う前に確かめる。
fn validate_sources(corpus: &Corpus, cases: &[Case]) -> Result<(), AppError> {
    let mut missing = Vec::new();
    for case in cases {
        for source in &case.expect.sources {
            if !source_exists(corpus, source) {
                missing.push(format!("{}: {source}", case.id));
            }
        }
        if let Some(flow) = &case.expect.flow
            && corpus.flow(flow).is_none()
        {
            missing.push(format!("{}: flow:{flow}", case.id));
        }
    }
    if missing.is_empty() {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "評価セットの source が原稿にありません:\n{}",
            missing.join("\n")
        )))
    }
}

fn source_exists(corpus: &Corpus, source: &str) -> bool {
    if let Some(id) = source.strip_prefix("quickref:") {
        corpus.quickref_row(id).is_some()
    } else if let Some(id) = source.strip_prefix("flow:") {
        corpus.flow(id).is_some()
    } else {
        corpus.section_by_source(source).is_some()
    }
}

/// system と tools のトークン数をモデルごとに数える。索引を変える前後の比較に使う。
async fn count_only(api_key: &str, corpus: &Corpus, models: &[AiModel]) -> Result<(), AppError> {
    let system = prompt::system_prompt(corpus, &[ModTarget::Circulation, ModTarget::Breathing]);
    println!(
        "system {} 文字（索引 {} 文字）",
        system.chars().count(),
        prompt::index(corpus).chars().count()
    );
    println!("model | system+tools | system | tools");
    for &model in models {
        let mut tools = claude::tools(true);
        let mut note = "";
        let full = match http::count_tokens(
            api_key,
            &claude::count_body(model, Some(&system), Some(&tools)),
        )
        .await
        {
            Ok(n) => n,
            Err(AppError::AiRequest(message)) => {
                // Web 検索のサーバーツールを count_tokens が受け付けないときは、自作のツールだけで数える
                eprintln!(
                    "{}: tools(true) は数えられません（{message}）。Web 検索なしで数えます",
                    model.id()
                );
                tools = claude::tools(false);
                note = "（Web 検索なし）";
                http::count_tokens(
                    api_key,
                    &claude::count_body(model, Some(&system), Some(&tools)),
                )
                .await?
            }
            Err(e) => return Err(e),
        };
        let system_only =
            http::count_tokens(api_key, &claude::count_body(model, Some(&system), None)).await?;
        let tools_only =
            http::count_tokens(api_key, &claude::count_body(model, None, Some(&tools))).await?;
        println!(
            "{} | {full} | {system_only} | {tools_only}{note}",
            model.id()
        );
    }
    Ok(())
}

#[expect(
    clippy::too_many_arguments,
    reason = "1 回の実行に要るものをそのまま渡す"
)]
async fn run_case(
    api_key: &str,
    db: &Db,
    corpus: &Arc<Corpus>,
    model: AiModel,
    effort: AiEffort,
    case: &Case,
    rep: u32,
    timeout: Duration,
    keep_alive_check: bool,
    effort_change: Option<AiEffort>,
    section_count: usize,
) -> Record {
    let state = Arc::new(AiState::default());
    let transport = HttpTransport::new(api_key.to_owned());
    let collector = Arc::new(Mutex::new(Collector::default()));
    let emit = {
        let collector = Arc::clone(&collector);
        let state = Arc::clone(&state);
        let ask_answer = case.ask_answer.clone();
        move |event: ChatEvent| {
            collect(&collector, &state, ask_answer.as_deref(), event);
            true
        }
    };
    let input = ChatSendInput {
        text: case.question.clone(),
        images: Vec::new(),
        model,
        effort,
        mods: case.mods.clone(),
        replace_from: None,
    };
    // 長すぎる実行は止める（xhigh / max では数分かかりうる）
    let watchdog = tauri::async_runtime::spawn({
        let state = Arc::clone(&state);
        async move {
            tokio::time::sleep(timeout).await;
            let _ = state.cancel();
        }
    });
    let started = Instant::now();
    let run_at = now_jst();
    let result = turn::run(&state, db, &transport, input, &emit).await;
    watchdog.abort();
    let elapsed = started.elapsed();
    let duration_ms = elapsed.as_millis();
    let duration_secs = elapsed.as_secs_f64();
    if keep_alive_check {
        keep_alive_check_once(api_key, &state).await;
    }
    let record = record_of(
        &collector.lock().expect("ロックできる"),
        &result,
        case,
        corpus,
        Labels {
            run_at,
            model,
            effort,
            rep,
            duration_ms,
            duration_secs,
            section_count,
        },
    );
    if let Some(next) = effort_change {
        follow_up(db, &transport, &state, &emit, model, next, &case.mods).await;
    }
    record
}

/// 同じ会話で 2 問目を違う effort で送り、API が受け付けるか（`EffortChangeUnsupported` が出ないか）を確かめる。
async fn follow_up<T: Transport>(
    db: &Db,
    transport: &T,
    state: &Arc<AiState>,
    emit: &(dyn Fn(ChatEvent) -> bool + Send + Sync),
    model: AiModel,
    effort: AiEffort,
    mods: &[ModTarget],
) {
    let input = ChatSendInput {
        text: "いまの答えを 1 行にまとめて".to_owned(),
        images: Vec::new(),
        model,
        effort,
        mods: mods.to_vec(),
        replace_from: None,
    };
    match turn::run(state, db, transport, input, emit).await {
        Ok(r) => println!(
            "  2 問目（effort {}）: {} input {} cache_read {} cache_write {} output {}",
            effort.as_str(),
            status_name(&r.status),
            r.usage.input_tokens,
            r.usage.cache_read_tokens,
            r.usage.cache_write_tokens,
            r.usage.output_tokens
        ),
        Err(e) => println!("  2 問目（effort {}）に失敗: {e}", effort.as_str()),
    }
}

/// 1 回の実行に付ける印。
struct Labels {
    run_at: String,
    model: AiModel,
    effort: AiEffort,
    rep: u32,
    duration_ms: u128,
    duration_secs: f64,
    section_count: usize,
}

fn record_of(
    c: &Collector,
    result: &Result<ChatTurnResult, AppError>,
    case: &Case,
    corpus: &Corpus,
    labels: Labels,
) -> Record {
    let Labels {
        run_at,
        model,
        effort,
        rep,
        duration_ms,
        duration_secs,
        section_count,
    } = labels;
    let last = c.segments.last().cloned().unwrap_or_default();
    let answer = last.text.trim().to_owned();
    let (status, error, usage) = match result {
        Ok(r) => (status_name(&r.status), None, r.usage),
        Err(e) => (
            "error".to_owned(),
            Some(e.to_string()),
            ChatUsage::default(),
        ),
    };
    let flow_ids = flow_links(&answer);
    let not_listed = NOT_LISTED_MARKS.iter().any(|m| answer.contains(m));
    let has_figure = answer.contains("```figure");
    let mut cited: Vec<String> = last.manual_sources.clone();
    cited.sort();
    cited.dedup();
    let checks = check(
        &case.expect,
        &Observed {
            cited: &cited,
            reads: &c.reads,
            flow_ids: &flow_ids,
            not_listed,
            has_figure,
            client_calls: c.client_calls,
        },
    );
    let system = prompt::system_prompt(corpus, &sorted_mods(&case.mods));
    Record {
        run_at,
        model: model.id(),
        effort: effort.as_str(),
        case_id: case.id.clone(),
        rep,
        status,
        error,
        duration_ms,
        duration_secs,
        api_calls: c.api_calls,
        tool_rounds: c.api_calls.saturating_sub(1),
        searches: c.searches.clone(),
        read_sources: c.reads.clone(),
        web_searches: c.web_searches,
        client_calls: c.client_calls,
        notices: c.notices.clone(),
        thinking_chars: c.thinking_chars,
        usage,
        warm: usage.cache_read_tokens > 0,
        citations_manual: last.manual_sources.len(),
        citations_web: last.web_citations,
        cited_sources: cited,
        flow_ids,
        not_listed,
        has_figure,
        pass: checks.pass(),
        checks,
        answer,
        system_sha256: hex::encode(Sha256::digest(system.as_bytes())),
        section_count,
    }
}

/// `turn::new_fixed` と同じ並びにして、同じ system を作る。
fn sorted_mods(mods: &[ModTarget]) -> Vec<ModTarget> {
    let mut mods = mods.to_vec();
    mods.sort_by_key(|m| m.as_str());
    mods.dedup();
    mods
}

fn status_name(status: &TurnStatus) -> String {
    match status {
        TurnStatus::Completed => "completed".to_owned(),
        TurnStatus::Truncated => "truncated".to_owned(),
        TurnStatus::Refused { category, .. } => {
            format!("refused:{}", category.as_deref().unwrap_or("-"))
        }
        TurnStatus::Cancelled => "cancelled".to_owned(),
    }
}

/// 回答の中の `[題](flow:<id>)` の id。
fn flow_links(answer: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let mut rest = answer;
    while let Some(at) = rest.find("](flow:") {
        let after = &rest[at + "](flow:".len()..];
        let Some(end) = after.find(')') else { break };
        let id = after[..end].trim().to_owned();
        if !id.is_empty() && !ids.contains(&id) {
            ids.push(id);
        }
        rest = &after[end..];
    }
    ids
}

fn append_jsonl(path: &Path, record: &Record) -> Result<(), AppError> {
    use std::io::Write as _;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    let line = serde_json::to_string(record)
        .map_err(|e| AppError::Internal(format!("結果を JSON にできません: {e}")))?;
    writeln!(file, "{line}")?;
    Ok(())
}

fn csv(records: &[Record]) -> String {
    let mut out = String::from(
        "runAt,model,effort,caseId,rep,status,pass,durationMs,apiCalls,toolRounds,searches,reads,webSearches,clientCalls,inputTokens,cacheReadTokens,cacheWriteTokens,outputTokens,warm,citationsManual,citationsWeb,flowIds,notListed,hasFigure,notices\n",
    );
    for r in records {
        let fields = [
            r.run_at.clone(),
            r.model.to_owned(),
            r.effort.to_owned(),
            r.case_id.clone(),
            r.rep.to_string(),
            r.status.clone(),
            r.pass.map_or(String::new(), |ok| ok.to_string()),
            r.duration_ms.to_string(),
            r.api_calls.to_string(),
            r.tool_rounds.to_string(),
            r.searches.len().to_string(),
            r.read_sources.len().to_string(),
            r.web_searches.to_string(),
            r.client_calls.to_string(),
            r.usage.input_tokens.to_string(),
            r.usage.cache_read_tokens.to_string(),
            r.usage.cache_write_tokens.to_string(),
            r.usage.output_tokens.to_string(),
            r.warm.to_string(),
            r.citations_manual.to_string(),
            r.citations_web.to_string(),
            r.flow_ids.join(" "),
            r.not_listed.to_string(),
            r.has_figure.to_string(),
            r.notices.join(" "),
        ];
        let line: Vec<String> = fields.iter().map(|f| csv_field(f)).collect();
        out.push_str(&line.join(","));
        out.push('\n');
    }
    out
}

fn csv_field(value: &str) -> String {
    if value.contains([',', '"', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

/// 同じ質問の答えを、モデル × effort で並べる（目視の比較用）。
fn markdown(records: &[Record], cases: &[Case]) -> String {
    let mut by_case: BTreeMap<&str, Vec<&Record>> = BTreeMap::new();
    for r in records {
        by_case.entry(r.case_id.as_str()).or_default().push(r);
    }
    let mut out = String::from("# 評価の比較\n");
    for case in cases {
        let _ = writeln!(out, "\n## {}: {}\n", case.id, case.question);
        for r in by_case.get(case.id.as_str()).into_iter().flatten() {
            let _ = writeln!(
                out,
                "### {} / {} / {} 回目 — {}（{}）\n",
                r.model,
                r.effort,
                r.rep,
                r.pass
                    .map_or("判定なし", |ok| if ok { "pass" } else { "FAIL" }),
                r.status
            );
            let _ = writeln!(
                out,
                "- 入力 {}（キャッシュ読み {}・書き {}）・出力 {}・往復 {}・引用 {}・読んだ節 {}・{:.1} 秒",
                r.usage.input_tokens,
                r.usage.cache_read_tokens,
                r.usage.cache_write_tokens,
                r.usage.output_tokens,
                r.tool_rounds,
                r.citations_manual,
                r.read_sources.join("、"),
                r.duration_secs
            );
            if let Some(e) = &r.error {
                let _ = writeln!(out, "- エラー: {e}");
            }
            let _ = writeln!(out, "\n{}\n", r.answer);
        }
    }
    out
}

fn now_jst() -> String {
    let t = jst();
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}+09:00",
        t.year(),
        u8::from(t.month()),
        t.day(),
        t.hour(),
        t.minute(),
        t.second()
    )
}

fn stamp() -> String {
    let t = jst();
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        t.year(),
        u8::from(t.month()),
        t.day(),
        t.hour(),
        t.minute(),
        t.second()
    )
}

fn jst() -> time::OffsetDateTime {
    time::OffsetDateTime::now_utc()
        .to_offset(time::UtcOffset::from_hms(9, 0, 0).unwrap_or(time::UtcOffset::UTC))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flow_links_are_extracted() {
        assert_eq!(
            flow_links(
                "[痛みを抑える](flow:pain) と [心停止](flow:cardiac-arrest)、また [痛み](flow:pain)"
            ),
            vec!["pain", "cardiac-arrest"]
        );
        assert!(flow_links("リンクなし](flow:").is_empty());
    }

    #[test]
    fn checks_pass_only_when_every_expectation_holds() {
        assert_eq!(Checks::default().pass(), None);
        let ok = Checks {
            citations: Some(true),
            sources: Some(true),
            ..Checks::default()
        };
        assert_eq!(ok.pass(), Some(true));
        let bad = Checks {
            citations: Some(true),
            flow: Some(false),
            ..Checks::default()
        };
        assert_eq!(bad.pass(), Some(false));
    }
}

/// 結果の JSONL を読むときの形（書いた `Record` のうち、集計に使う項目だけ）。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Summarized {
    model: String,
    effort: String,
    case_id: String,
    status: String,
    pass: Option<bool>,
    tool_rounds: u32,
    duration_secs: f64,
    usage: UsageRow,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct UsageRow {
    #[serde(rename = "inputTokens")]
    input: u64,
    #[serde(rename = "outputTokens")]
    output: u64,
    #[serde(rename = "cacheReadTokens")]
    cache_read: u64,
    #[serde(rename = "cacheWriteTokens")]
    cache_write: u64,
}

#[derive(Default)]
struct Cell {
    rows: Vec<Summarized>,
}

impl Cell {
    fn mean(&self, f: impl Fn(&Summarized) -> f64) -> f64 {
        if self.rows.is_empty() {
            0.0
        } else {
            #[expect(clippy::cast_precision_loss, reason = "表示用の平均")]
            let n = self.rows.len() as f64;
            self.rows.iter().map(f).sum::<f64>() / n
        }
    }
}

#[expect(clippy::cast_precision_loss, reason = "表示用の平均")]
fn as_f64(n: u64) -> f64 {
    n as f64
}

/// 結果の JSONL を、結果のフォルダ × model × effort ごとに集計して Markdown の表にする。
fn summarize(files: &[PathBuf]) -> Result<(), AppError> {
    let mut cells: BTreeMap<(String, String, String), Cell> = BTreeMap::new();
    for file in files {
        let label = file
            .parent()
            .and_then(Path::file_name)
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        for line in fs::read_to_string(file)?
            .lines()
            .filter(|l| !l.trim().is_empty())
        {
            let row: Summarized = serde_json::from_str(line)
                .map_err(|e| AppError::InvalidInput(format!("{}: {e}", file.display())))?;
            cells
                .entry((label.clone(), row.model.clone(), row.effort.clone()))
                .or_default()
                .rows
                .push(row);
        }
    }
    println!(
        "| 結果 | model | effort | n | pass | 失敗/拒否 | 入力(全額) | キャッシュ書き | キャッシュ読み | 出力 | 往復 | 秒 | 落ちた問 |"
    );
    println!("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for ((label, model, effort), cell) in &cells {
        let judged = cell.rows.iter().filter(|r| r.pass.is_some()).count();
        let passed = cell.rows.iter().filter(|r| r.pass == Some(true)).count();
        let errors = cell.rows.iter().filter(|r| r.status != "completed").count();
        let failed: Vec<&str> = cell
            .rows
            .iter()
            .filter(|r| r.pass == Some(false))
            .map(|r| r.case_id.as_str())
            .collect();
        println!(
            "| {label} | {} | {effort} | {} | {passed}/{judged} | {errors} | {:.0} | {:.0} | {:.0} | {:.0} | {:.1} | {:.1} | {} |",
            model.trim_start_matches("claude-"),
            cell.rows.len(),
            cell.mean(|r| as_f64(r.usage.input)),
            cell.mean(|r| as_f64(r.usage.cache_write)),
            cell.mean(|r| as_f64(r.usage.cache_read)),
            cell.mean(|r| as_f64(r.usage.output)),
            cell.mean(|r| f64::from(r.tool_rounds)),
            cell.mean(|r| r.duration_secs),
            failed.join(" ")
        );
    }
    Ok(())
}

/// キャッシュの保温の要求を 1 回送り、使用量を出す（本番と同じ本文で API が受け付けるかの確認）。
async fn keep_alive_check_once(api_key: &str, state: &AiState) {
    match state.keep_alive_body() {
        Ok(Some(body)) => match http::send_for_usage(api_key, &body).await {
            Ok(u) => println!(
                "  保温: input {} cache_read {} cache_write {} output {}",
                u.input_tokens, u.cache_read_tokens, u.cache_write_tokens, u.output_tokens
            ),
            Err(e) => println!("  保温に失敗: {e}"),
        },
        Ok(None) => println!("  保温: 会話がない"),
        Err(e) => println!("  保温に失敗: {e}"),
    }
}

/// 1 回の実行で観測したもの（期待と突き合わせる分だけ）。
struct Observed<'a> {
    cited: &'a [String],
    reads: &'a [String],
    flow_ids: &'a [String],
    not_listed: bool,
    has_figure: bool,
    client_calls: u32,
}

fn check(expect: &Expect, seen: &Observed<'_>) -> Checks {
    Checks {
        citations: expect.citations.map(|want| want != seen.cited.is_empty()),
        flow: expect.flow.as_ref().map(|id| seen.flow_ids.contains(id)),
        not_listed: expect.not_listed.map(|want| want == seen.not_listed),
        figure: expect.figure.map(|want| want == seen.has_figure),
        client_calls: expect
            .client_calls
            .map(|want| want == (seen.client_calls > 0)),
        sources: (!expect.sources.is_empty()).then(|| {
            expect
                .sources
                .iter()
                .any(|s| seen.cited.contains(s) || seen.reads.contains(s))
        }),
    }
}
