//! IPC で受け渡す型。ts-rs で `src/lib/bindings/` に TS の型を生成する（`cargo test` 時）。

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// DB に TEXT で保存する列挙型の相互変換を作る。
/// serde の表記と DB の表記を同じ文字列に揃え、TS・Rust・DB の 3 か所で値がずれないようにするため。
macro_rules! text_enum {
    ($name:ident { $($variant:ident => $text:literal),+ $(,)? }) => {
        impl $name {
            pub const ALL: &[Self] = &[$(Self::$variant),+];

            #[must_use]
            pub const fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $text),+
                }
            }
        }

        impl ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
                Ok(self.as_str().into())
            }
        }

        impl FromSql for $name {
            fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
                match value.as_str()? {
                    $($text => Ok(Self::$variant),)+
                    other => Err(FromSqlError::Other(
                        format!("{} の値として不正です: {other}", stringify!($name)).into(),
                    )),
                }
            }
        }
    };
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum SourceType {
    Markdown,
    Text,
    Html,
    Docx,
    Pdf,
    Url,
}
text_enum!(SourceType {
    Markdown => "markdown",
    Text => "text",
    Html => "html",
    Docx => "docx",
    Pdf => "pdf",
    Url => "url",
});

/// 原稿が前提にしている ACE Medical のモジュール。
/// Release と Dev で公開されているモジュールが違うが、この値で両方の版を過不足なく表せる。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ModTarget {
    Core,
    Hitzones,
    Circulation,
    Breathing,
    Defibrillation,
    Ai,
    General,
}
text_enum!(ModTarget {
    Core => "core",
    Hitzones => "hitzones",
    Circulation => "circulation",
    Breathing => "breathing",
    Defibrillation => "defibrillation",
    Ai => "ai",
    General => "general",
});

