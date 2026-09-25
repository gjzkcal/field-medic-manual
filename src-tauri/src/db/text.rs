//! 検索とタグで使う文字列の処理。

/// スニペットで強調部分の開始・終了を表す文字（Unicode の私用領域）。
/// HTML タグで囲むと、本文由来の文字列を TS 側で innerHTML に入れることになるため使わない。
/// TS 側の `src/features/search/snippet.ts` と同じ値にする。
pub const MARK_START: char = '\u{E000}';
pub const MARK_END: char = '\u{E001}';
pub const ELLIPSIS: &str = "…";

/// trigram トークナイザが索引を作れる最小の文字数。これ未満の語は FTS では引けない。
pub const TRIGRAM_MIN_CHARS: usize = 3;

#[must_use]
pub fn char_len(s: &str) -> usize {
    s.chars().count()
}

/// 検索クエリを語に分ける。全角スペースも区切りにする（`char::is_whitespace` は U+3000 を含む）。
#[must_use]
pub fn split_terms(query: &str) -> Vec<String> {
    let mut terms: Vec<String> = Vec::new();
    for term in query.split_whitespace() {
        let term = strip_marks(term);
        if !term.is_empty() && !terms.iter().any(|t| t.eq_ignore_ascii_case(&term)) {
            terms.push(term);
        }
    }
    terms
}

/// FTS5 の構文として解釈させないよう、語をダブルクォートで囲む（中の `"` は `""`）。
#[must_use]
pub fn fts_quote(term: &str) -> String {
    format!("\"{}\"", term.replace('"', "\"\""))
}

/// LIKE の部分一致パターン。`%` `_` を文字として扱うため `\` でエスケープする（`ESCAPE '\'` と組で使う）。
#[must_use]
pub fn like_pattern(term: &str) -> String {
    let mut out = String::with_capacity(term.len() + 2);
    out.push('%');
    for c in term.chars() {
        if matches!(c, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('%');
    out
}

/// 強調の目印を取り除く。本文に紛れ込んでいるとスニペットの強調が壊れるため。
#[must_use]
pub fn strip_marks(s: &str) -> String {
    s.chars()
        .filter(|&c| c != MARK_START && c != MARK_END)
        .collect()
}

/// タグを正規化する。前後の空白と先頭の `#` を除き、空は捨て、大文字小文字だけ違う重複をまとめる
/// （DB の tags.name が COLLATE NOCASE で、ASCII の大文字小文字を同じ語とみなすため）。
#[must_use]
pub fn normalize_tags(tags: &[String]) -> Vec<String> {
    normalize_terms(tags.iter().map(|t| t.trim().trim_start_matches('#')))
}

/// 語の並びを正規化する。前後の空白を除き、空は捨て、大文字小文字だけ違う重複をまとめる
/// （同義語の term も COLLATE NOCASE のため）。
#[must_use]
pub fn normalize_terms<'a>(terms: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for term in terms {
        let term = strip_marks(term.trim());
        if !term.is_empty() && !out.iter().any(|t| t.eq_ignore_ascii_case(&term)) {
            out.push(term);
        }
    }
    out
}

/// `needle` が最初に現れるバイト範囲。SQLite の LIKE と同じく ASCII だけ大文字小文字を区別しない。
#[must_use]
pub fn find_ci(haystack: &str, needle: &str) -> Option<(usize, usize)> {
    if needle.is_empty() {
        return None;
    }
    for (start, _) in haystack.char_indices() {
        let mut rest = haystack[start..].char_indices();
        let mut end = start;
        let mut matched = true;
        for n in needle.chars() {
            match rest.next() {
                Some((offset, h)) if h.eq_ignore_ascii_case(&n) => {
                    end = start + offset + h.len_utf8();
                }
                _ => {
                    matched = false;
                    break;
                }
            }
        }
        if matched {
            return Some((start, end));
        }
    }
    None
}

#[must_use]
pub fn contains_ci(haystack: &str, needle: &str) -> bool {
    find_ci(haystack, needle).is_some()
}

/// LIKE で見つけた行のスニペットを作る。FTS の `snippet()` と同じ形（目印で強調、前後を省略記号）に揃える。
/// `terms` のうち本文で最初に見つかった語を強調する。本文にない（タイトルやタグで当たった）場合は冒頭を返す。
#[must_use]
pub fn make_snippet(text: &str, terms: &[String], context_chars: usize) -> String {
    let hit = terms
        .iter()
        .filter_map(|t| find_ci(text, t))
        .min_by_key(|&(start, _)| start);
    let Some((start, end)) = hit else {
        let head: String = text.chars().take(context_chars * 2).collect();
        return if char_len(text) > context_chars * 2 {
            format!("{head}{ELLIPSIS}")
        } else {
            head
        };
    };
    let before: Vec<char> = text[..start].chars().collect();
    let skip = before.len().saturating_sub(context_chars);
    let prefix: String = before[skip..].iter().collect();
    let after = &text[end..];
    let suffix: String = after.chars().take(context_chars).collect();
    let mut out = String::new();
    if skip > 0 {
        out.push_str(ELLIPSIS);
    }
    out.push_str(&prefix);
    out.push(MARK_START);
    out.push_str(&text[start..end]);
    out.push(MARK_END);
    out.push_str(&suffix);
    if char_len(after) > context_chars {
        out.push_str(ELLIPSIS);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_on_ascii_and_fullwidth_spaces() {
        assert_eq!(
            split_terms(" 止血帯\u{3000}出血  cpr CPR "),
            ["止血帯", "出血", "cpr"]
        );
        assert!(split_terms(" \u{3000} ").is_empty());
    }

    #[test]
    fn quotes_fts_terms() {
        assert_eq!(fts_quote(r#"a"b"#), r#""a""b""#);
        assert_eq!(fts_quote("AND"), r#""AND""#);
    }

    #[test]
    fn escapes_like_wildcards() {
        assert_eq!(like_pattern(r"5%_\"), r"%5\%\_\\%");
    }

    #[test]
    fn normalizes_tags() {
        let tags = ["  #出血 ", "", "CPR", "cpr", "#"].map(str::to_owned);
        assert_eq!(normalize_tags(&tags), ["出血", "CPR"]);
    }

    #[test]
    fn finds_case_insensitively_by_bytes() {
        let text = "止血帯（Tourniquet）";
        let (s, e) = find_ci(text, "tourniquet").expect("見つかる");
        assert_eq!(&text[s..e], "Tourniquet");
        assert_eq!(find_ci(text, "出血"), None);
    }

    #[test]
    fn snippet_marks_first_hit_with_context() {
        let s = make_snippet(
            "あいうえおかきくけこ出血さしすせそたちつてと",
            &["出血".to_owned()],
            3,
        );
        assert_eq!(s, "…くけこ\u{E000}出血\u{E001}さしす…");
        let head = make_snippet("短い本文", &["無関係".to_owned()], 16);
        assert_eq!(head, "短い本文");
    }
}
