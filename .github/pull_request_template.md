## 概要

<!-- 何を、なぜ変えたか -->

## 関連する Issue

<!-- 例: Closes #12 -->

## 確認

- [ ] `pnpm lint` と `pnpm test` が通る
- [ ] Rust を変えたときは、`cargo fmt --check`・`cargo clippy --all-targets -- -D warnings`・`cargo test` が通る（`src-tauri/` で実行）
- [ ] 利用者に見える変更は、`CHANGELOG.md` の `## [Unreleased]` に書いた
- [ ] 本文（`content/`）を変えたときは、根拠（ACE のソースのファイルと行など）を上に書いた
- [ ] 画面を変えたときは、スクリーンショットを貼った