/// ACE の版。`None`（DB では NULL）は「版を問わない / 不明」。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ModChannel {
    Release,
    Dev,
}
text_enum!(ModChannel {
    Release => "release",
    Dev => "dev",
});

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DocMeta {
    pub mod_target: Option<ModTarget>,
    pub mod_channel: Option<ModChannel>,
    /// Workshop の表記（例: 1.4.3 / 1.5.36）
    pub mod_version: Option<String>,
    /// YYYY-MM-DD
    pub verified_at: Option<String>,
    pub tags: Vec<String>,
    /// ライブラリと見出しツリーでの順番（小さいほど前）。ないものはタイトル順で後ろに並ぶ
    pub order: Option<u32>,
    /// 分類。ライブラリと見出しツリーで同じ分類の原稿をまとめる。ないものは末尾の「その他」に並ぶ
    pub category: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SectionInput {
    /// 0 = 見出し前の導入部、1〜6
    pub level: u8,
    pub title: String,
    /// ドキュメント内で一意
    pub anchor: String,
    /// `DOMPurify` で無害化済みの HTML
    pub html: String,
    pub plain_text: String,
    /// PDF のページ番号（1 始まり）
    pub page: Option<u32>,
    /// 本文にない語でも検索に掛けるためのタグ
    pub tags: Vec<String>,
}

/// `doc_upsert` の入力。アセットは bytes を含めず、先に `asset_put` で得た id で参照する（大きなバイナリを JSON に載せないため）。
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DocUpsertInput {
    pub title: String,
    pub source_type: SourceType,
    /// 同じ値のドキュメントがあれば置き換える
    pub source_path: Option<String>,
    pub source_hash: String,
    pub meta: DocMeta,
    pub sections: Vec<SectionInput>,
    pub asset_ids: Vec<String>,
    pub original_asset_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DocSummary {
    pub id: String,
    pub title: String,
    pub source_type: SourceType,
    pub source_path: Option<String>,
    /// 取り込み直しで「変更なし」を判定するために一覧でも返す
    pub source_hash: String,
    pub meta: DocMeta,
    pub section_count: u32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Section {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number | null")]
    pub parent_id: Option<i64>,
    pub level: u8,
    pub title: String,
    pub anchor: String,
    pub order_index: u32,
    pub html: String,
    pub plain_text: String,
    pub page: Option<u32>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AssetMeta {
    /// sha256（小文字 16 進）
    pub id: String,
    pub mime: String,
    pub file_name: String,
    #[ts(type = "number")]
    pub size: i64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DocDetail {
    #[serde(flatten)]
    pub summary: DocSummary,
    pub original_asset_id: Option<String>,
    pub assets: Vec<AssetMeta>,
    pub sections: Vec<Section>,
}

/// 検索の絞り込み。省略した条件は掛けない。
#[derive(Debug, Clone, Default, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, optional_fields)]
pub struct SearchFilter {
    /// いずれかに一致
    pub mod_targets: Option<Vec<ModTarget>>,
    /// 指定した版か、版を問わない（NULL）ドキュメント
    pub mod_channel: Option<ModChannel>,
    /// ドキュメントかセクションに、すべてのタグが付いている
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SectionHit {
    /// セクションの id
    #[ts(type = "number")]
    pub id: i64,
    pub title: String,
    /// 強調部分を U+E000（開始）と U+E001（終了）で囲んだ本文の抜粋。HTML ではない
    pub snippet: String,
    /// 大きいほど上位
    pub score: f64,
    pub document_id: String,
    pub document_title: String,
    pub anchor: String,
    /// 入力した語そのものは含まず、同義語だけでヒットした
    pub synonym_only: bool,
    /// この節に実際に含まれていた語（同義語で広げた候補を含む）。開いた先で検索語をハイライトするのに使う
    pub matched_terms: Vec<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FlowHit {
    /// フローの id（スラッグ）
    pub id: String,
    pub title: String,
    /// `SectionHit.snippet` と同じ形（U+E000 / U+E001 で強調）。ノードの文から作る
    pub snippet: String,
    /// 大きいほど上位。LIKE の当たり方で付けるので、節の score とは比べられない
    pub score: f64,
    /// 入力した語そのものは含まず、同義語だけでヒットした
    pub synonym_only: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QuickrefHit {
    /// 行の id（スラッグ）
    pub id: String,
    /// 症状
    pub title: String,
    pub category: String,
    /// 1=軽度 2=中等度 3=重度 4=致命的
    pub severity: u8,
    /// 表示条件（結果の説明に出す。検索は設定の「使っている MOD」では絞らないため）
    pub mods: Vec<ModTarget>,
    pub without_mods: Vec<ModTarget>,
    /// `SectionHit.snippet` と同じ形（U+E000 / U+E001 で強調）。手順・物品・備考から作る
    pub snippet: String,
    /// 大きいほど上位。LIKE の当たり方で付けるので、節の score とは比べられない
    pub score: f64,
    /// 入力した語そのものは含まず、同義語だけでヒットした
    pub synonym_only: bool,
}

/// 横断検索の結果。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum SearchHit {
    Section(SectionHit),
    Flow(FlowHit),
    Quickref(QuickrefHit),
}

/// クイック表の 1 行。形の検査は TS の zod で行い、Rust は DB に入れてよい最低限を確かめる。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QuickrefRow {
    /// スラッグ。お気に入りと `quickref:<id>` のリンクで使う
    pub id: String,
    pub category: String,
    pub symptom: String,
    /// 1=軽度 2=中等度 3=重度 4=致命的
    pub severity: u8,
    /// 手順（1 要素 1 動作）
    pub treatment: Vec<String>,
    pub items: Vec<String>,
    pub notes: Option<String>,
    /// `doc:<ファイル名>#<anchor>` / `flow:<id>` / `quickref:<id>` / `https://…`
    pub links: Vec<String>,
    /// この MOD をすべて入れているときだけ出す
    pub mods: Vec<ModTarget>,
    /// この MOD をどれも入れていないときだけ出す
    pub without_mods: Vec<ModTarget>,
}

/// `quickref_replace_all` の入力。同梱ファイル 1 つ分で、全行を置き換える。
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QuickrefReplaceInput {
    pub source_hash: String,
    pub mod_channel: Option<ModChannel>,
    /// YYYY-MM-DD
    pub verified_at: Option<String>,
    /// ファイルに書いた順
    pub rows: Vec<QuickrefRow>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QuickrefTable {
    /// まだ一度も同期していなければ null（起動時の同期で「変更なし」を判定するため）
    pub source_hash: Option<String>,
    pub mod_channel: Option<ModChannel>,
    pub verified_at: Option<String>,
    /// ファイルに書いた順
    pub rows: Vec<QuickrefRow>,
}

/// `triage_upsert` の入力。一覧・絞り込み・検索に使う値は、TS がフローの JSON から写して渡す
/// （Rust がフローの形を解釈せずに済むようにするため。形の検査は TS の zod と validate.ts で行う）。
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TriageUpsertInput {
    /// スラッグ。同じ id のフローがあれば置き換える
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub mod_targets: Vec<ModTarget>,
    pub mod_channel: Option<ModChannel>,
    /// YYYY-MM-DD
    pub verified_at: Option<String>,
    pub version: u32,
    /// フロー全体の JSON（形は TS の `src/features/triage/schema.ts`）
    pub json: String,
    /// ノードの文などを改行でつないだもの（検索用）
    pub search_text: String,
    pub source_hash: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TriageSummary {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub mod_targets: Vec<ModTarget>,
    pub mod_channel: Option<ModChannel>,
    pub verified_at: Option<String>,
    pub version: u32,
    /// 起動時の同期で「変更なし」を判定するために一覧でも返す
    pub source_hash: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TriageDetail {
    #[serde(flatten)]
    pub summary: TriageSummary,
    pub json: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TagCount {
    pub name: String,
    pub document_count: u32,
    pub section_count: u32,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SynonymGroup {
    #[ts(type = "number")]
    pub id: i64,
    pub terms: Vec<String>,
    pub note: Option<String>,
    pub updated_at: String,
}

/// `id` が null なら新規作成、あれば置き換え。
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SynonymGroupInput {
    #[ts(type = "number | null")]
    pub id: Option<i64>,
    pub terms: Vec<String>,
    pub note: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn serde_text<T: Serialize>(value: T) -> String {
        match serde_json::to_value(value).expect("列挙型はシリアライズできる") {
            serde_json::Value::String(s) => s,
            other => panic!("文字列ではありません: {other}"),
        }
    }

    // DB の表記（as_str）と IPC の表記（serde）がずれると、保存した値を TS が解釈できなくなる
    #[test]
    fn text_enums_match_serde_names() {
        for v in SourceType::ALL {
            assert_eq!(serde_text(v), v.as_str());
        }
        for v in ModTarget::ALL {
            assert_eq!(serde_text(v), v.as_str());
        }
        for v in ModChannel::ALL {
            assert_eq!(serde_text(v), v.as_str());
        }
    }

    #[test]
    fn search_hit_is_tagged_by_kind() {
        let hit = SearchHit::Section(SectionHit {
            id: 1,
            title: "t".to_owned(),
            snippet: "s".to_owned(),
            score: 1.0,
            document_id: "d".to_owned(),
            document_title: "dt".to_owned(),
            anchor: "a".to_owned(),
            synonym_only: false,
            matched_terms: vec!["t".to_owned()],
        });
        let json = serde_json::to_value(hit).expect("SearchHit はシリアライズできる");
        assert_eq!(json["kind"], "section");
        assert_eq!(json["documentId"], "d");
        assert_eq!(json["matchedTerms"][0], "t");
    }
}

/// ビューアの左のツリーに出す見出し（h1〜h3）。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OutlineHeading {
    pub level: u8,
    pub title: String,
    pub anchor: String,
}

/// 全ドキュメントの見出しの一覧。ツリーのために全文書の本文の HTML を IPC で運ばないよう、見出しだけを返す。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DocOutline {
    pub id: String,
    pub title: String,
    pub source_path: Option<String>,
    pub meta: DocMeta,
    pub headings: Vec<OutlineHeading>,
}

/// お気に入り・履歴の対象。節は同期で INTEGER の id が振り直されるので、文書の id とアンカーで指す。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum PrefTarget {
    #[serde(rename_all = "camelCase")]
    Section { document_id: String, anchor: String },
    #[serde(rename_all = "camelCase")]
    Document { document_id: String },
    #[serde(rename_all = "camelCase")]
    Flow { flow_id: String },
    #[serde(rename_all = "camelCase")]
    Quickref { row_id: String },
}

/// お気に入り・履歴の一覧の 1 行。対象が今も DB にあるものだけを返す。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PrefItem {
    pub target: PrefTarget,
    /// 節の題名 / 文書の題名 / フローの題名 / クイック表の症状
    pub title: String,
    /// どこにあるか（節なら文書の題名、クイック表の行ならカテゴリ）。なければ null
    pub context: Option<String>,
    /// お気に入りに入れた日時、または最後に開いた日時（UTC の ISO 8601）
    pub at: String,
}

/// ホットキーで呼び出す動作。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum HotkeyAction {
    /// 小窓の表示 / 非表示（フォーカスしない）
    Toggle,
    /// 小窓を出して検索欄にフォーカス
    Search,
    /// 小窓で直近のフローを開く
    Triage,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HotkeyBinding {
    pub action: HotkeyAction,
    /// `Ctrl+Shift+M` の形
    pub accelerator: String,
    pub default_accelerator: String,
    /// 登録に失敗したときの理由（他のアプリが使っているなど）。登録できていれば null
    pub error: Option<String>,
}

/// Rust から小窓へ送る、呼び出しのモード（イベント `overlay-mode`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum OverlayMode {
    /// 表示だけ（フォーカスしない）
    View,
    Search,
    Triage,
}
