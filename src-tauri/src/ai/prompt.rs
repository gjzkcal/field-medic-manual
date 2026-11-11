//! system プロンプトと索引。会話の開始時に 1 回だけ作る（途中で変えると thinking の署名が無効になる）。

use std::fmt::Write as _;

use crate::ai::corpus::{Corpus, condition_label, mod_label, quickref_source, section_source};
use crate::model::ModTarget;

/// 索引に載せる本文の冒頭の長さ（文字数）。AI が意味で節を選ぶ手掛かりにする
const LEAD_CHARS: usize = 100;

// WARNING: 「考えた過程を書き出して」のような指示を入れない。reasoning_extraction の拒否を招く（Claude API の資料）
const RULES: &str = "\
あなたは、Arma Reforger の MOD「ACE Medical」の非公式マニュアルアプリ「Field Medic Manual」のアシスタントです。\
利用者はゲームの中の医療（衛生兵の操作）について、調べものだけでなく、相談や疑問を投げかけます。\
詳しい仲間として、利用者の疑問そのものに答えてください。

# 事実と判断
- 事実（数値・仕様・操作・効き方）の根拠は、このアプリに同梱した原稿（下の索引にある節）とクイック表だけです。
- 答える前に、必ず search_manual か read_section で節の本文を読んでください。索引の冒頭だけで答えないでください。
- 事実は、読んだ節に書いてあることだけを書き、引用を付けてください。節にない数値や仕様を作らないでください。事実を聞かれて根拠の節が見つからなければ「マニュアルに載っていません」と答え、近い節があれば示してください。
- 「どうすればいい」「いつ使う」「どう思う」のような相談には、読んだ事実とゲームの仕組みから考えて、あなたの判断をはっきり答えてください。「マニュアルに推奨は載っていません」で終わらせないでください。
  - 結論（どうするか）を先に書き、理由として事実を引用付きで示してください。判断の文には引用を付けません（引用の有無で、事実と判断を見分けられるようにするため）。
  - 判断が条件で変わるときは、条件ごとに分けて答えてください。
  - クイック表に手順があれば、それに沿って答えてください。違う判断をするときは理由を書いてください。
  - 「マニュアルが定めた手順ではない」のような断りは、要るときに 1 回だけ、短く書いてください。くり返さないでください。

# 言い方の違い
- 利用者の言い方は、原稿と違うことがあります（略語・俗称・英語名・症状の言い方）。索引の見出し・タグ・冒頭と同義語から、意味で節を選んで read_section で読んでください。
- search_manual は文字が一致しないと当たりません。原稿の語に言い換えて探してください。

# Web 検索
- 索引にも同義語にもなく、意味が分からない語があるときだけ使ってください。
- 使うのは語の意味を知るためだけです。Web の内容を答えの根拠にしないでください。

# 聞き返し（ask_user）
- 答えによって当てはまる節や処置が変わるのに、質問からそれが分からないときだけ使ってください（例: 「意識がない」だけで、呼吸の有無が分からない）。
- 質問の意図が 2 通り以上に読めるときも使ってください。推測で長く答えるより、先に聞いてください。
- 下に書いた利用者の MOD など、すでに分かっていることは聞かないでください。
- 1 つの質問につき 2 回までです。選択肢は 2〜4 個にし、短く書いてください。

# MOD
- 利用者の MOD に合う内容で答えてください。節の題に条件（例: 「Circulation あり」）が付いています。
- 表の列の見出しに MOD の条件があるときは、利用者の MOD に合う列を使ってください。
- 利用者の MOD に合わない内容は、聞かれたときだけ、その旨を書いて示してください（search_manual の include_other_mods を使う）。

# 現実の医療
- ゲームの中の話として答えてください。現実のけがや病気の相談には答えず、医療機関に相談するよう伝えてください。

# 図
- 根拠の節に図があり（索引の「図あり」）、見せると分かりやすいときは、回答の中に次の形で書いてください。中身は節の source だけです。
```figure
doc:hemorrhage.md#止血帯を使う
```
- 図・絵・mermaid・文字で描いた図は、自分で描かないでください。

# 画像
- 利用者がゲームの画面を送ることがあります。写っている表示や数値を読み取り、それに合う節を探して答えてください。写っていないことは推測で補わないでください。

# 書き方
- 日本語で、最初の 1〜2 文で質問に直接答えてください。そのあとに理由と補足を書き、短くまとめてください。
- 質問に答えるのに要ることだけを書いてください。聞かれていない節の内容を並べないでください。
- 前の回答で示した数値や内容は、くり返さないでください。要るときは短く触れるだけにしてください。
- Markdown（見出し・箇条書き・表・数式 $...$）を使えます。
- 読んだ節やクイック表に基づく文には、必ずその節を引用として付けてください。利用者は引用から節を開いて確かめます。
- 本文には、外部のリンクや出典の名前（「止血帯の節によると」「（止血帯の節）」など）を書かないでください。出典は引用で示してください（画面が引用の場所に節の名前を出します）。";

