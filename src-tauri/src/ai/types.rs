//! AI チャットで画面と受け渡す型。AI の種類（Claude など）に依らない形にする。
//! 後でほかの AI を足しても、画面はこの型だけを見ればよいようにするため。

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{CasualtyDrug, ModTarget, TourniquetSite};

/// 選べるモデル。値は API のモデル ID そのもの。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum AiModel {
    #[serde(rename = "claude-opus-5-5")]
    ClaudeOpus55,
    #[serde(rename = "claude-sonnet-5-5")]
    ClaudeSonnet55,
    #[serde(rename = "claude-haiku-5-5")]
    ClaudeHaiku55,
}

impl AiModel {
    #[must_use]
    pub const fn id(self) -> &'static str {
        match self {
            Self::ClaudeOpus55 => "claude-opus-5-5",
            Self::ClaudeSonnet55 => "claude-sonnet-5-5",
            Self::ClaudeHaiku55 => "claude-haiku-5-5",
        }
    }
}

/// 考える量。3 つのモデルとも全部の段階を受け付ける。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AiEffort {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

impl AiEffort {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Xhigh => "xhigh",
            Self::Max => "max",
        }
    }
}

/// API キーの登録の状態。キーそのものは画面に返さない。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AiKeyStatus {
    Missing,
    Set,
    /// 資格情報マネージャーを使えない（Windows 以外、または OS 側の失敗）
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ImageMediaType {
    #[serde(rename = "image/png")]
    Png,
    #[serde(rename = "image/jpeg")]
    Jpeg,
    #[serde(rename = "image/webp")]
    Webp,
}

impl ImageMediaType {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Webp => "image/webp",
        }
    }
}

/// 質問に付けた画像。画面で縮めてから base64 にして送る。
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChatImage {
    pub media_type: ImageMediaType,
    /// base64（data: の接頭辞なし）
    pub data: String,
}

/// 質問を送る。モデル・Effort・MOD は会話の最初の質問のものを使い、途中では変えない。
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields)]
pub struct ChatSendInput {
    pub text: String,
    pub images: Vec<ChatImage>,
    pub model: AiModel,
    pub effort: AiEffort,
    /// 設定の「使っている MOD」（core と general は含めなくてよい）
    pub mods: Vec<ModTarget>,
    /// 指定すると、その番号の質問（0 始まり）から後ろを消してから送る。送った質問の編集に使う
    pub replace_from: Option<u32>,
}

/// 回答の出典。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum ChatCitation {
    /// 同梱の原稿・クイック表。source は `doc:<ファイル名>#<アンカー>` か `quickref:<id>`
    #[serde(rename_all = "camelCase")]
    Manual {
        source: String,
        title: String,
        cited_text: String,
    },
    /// Web 検索で語の意味を調べたときの出典
    #[serde(rename_all = "camelCase")]
    Web {
        url: String,
        title: String,
        cited_text: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ToolKind {
    SearchManual,
    ReadSection,
    WebSearch,
    /// 負傷者の記録を読む（画面が答える）
    CasualtyRead,
    /// グラフを作る（画面が計算して描く）
    ChartCreate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ToolState {
    Running,
    Done,
    Failed,
}

/// グラフの薬。濃度の仕組みがある薬だけ（炭酸アンモニウムは推移を計算できない）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ChartDrug {
    Epinephrine,
    Metoprolol,
    Morphine,
    Naloxone,
    Phenylephrine,
}

/// 投与からの推移を何の量で描くか。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ChartMetric {
    /// 1 本のピークを 100 とした効能（負傷者の画面と同じ）
    Effect,
    /// 体内の濃度
    Concentration,
    /// 心拍数（bpm）
    HeartRate,
    /// 収縮期と拡張期の血圧（mmHg）。線は 2 本
    BloodPressure,
    /// 平均血圧（mmHg）
    MeanPressure,
    /// SpO2（%）。Breathing を使っているときだけ
    Spo2,
}

const fn full_percent() -> u8 {
    100
}

/// 心拍数・血圧・SpO2 を計算する患者の状態。AI が渡さなかった項目は、健康な患者の値にする。
/// 渡した値と `changes` だけで決まる（出血や気胸の悪化のように、ゲームの中で進む分は、画面の計算に入っていない）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChartPatient {
    /// 血液量（%）
    #[serde(default = "full_percent")]
    pub blood: u8,
    /// 痛みの HP（%）。100 で痛みなし、低いほど痛い
    #[serde(default = "full_percent")]
    pub pain: u8,
    /// 気道が塞がっている（舌根・嘔吐）。グラフの 0 秒に塞がったものとして計算する
    #[serde(default)]
    pub blocked: bool,
    /// 気胸の大きさ（%）。ゲームでは 18 刻みで、75 に達すると心停止になる
    #[serde(default)]
    pub pneumothorax: u8,
    /// 緊張性気胸
    #[serde(default)]
    pub tension: bool,
    /// 酸素マスクを付けている
    #[serde(default)]
    pub mask: bool,
}

