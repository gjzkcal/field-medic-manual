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

/// 原稿が前提にしている ACE Medical のモジュール（dev-docs/reference/ace-medical-notes.md）。
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

/// 横断検索の結果。Step 06 / 07 でクイック表とフローの種類を足す。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum SearchHit {
    Section(SectionHit),
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