/// system プロンプトの全体。
#[must_use]
pub fn system_prompt(corpus: &Corpus, mods: &[ModTarget]) -> String {
    let mut out = String::from(RULES);
    out.push_str("\n\n# 利用者の MOD\n");
    let enabled: Vec<&str> = mods
        .iter()
        .filter(|m| !matches!(m, ModTarget::Core | ModTarget::General))
        .map(|m| mod_label(*m))
        .collect();
    let _ = writeln!(
        out,
        "Core（常に有効）{}",
        if enabled.is_empty() {
            "だけ".to_owned()
        } else {
            format!("、{}", enabled.join("、"))
        }
    );
    out.push('\n');
    out.push_str(&index(corpus));
    out
}

/// 索引。決まった順（文書は一覧の順、節は本文の順）に並べる。順が変わるとキャッシュが効かないため。
#[must_use]
pub fn index(corpus: &Corpus) -> String {
    let mut out = String::from(
        "# 索引\n各行は「source｜見出し｜タグ｜条件｜図｜本文の冒頭」です。source は read_section にそのまま渡せます。\n",
    );
    for doc in &corpus.docs {
        let _ = writeln!(out, "\n## {}", doc.title);
        for section in &doc.sections {
            let indent = "  ".repeat(usize::from(section.level.saturating_sub(1)));
            let mut fields = vec![
                section_source(&doc.file, &section.anchor),
                if section.level == 0 {
                    "（導入）".to_owned()
                } else {
                    section.title.clone()
                },
            ];
            if !section.tags.is_empty() {
                fields.push(format!("タグ: {}", section.tags.join("、")));
            }
            if let Some(label) = condition_label(&section.mods, &section.without_mods) {
                fields.push(format!("条件: {label}"));
            }
            if section.has_figure {
                fields.push("図あり".to_owned());
            }
            let lead = lead(&section.text);
            if !lead.is_empty() {
                fields.push(lead);
            }
            let _ = writeln!(out, "{indent}- {}", fields.join("｜"));
        }
    }
    if !corpus.quickref.is_empty() {
        out.push_str("\n## クイック表（症状 → 処置）\n");
        for row in &corpus.quickref {
            let mut fields = vec![
                quickref_source(&row.id),
                format!("{}（{}）", row.symptom, row.category),
            ];
            if let Some(label) = condition_label(&row.mods, &row.without_mods) {
                fields.push(format!("条件: {label}"));
            }
            let _ = writeln!(out, "- {}", fields.join("｜"));
        }
    }
    if !corpus.synonyms.is_empty() {
        out.push_str("\n## 同義語（同じものを指す言い方）\n");
        for terms in &corpus.synonyms {
            let _ = writeln!(out, "- {}", terms.join(" = "));
        }
    }
    out
}

fn lead(text: &str) -> String {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = flat.chars();
    let head: String = chars.by_ref().take(LEAD_CHARS).collect();
    if chars.next().is_some() {
        format!("{head}…")
    } else {
        head
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::corpus::fixtures;

    #[test]
    fn index_lists_sources_conditions_and_synonyms() {
        let text = index(&fixtures::corpus());
        assert!(text.contains("- doc:hemorrhage.md｜（導入）｜出血の止め方。"));
        assert!(text.contains("- doc:hemorrhage.md#止血帯を使う｜止血帯を使う｜タグ: 止血｜図あり｜腕か脚に巻く。 巻いた時刻を覚える。"));
        assert!(text.contains(
            "  - doc:hemorrhage.md#Circulation の止血｜Circulation の止血｜条件: Circulation あり｜"
        ));
        assert!(text.contains("- 止血帯 = TQ"));
    }

    #[test]
    fn index_is_deterministic() {
        let corpus = fixtures::corpus();
        assert_eq!(index(&corpus), index(&corpus));
    }

    #[test]
    fn system_prompt_states_the_users_mods() {
        let corpus = fixtures::corpus();
        let with = system_prompt(&corpus, &[ModTarget::Circulation, ModTarget::Breathing]);
        assert!(with.contains("Core（常に有効）、Circulation、Breathing"));
        let none = system_prompt(&corpus, &[]);
        assert!(none.contains("Core（常に有効）だけ"));
    }

    #[test]
    fn lead_is_cut_at_the_limit() {
        let long = "あ".repeat(LEAD_CHARS + 5);
        assert_eq!(lead(&long).chars().count(), LEAD_CHARS + 1);
        assert_eq!(lead("短い"), "短い");
    }
}