impl Default for ChartPatient {
    fn default() -> Self {
        Self {
            blood: full_percent(),
            pain: full_percent(),
            blocked: false,
            pneumothorax: 0,
            tension: false,
            mask: false,
        }
    }
}

/// 患者の状態を途中で変える（処置や悪化）。書いた項目だけが変わる。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChartChange {
    /// グラフの始まりからの秒数。この時刻の次の 1 秒から効く
    pub seconds: u32,
    #[serde(default)]
    pub blood: Option<u8>,
    #[serde(default)]
    pub pain: Option<u8>,
    #[serde(default)]
    pub blocked: Option<bool>,
    #[serde(default)]
    pub pneumothorax: Option<u8>,
    #[serde(default)]
    pub tension: Option<bool>,
    #[serde(default)]
    pub mask: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChartDose {
    pub drug: ChartDrug,
    /// グラフの始まりからの秒数
    pub seconds: u32,
}

/// 仮の投与。画面が推移を計算する（効能と濃度は負傷者の画面と同じ計算）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChartScenario {
    pub label: String,
    /// 同じ投与から出す量。量ごとに線になる
    pub metrics: Vec<ChartMetric>,
    /// 薬を打たずに、患者の状態だけの推移を見るなら空（そのときは `until` が要る）
    pub doses: Vec<ChartDose>,
    #[serde(default)]
    pub patient: ChartPatient,
    #[serde(default)]
    pub changes: Vec<ChartChange>,
    /// 何秒まで描くか。0 なら、すべての投与が体内から消えるまで
    #[serde(default)]
    pub until: u32,
}

/// 負傷者の記録にある投与からの推移。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChartCasualty {
    /// `casualty_read` の負傷者の id
    pub casualty: String,
    pub metrics: Vec<ChartMetric>,
    #[serde(default)]
    pub patient: ChartPatient,
    #[serde(default)]
    pub changes: Vec<ChartChange>,
    /// 何秒まで描くか。0 なら、すべての投与が体内から消えるまで
    #[serde(default)]
    pub until: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChartValuePoint {
    pub x: f64,
    pub y: f64,
}

/// 利用者が渡した数値の線。AI が計算した値は入れさせない（system プロンプトで禁じる）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChartValues {
    pub label: String,
    /// 縦の値の単位。なければ空
    pub unit: String,
    /// 横の値が分か（false なら秒）。秒への換算は画面が行う
    pub minutes: bool,
    pub points: Vec<ChartValuePoint>,
}

/// AI が指定するグラフの条件。点は持たず、画面が計算する（AI に計算させないため）。
/// フィールド名は AI が書くので 1 語にする。
///
/// 原稿の節にあるグラフ・表の線。値は画面が節から取る（AI に数値を書き写させないため）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChartSection {
    /// 節の source（`doc:<ファイル名>#<アンカー>`）。配下の節も探す
    pub source: String,
    /// グラフになっていない表を使うときの、横軸の列の見出し。節のグラフを使うなら空
    #[serde(default)]
    pub x: String,
    /// 使う線の名前（表なら列の見出し）。空なら、節のグラフの線を全部
    #[serde(default)]
    pub lines: Vec<String>,
}

/// 種類ごとの配列に分けているのは、種類で形が変わる 1 つの配列（anyOf）より、AI が形を取り違えにくいため。
/// このツールは strict にできない（文法の大きさの上限に当たる）ので、使わない配列を AI が省いても読めるようにする。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChartRequest {
    pub title: String,
    #[serde(default)]
    pub scenarios: Vec<ChartScenario>,
    #[serde(default)]
    pub casualties: Vec<ChartCasualty>,
    #[serde(default)]
    pub sections: Vec<ChartSection>,
    #[serde(default)]
    pub values: Vec<ChartValues>,
}

/// 画面で答えてもらう要求。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum ClientRequest {
    /// グラフの条件。画面が点を計算して回答の中に描き、線ごとの要約を返す
    ChartCreate { chart: ChartRequest },
    /// AI からの聞き返し。選択肢は 2〜4 個
    #[serde(rename_all = "camelCase")]
    AskUser {
        question: String,
        options: Vec<String>,
        multi_select: bool,
    },
    /// 負傷者の記録を読む。画面が記録と薬の効きの計算を文にして返す（計算は負傷者の画面と同じものを使うため）
    CasualtyRead,
    /// 負傷者の記録への操作の提案。画面が承認のカードを出し、承認されたら記録する
    CasualtyPropose {
        summary: String,
        ops: Vec<ProposedOp>,
    },
}

