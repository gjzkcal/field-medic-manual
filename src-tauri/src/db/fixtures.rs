//! テスト用のドキュメント。対象は dev-docs/reference/ace-medical-notes.md §4 に合わせる
//! （「出血」= core、「CPR」= circulation・dev、「止血帯」= general）。本文は骨子だけで処置を確定させない。

use crate::model::{DocMeta, DocUpsertInput, ModChannel, ModTarget, SectionInput, SourceType};

#[must_use]
pub fn section(level: u8, title: &str, anchor: &str, text: &str, tags: &[&str]) -> SectionInput {
    SectionInput {
        level,
        title: title.to_owned(),
        anchor: anchor.to_owned(),
        html: format!("<p>{text}</p>"),
        plain_text: text.to_owned(),
        page: None,
        tags: tags.iter().map(|&t| t.to_owned()).collect(),
    }
}

#[must_use]
pub fn doc(
    title: &str,
    source_path: &str,
    mod_target: Option<ModTarget>,
    mod_channel: Option<ModChannel>,
    tags: &[&str],
    sections: Vec<SectionInput>,
) -> DocUpsertInput {
    DocUpsertInput {
        title: title.to_owned(),
        source_type: SourceType::Markdown,
        source_path: Some(source_path.to_owned()),
        source_hash: format!("hash-of-{source_path}"),
        meta: DocMeta {
            mod_target,
            mod_channel,
            mod_version: None,
            verified_at: None,
            tags: tags.iter().map(|&t| t.to_owned()).collect(),
        },
        sections,
        asset_ids: Vec::new(),
        original_asset_id: None,
    }
}

#[must_use]
pub fn bleeding() -> DocUpsertInput {
    doc(
        "出血",
        "sample://bleeding",
        Some(ModTarget::Core),
        None,
        &["出血"],
        vec![
            section(1, "出血", "bleeding", "【要確認】出血への対応の骨子。", &[]),
            section(
                2,
                "出血の見分け方",
                "bleeding-signs",
                "【要確認】出血の程度（Class I〜IV）を確認する。",
                &["圧迫止血"],
            ),
        ],
    )
}

#[must_use]
pub fn cpr() -> DocUpsertInput {
    let mut d = doc(
        "心停止と CPR",
        "sample://cpr",
        Some(ModTarget::Circulation),
        Some(ModChannel::Dev),
        &["循環"],
        vec![section(
            1,
            "CPR の手順",
            "cpr-steps",
            "【要確認】心停止のときは CPR を行う。",
            &[],
        )],
    );
    d.meta.mod_version = Some("1.5.36".to_owned());
    d
}

#[must_use]
pub fn tourniquet() -> DocUpsertInput {
    doc(
        "止血帯",
        "sample://tourniquet",
        Some(ModTarget::General),
        None,
        &["止血帯"],
        vec![section(
            1,
            "止血帯を使う",
            "use-tourniquet",
            "【要確認】四肢の大量出血には止血帯を使う。",
            &[],
        )],
    )
}
