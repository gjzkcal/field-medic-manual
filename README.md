# Field Medic Manual

An **unofficial** desktop manual app for the ACE Medical mod in Arma Reforger (Windows, Tauri).
Arma Reforger の ACE Medical MOD 向けの**非公式**デスクトップ マニュアルアプリです（Windows、Tauri 製）。

プレイ中に「今どうすればいい？」を数秒で引けることを目指しています。

- ACE Medical（Dev 版）の仕様に基づくマニュアルを同梱し、オフラインで読めます
- 全文検索、症状から処置を引くクイック表、質問に答えて処置にたどり着くトリアージのフロー
- ホットキーで呼び出す、ゲームの上に重なる常に最前面の小窓
- 新しい版は起動時に自動で確かめて更新できます（マニュアルの本文の更新もこれで届きます）

## インストール

対応 OS は Windows 10 / 11（64 ビット）です。

1. [最新のリリース](https://github.com/gjzkcal/field-medic-manual/releases/latest)を開きます。
2. 「Assets」から、名前が **`_x64-setup.exe`** で終わるファイルをダウンロードします。
   - `.msi` は管理者権限でパソコン全体に入れる形式です。ふつうは使いません。
   - `.sig` と `latest.json` は自動更新用なので、ダウンロード不要です。
3. ダウンロードしたファイルを実行します。
   「Windows によって PC が保護されました」と出たら、**「詳細情報」→「実行」** を押してください。
   - このアプリはコード署名をしていないため、この表示が出ます（有料の証明書が要るため）。
4. インストーラの案内に従って進めます。管理者権限は要りません。

### 更新

起動時に新しい版を確かめ、あれば「新しい版があります」と出ます。「今すぐ更新」を押すと、ダウンロードとインストールをしてアプリが起動し直します。
手動で確かめるときは、「設定」→「このアプリについて」→「更新を確認」を押します。

### アンインストール

Windows の「設定」→「アプリ」→「インストールされているアプリ」から Field Medic Manual をアンインストールします。
お気に入り・履歴・設定は `%APPDATA%\com.gjzkcal.fieldmedicmanual\` に残ります。要らなければフォルダごと消してください。

## 使い方のコツ

- **ゲームは「ボーダーレス（ウィンドウ化フルスクリーン）」か「ウィンドウ」で動かしてください。** 「フルスクリーン」（排他的）では、小窓がゲームの上に出ません。
- ウィンドウの × を押すと、終了せずにタスクトレイに入ります（設定で変えられます）。終了はトレイのアイコンの右クリックメニューから。

| キー           | 動作                                                    |
| -------------- | ------------------------------------------------------- |
| `Ctrl+Shift+M` | 小窓の表示 / 非表示（ゲームの操作を奪わない閲覧モード） |
| `Ctrl+Shift+F` | 小窓で検索                                              |
| `Ctrl+Shift+T` | 小窓で、最後に開いたトリアージのフローを最初から        |
| `Ctrl+K`       | メインのウィンドウの検索欄へ                            |

ホットキーは「設定」→「ホットキー」で変えられます（Ctrl・Alt・Win のどれかを含む組み合わせ）。

## Disclaimer / 免責事項

This project is not affiliated with or authorized by Bohemia Interactive a.s. Bohemia Interactive, ARMA, DAYZ and all associated logos and designs are trademarks or registered trademarks of Bohemia Interactive a.s.

このプロジェクトは Bohemia Interactive a.s. と提携しておらず、同社の承認も受けていません。Bohemia Interactive、ARMA、DAYZ および関連するすべてのロゴとデザインは、Bohemia Interactive a.s. の商標または登録商標です。

This project is not an official release of ACE ([acemod/ACE-Anvil](https://github.com/acemod/ACE-Anvil), GPL-2.0-or-later) and is not endorsed by the ACE team.
このプロジェクトは ACE（[acemod/ACE-Anvil](https://github.com/acemod/ACE-Anvil)、GPL-2.0-or-later）の公式リリースではなく、ACE チームの承認も受けていません。

Medical procedures shown in the app are for gameplay only and may be outdated. Always check the official ACE documentation.
アプリ内の処置内容はゲーム内の遊び方の参考であり、古くなっている場合があります。必ず ACE の公式ドキュメントで確認してください。

## マニュアルの出典 / Sources

同梱のマニュアル・クイック表・トリアージのフロー（`content/`）は、ACE Medical のソースコードとドキュメント（[acemod/ACE-Anvil](https://github.com/acemod/ACE-Anvil)、GPL-2.0-or-later、Copyright (C) acemod）を作者が読んで要約・解説したものです。
対象の版と確認日は、マニュアル「このマニュアルについて」（`content/manuals/about-this-manual.md`）と各マニュアルの末尾に書いてあります。

The bundled manuals, quick reference and triage flows are the author's summaries of the ACE Medical source code and documentation (acemod/ACE-Anvil, GPL-2.0-or-later, Copyright (C) acemod).

## License / ライセンス

Copyright (C) 2026 gjzkcal

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See [LICENSE](LICENSE).

GNU General Public License v3.0 またはそれ以降のバージョン（GPL-3.0-or-later）で配布します。詳しくは [LICENSE](LICENSE) を参照してください。無料・非営利で提供します。同梱の原稿（`content/`）も同じライセンスです。

アプリに含まれるライブラリとフォントのライセンスは [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) にあります（アプリの「設定」→「このアプリについて」と、インストール先にも同じものがあります）。

## 開発 / Development

必要なもの: Rust（stable）、Node.js 24、pnpm 11、WebView2、[cargo-about](https://github.com/EmbarkStudios/cargo-about)（配布用のビルドだけで使う）

```sh
pnpm install
cargo install cargo-about --locked --features cli   # 依存のライセンス表記の生成に使う
pnpm tauri dev                                      # 開発起動
pnpm lint && pnpm test                              # 確認
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
```

### リリースの手順

本文（`content/`）だけを直したときも、同じ手順でアプリのリリースとして配ります。

1. `pnpm test` で原稿の検査を含むテストを通す。
2. `pnpm version:set 0.0.2` で版を上げる（`package.json`・`Cargo.toml`・`Cargo.lock` をそろえる。`tauri.conf.json` は `package.json` の版を使う）。
3. `CHANGELOG.md` に `## [0.0.2] - 日付` の節を書く。この節が Releases の本文と、アプリの更新のダイアログの「変更点」になる。
4. `pnpm lint` と `pnpm test` を通してコミットし、`git tag v0.0.2` → `git push origin main v0.0.2`。
5. GitHub Actions（`.github/workflows/release.yml`）が確認・ビルド・署名をして Releases に公開し、`latest.json` を置く。

リリースには、GitHub の Secrets に更新用の署名鍵（`TAURI_SIGNING_PRIVATE_KEY`・`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）が要ります。