/// AI が提案する、負傷者の記録への操作。`CasualtyOp` と同じ操作で、負傷者は id か、同じ提案の中で直前に作った負傷者を指す `"new"`。
/// 作る負傷者の id は記録するまで決まらないため。フィールド名は AI が書くので 1 語にする。
///
/// NOTE: 種類のキーを `action` にし、記録の種類（`CasualtyEntry`）も入れ子にせず操作に平らにしている。
/// strict のツールはキーを名前の順に書かせるので、種類のキーがどの形でも先頭に来ないと、AI が種類を先に書いたときに
/// キーが 1 つだけの形（全消去）へ押し込まれる（実際の API で、記録の追加の提案が全消去になった）。
/// `action` は、ほかのどのキーより名前の順で前に来る。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "action", rename_all = "snake_case")]
#[ts(export)]
pub enum ProposedOp {
    /// 名前が空なら、画面が「負傷者 N」を付ける
    AddCasualty {
        name: String,
    },
    RemoveCasualty {
        casualty: String,
    },
    ClearAll,
    GiveDrug {
        casualty: String,
        drug: CasualtyDrug,
    },
    GiveSaline {
        casualty: String,
    },
    TourniquetOn {
        casualty: String,
        site: TourniquetSite,
    },
    TourniquetOff {
        casualty: String,
        site: TourniquetSite,
    },
    AddNote {
        casualty: String,
        text: String,
    },
    RemoveRecord {
        casualty: String,
        record: String,
    },
    SetPain {
        casualty: String,
        pain: bool,
    },
}

/// `ClientRequest` への答え。
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum ClientToolResult {
    /// 選んだ選択肢か、自由に書いた答え
    AskUser { answer: String },
    /// 記録を読んだ結果の文
    CasualtyRead { text: String },
    /// 承認されたか。承認されて記録の途中で失敗したら error に理由
    CasualtyPropose {
        approved: bool,
        error: Option<String>,
    },
    /// 描いたグラフの要約（線ごとの始め・最大・最小・終わり）。描けなかったら error に理由
    ChartCreate {
        summary: String,
        error: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ChatNotice {
    /// 組織の設定で Web 検索が切られていたので、Web 検索なしで答えた
    WebSearchDisabled,
    /// ツールの往復の上限に達したので、そこまでの結果で答えさせた
    ToolLimitReached,
    /// 会話の途中の effort の変更を API が受け付けなかったので、会話の最初の effort のまま答えた
    EffortChangeUnsupported,
}

/// トークン数の累計（1 回の質問のうちに API を何度呼んでも合わせる）。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChatUsage {
    #[ts(type = "number")]
    pub input_tokens: u64,
    #[ts(type = "number")]
    pub output_tokens: u64,
    #[ts(type = "number")]
    pub cache_read_tokens: u64,
    #[ts(type = "number")]
    pub cache_write_tokens: u64,
    #[ts(type = "number")]
    pub web_searches: u64,
}

impl ChatUsage {
    pub fn add(&mut self, other: Self) {
        self.input_tokens += other.input_tokens;
        self.output_tokens += other.output_tokens;
        self.cache_read_tokens += other.cache_read_tokens;
        self.cache_write_tokens += other.cache_write_tokens;
        self.web_searches += other.web_searches;
    }
}

/// 回答の途中で画面に流すもの。`block` は 1 回の質問の中で通しの番号（ツールの往復をまたいでも重ならない）。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum ChatEvent {
    Text {
        block: u32,
        text: String,
    },
    /// 考えている途中の要約
    Thinking {
        block: u32,
        text: String,
    },
    Citation {
        block: u32,
        citation: ChatCitation,
    },
    /// 原稿の検索・節の読み出し・Web 検索の様子。`detail` は検索の語や読んだ節
    ToolActivity {
        id: String,
        tool: ToolKind,
        detail: String,
        state: ToolState,
    },
    /// 画面で答えてもらう。答えは `ai_chat_tool_result` で返す
    #[serde(rename_all = "camelCase")]
    ClientRequest {
        tool_use_id: String,
        request: ClientRequest,
    },
    Notice {
        notice: ChatNotice,
    },
    /// API に要求を送る直前（ツールの往復ごと）。キャッシュの期限は要求の開始から数えるので、画面が保温の予約の基準にする
    RequestStarted,
    /// API を 1 回呼ぶごとの累計
    Usage {
        usage: ChatUsage,
    },
}

/// 質問 1 回の結果。失敗は `Err(AppError)` で返し、ここには入れない。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum TurnStatus {
    Completed,
    /// 出力の上限で途中まで。会話には残すので「続けて」で続きを頼める
    Truncated,
    /// 拒否された。会話には残さない
    Refused {
        category: Option<String>,
        explanation: Option<String>,
    },
    /// 利用者が止めた・会話を消した。会話には残さない
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChatTurnResult {
    pub status: TurnStatus,
    pub usage: ChatUsage,
    /// この質問の番号（0 始まり）。会話に残らなかったときは None。編集で `replace_from` に渡す
    pub turn_index: Option<u32>,
}
