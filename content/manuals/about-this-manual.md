---
title: この原稿の読み方
mod: general
channel: dev
mod_version: "1.5.36"
verified_at: 2026-09-27
---

# この原稿の読み方

このマニュアルが対象にする ACE Medical の版と MOD、MOD の組み合わせによる書き分け、時間と数値の読み方、ゲームの表示名の言語、原稿の一覧をまとめる。

> [!NOTE]
> ACE Medical **Dev 1.5.36** のソースコード（[acemod/ACE-Anvil](https://github.com/acemod/ACE-Anvil) の dev ブランチ `703d1aa7`）とゲーム本体 1.8.0.13 の処理を読んで書いた（2026-09-27 確認）。Release 版（1.4.3）では違う場合がある。
> 時間の数値は、コードの式から計算した目安（シングルプレイ）。人の多いサーバーでは、負荷によって全体が 1〜2 割遅く進むことがある（出来事の順番は変わらない）。
> 公式ドキュメント: [ACE Anvil – Medical（Dev）](https://anvil.acemod.org/dev/components/medical/)

関連: [物品・操作と所要時間](items-and-timing.md) ／ [サーバー設定の注意点](server-settings.md)

## 対象の版と MOD

- 対象は ACE Medical の **Dev 版 1.5.36**（Workshop の公開は 2026-08-14 00:35 JST ／ 原文 2026-08-13 15:35:56 GMT）。
- 読んだソースは ACE-Anvil の dev ブランチ `703d1aa7`（2026-09-22 05:16 JST ／ 原文 2026-09-21 22:16:17 +0200）。1.5.36 より新しいが、医療の挙動は 1.5.36 と同じ。違うのは、炭酸アンモニウム・チェストシール・NCD キットを使った後のゴミが 1.5.36 にはまだ無いことだけ。
- ゲーム本体は 1.8.0.13 で確かめた。
- **Release 版（1.4.3）は対象外**。Release には Circulation・Breathing・AI の MOD が無く、Core の挙動も一部違う。
- 対象の MOD（いずれも Dev 版）:

| MOD（Workshop の名前） | 必要な MOD | 内容 |
|---|---|---|
| ACE Medical Core Dev | ゲーム本体、ACE Core Dev | 出血・意識・痛み・Second Chance・医療キット・ゴミ・体位変換・医療ラジアルメニュー |
| ACE Medical Hitzones Dev | Medical Core Dev | 臓器（心臓・大腿動脈）。全体の体力を使わず、急所（頭・胸・腹）と臓器の破壊で判定する |
| ACE Medical Circulation Dev | Medical Core Dev | バイタル（心拍数・血圧）、状態、心停止と CPR、薬（薬物動態）、炭酸アンモニウム |
| ACE Medical Breathing Dev | **Medical Circulation Dev** | 呼吸数と SpO2、気道閉塞・嘔吐・気胸、King LT・チェストシール・NCD キット・酸素マスク |
| ACE Medical AI Dev | Medical Core Dev | 衛生兵の AI の治療 |
| ACE All in One Dev | — | Core・Hitzones・Circulation・Breathing をまとめたもの。**AI Dev は含まない** |

- Breathing は Circulation がないと入れられない。
- このマニュアルは、作者と友人の普段の組み合わせ **Core + Circulation + Breathing（Hitzones なし）**、サーバーの設定はほぼ既定値を基準に書いた。

## MOD の組み合わせで変わること

- Core は必須で、Breathing には Circulation が要る。成り立つ組み合わせは、Hitzones の有無 ×（なし・Circulation・Circulation + Breathing）の **6 通り**。
- 同じ物品・同じ負傷でも、入れている MOD で答えが変わることが多い。原稿では次の順に書き分けた。

1. 共通の事実（どの組み合わせでも同じこと）
2. `### Circulation を入れている場合`（Breathing で違いがあれば `### Breathing を入れている場合`）
3. `### Circulation なし（Core だけ）の場合`
4. `### Hitzones を入れている場合`（違いの補足）

- 表で書き分けるときは、普段の組み合わせを左端の列に置いた。
- 組み合わせに関わる節には、節のタグ（Circulation・Breathing・Hitzones）を付けた。タグで検索すると、その MOD に関わる節が見つかる。

主な違い（詳しくは各原稿）:

| 話題 | Core + Circulation + Breathing（普段） | Core + Circulation | Core だけ | Hitzones を足したとき |
|---|---|---|---|---|
| 血液の最大量 | 3000 ml | 3000 ml | 6000 ml | 変わらない |
| 意識を失ったあと戻す物品 | 炭酸アンモニウム（状態が Stable のときだけ、確率で効く） | 同左 | エピネフリン | Core だけのとき、エピネフリンの健康度の条件が効かない |
| エピネフリン | 意識は戻さない。心拍数を上げ、CPR の蘇生判定を速める | 同左 | 意識を戻す | — |
| モルヒネ注射器 | 鎮痛量を足す（痛みは残る）。過量投与がある | 同左 | 痛みを治す | — |
| 致命打の後（Second Chance） | 心停止になる（最初の 1 回） | 同左 | 意識を失う | 急所の破壊で判定する。心臓は判定が 2 回 |
| 心停止と CPR | ある | ある | ない | — |
| 気道閉塞・気胸 | ある | ない | ない | — |
| 出血の上限 | `max(20, 心拍出量 ÷ 60)` ml/s | 同左 | 設定 `m_fMaxTotalBleedingRate`（既定は上限なし） | 大腿動脈の出血は腰の傷として数える |
| AI の治療（AI の MOD） | 包帯・生理食塩水・医療キットだけ。Breathing の物品は使わない | 包帯・生理食塩水・医療キット（エピネフリンは使えない） | 包帯・生理食塩水・エピネフリン・医療キット | 同じ |

- 表の詳細: [血液量と出血の段階](hemorrhage.md#血液量と出血の段階) ／ [Circulation の有無で変わる薬の扱い](pain-medications.md#circulation-の有無で変わる薬の扱い) ／ [Circulation を入れているときの結果](death-second-chance.md#circulation-を入れているときの結果) ／ [心停止に入る経路](cardiac-arrest.md#心停止に入る経路) ／ [AI が治療する相手](ai-medic.md#ai-が治療する相手)
- AI（ACE Medical AI）は治療する側の追加なので、組み合わせとは別に、AI が関わる話題だけで書き分けた。

## 時間と数値の読み方

### 時間

- 時間の数値（意識が戻るまで・心停止までなど）は、**コードの式から計算した目安（シングルプレイ）**。
- 人の多いサーバーでは、負荷によって全体が 1〜2 割遅く進むことがある。出来事の順番は変わらない。
  - 観測例（2026-09-27）: 気道が塞がったまま放置して心停止するまでが、計算 15 分 14 秒（914 s）に対し、シングルプレイで 14 分 43 秒（撃たれた AI の失血で説明できる差）、人の多いサーバーで 17 分 35 秒（約 1.15 倍）だった。
- 処置の所要時間（止血帯を巻く時間など）は、ゲーム本体のアニメーションの長さから算出した値で、**実測ではない**。姿勢・部位・衛生兵かどうかで変わる（[処置の所要時間](items-and-timing.md#処置の所要時間)）。
- 確率で起きる出来事（例: 仰向けで 15% の舌根沈下）は、確率や平均の時間で書いた。実際の 1 回ごとの結果はばらつく。

### 設定で決まる数値

- サーバーの設定で変わる数値には、設定名と既定値を「1.2 HP/s（`m_fDefaultResilienceRegenScale` の既定 0.3 のとき）」の形で書いた。サーバーが設定を変えていれば、数値も変わる。
- 設定名はサーバー管理者が変えられるもの（ミッションヘッダーの項目）だけを書いた。一覧と注意点は [サーバー設定の注意点](server-settings.md) を見る。

### 式と表

- 式はインラインコードで書いた。例: `出血率 = (1 − 部位の HP の割合) × 最大出血率`。記号は × − ÷ ≤ ≥ を使う。
- 式の後に、変数の意味と既定値の表、計算例を付けた。
- 各節は、結論（何を見て、何が起きるか）を先に書き、式・表・計算例を後に置いた。

### ゲームに表示される数値

- ゲームの通知に出る数値は、小数点以下を切り捨てた値。例: 無傷の人の血圧は計算上 120.0 / 80.0 mmHg だが、通知では「119/79 mmHg」と出る（実機で確認）。SpO2・呼吸数・心拍数も同じく切り捨て。

### 【要確認】と注記

- **【要確認】**は、ソースやゲーム本体のスクリプトでは決まらず、ゲームエンジン側の処理や実機の操作で確かめる必要があるものに付けた。理由を短く添えた。
- ACE のコードやゲーム本体の処理で確かめた事実と、実機で確かめた事実には付けていない。「〜とみられる」は、コードから強く推定できるが直接は確かめていないもの。
- 処置の手順（何をどの順で行うか）は、ACE の仕様ではなく作者の方針。「このマニュアルの手順（作者の方針）」と書いて示し、トリアージのフローもこの方針で組んだ。
- 公式ドキュメントと違う挙動は、「公式ドキュメントとの違い:」で始まる注記で示した。
- 危険な落とし穴は、警告（WARNING）の枠で示した。

## 表示名の言語

- ゲームを日本語にしていても、日本語で表示されるのは **本体と Core の物品・操作だけ**。**Circulation と Breathing の物品・操作は英語で表示される**（翻訳が無い）。
- このマニュアルでは、英語で表示されるものは初出で英語の表示名を括弧に併記した（例: 「炭酸アンモニウム（Ammonium Carbonate）」「CPR（Perform CPR）」）。
- 実機（2026-09-27、ACE All in One Dev・日本語）で確かめた表示:

| 物品・操作 | 表示 | MOD |
|---|---|---|
| 止血帯（Tourniquet） | 止血帯を使う | 本体 |
| 包帯 | 包帯 | 本体 |
| 生理食塩水 | 生理食塩水 | 本体 |
| 医療キット | 医療キット | 本体 |
| モルヒネ | モルヒネ注射器 | 本体 |
| エピネフリン | Circulation を入れていると「Epinephrine」（Core だけなら、文字列表では「エピネフリン」） | Core / Circulation |
| 炭酸アンモニウム・ナロキソン・フェニレフリン・メトプロロール | Ammonium Carbonate ／ Naloxone ／ Phenylephrine ／ Metoprolol | Circulation |
| 呼吸数の確認 | 「Check respiratory rate」と「Check Breathing」の両方が出る | Breathing |

- エピネフリンの説明文も、名前と同じく英語（Circulation の文）になるとみられる（Core と Circulation が同じ文字列の ID を使っていて、名前は実機で英語と確かめた）。

ソースの文字列表から分かる表示（抜粋）:

| 表示 | 内容 | MOD |
|---|---|---|
| 医療ラジアルメニューを開く ／ 診察する ／ 止血 ／ 輸液 ／ 投薬 ／ 骨折の治療 | 医療ラジアルメニュー | Core |
| 仰向けに寝かせる ／ 左向きに寝かせる ／ 右向きに寝かせる | 体位を変える操作 | Core |
| エピネフリンを注射 | エピネフリンの操作（Circulation を入れると本体の注射の操作に置き換わる） | Core |
| 痛みはない ／ 意識不明ではない ／ 怪我が酷い | 物品を使えない理由 | Core |
| Perform CPR ／ Check pulse ／ Check blood pressure ／ Hold under nose ／ Not on back | CPR・バイタルの確認・炭酸アンモニウム・CPR できない理由 | Circulation |
| Class I〜IV hemorrhage | 出血の段階 | Circulation |
| Lift chin ／ Clear vomit ／ Insert King LT ／ Use chest seal ／ Perform needle decompression ／ Put oxygen mask on ／ Check SpO2 | 気道・気胸の操作 | Breathing |
| King LT ／ Chest Seal ／ NCD Kit ／ Oxygen Mask ／ Open pneumothorax ／ Tension pneumothorax ／ Airway/Thorax management | 物品・診察の表示・ラジアルメニューの分類 | Breathing |

用語（このマニュアルでの書き方）:

| 使う表記 | 使わない表記 |
|---|---|
| 止血帯 | ターニケット、TQ |
| エピネフリン | アドレナリン、エピ |
| 心停止 | 心肺停止、CA |
| 意識喪失（意識を失う出来事） | 気絶、ダウン |
| 意識不明（意識がない状態） | 気絶中、ダウン中 |
| 生理食塩水 | 輸液パック、サライン |

## 原稿の一覧

| 原稿 | 対象 | 内容 |
|---|---|---|
| [この原稿の読み方](about-this-manual.md) | 一般 | 対象の版と MOD、組み合わせの書き分け、時間と数値の読み方、表示名の言語 |
| [出血と止血](hemorrhage.md) | Core | 出血の見分け方、血液量と出血の段階、傷の出血率、放置したときの時間、止血帯・包帯・生理食塩水、首と大腿動脈の大出血 |
| [意識喪失と回復](consciousness.md) | Core | 意識を失う条件、意識が戻る条件と時間、エピネフリン・炭酸アンモニウムで起こす、気道と意識 |
| [致命傷と Second Chance](death-second-chance.md) | Core | 致命打で即死するか倒れるかの判定、部位ごとの確率、倒れた後の追い打ち、死亡の条件 |
| [痛みと薬](pain-medications.md) | Core | 痛みの仕組みと画面効果、各薬（モルヒネ注射器・エピネフリン・メトプロロール・ナロキソン・フェニレフリン・炭酸アンモニウム）、過量投与、薬の効き方の計算、投薬記録 |
| [バイタルと状態の見方](vitals.md) | Circulation | バイタルを確かめる操作、正常値、5 つの状態と閾値、心拍数・血圧・呼吸数・SpO2 の決まり方、画面の効果 |
| [心停止と CPR](cardiac-arrest.md) | Circulation | 心停止の見分け方と入る経路、脳の損傷と残り時間、CPR と蘇生の判定、エピネフリンの役割、AI の心停止 |
| [気道管理](airway.md) | Breathing | 気道閉塞の種類と見分け方、放置したときの推移、あご先挙上・嘔吐物の除去・回復体位・King LT |
| [呼吸と気胸](breathing.md) | Breathing | 呼吸数と SpO2、気胸の起き方と悪化、チェストシール・NCD キット・酸素マスク、物品の入手 |
| [物品・操作と所要時間](items-and-timing.md) | Core | 物品の一覧、医療キット、医療ラジアルメニュー、体位を変える、処置の所要時間、衛生兵かどうかの違い、ゴミ |
| [AI の治療](ai-medic.md) | AI | AI が治療する相手、使う物品と使わない物品、衛生兵になる AI、AI 自身が負傷したとき |
| [サーバー設定の注意点](server-settings.md) | 一般 | 設定の入口、ミッションヘッダーの差し替え、危険な設定と効かない設定、ゲームモード・AI の設定、主な既定値 |
