//! AI チャットで画面と受け渡す型。AI の種類（Claude など）に依らない形にする。
//! 後でほかの AI を足しても、画面はこの型だけを見ればよいようにするため。

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::ModTarget;

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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ToolState {
    Running,
    Done,
    Failed,
}

/// 画面で答えてもらう要求。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum ClientRequest {
    /// AI からの聞き返し。選択肢は 2〜4 個
    #[serde(rename_all = "camelCase")]
    AskUser {
        question: String,
        options: Vec<String>,
        multi_select: bool,
    },
}

/// `ClientRequest` への答え。
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum ClientToolResult {
    /// 選んだ選択肢か、自由に書いた答え
    AskUser { answer: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ChatNotice {
    /// 組織の設定で Web 検索が切られていたので、Web 検索なしで答えた
    WebSearchDisabled,
    /// ツールの往復の上限に達したので、そこまでの結果で答えさせた
    ToolLimitReached,
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
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
