---
title: このマニュアルの読み方
mod: general
channel: dev
mod_version: "1.5.36"
ace_commit: "703d1aa7"
game_version: "1.8.0.13"
verified_at: 2026-09-27
order: 10
category: はじめに
---

# このマニュアルの読み方

> [!NOTE]
> [acemod/ACE-Anvil](https://github.com/acemod/ACE-Anvil) のソースコードとゲーム本体の処理を読んで書いた。\
> 時間の数値は、コードの式から計算した目安。人の多いサーバーでは、負荷によって全体が 1〜2 割遅く進むことがある。\
> 公式ドキュメント: [ACE Anvil – Medical（Dev）](https://anvil.acemod.org/dev/components/medical/)

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
- 同じ物品・同じ負傷でも、入れている MOD で答えが変わることが多い。

### 原稿での書き分け

原稿では次の順に書き分けた。

1. 共通の事実（どの組み合わせでも同じこと）
2. `### Circulation を入れている場合`（Breathing で違いがあれば `### Breathing を入れている場合`）
3. `### Circulation なし（Core だけ）の場合`
4. `### Hitzones を入れている場合`（違いの補足）

- 表で書き分けるときは、普段の組み合わせを左端の列に置いた。
### アプリでの表示

- 2〜4 の節は、アプリの設定「使っている MOD」に合うものだけを表示する。ほかの組み合わせの節は、各原稿の上部の「すべての組み合わせを表示」で見られる。検索は組み合わせに関係なくすべての節から探し、合わない節を開いたときはその旨を出す。組み合わせごとの列がある表も、合う列だけを表示する（下の「主な違い」のように見比べるための表は除く）。文中の書き分けは切り替わらない。

### 主な違い

詳しくは各原稿。

| 話題 | Core + Circulation + Breathing | Core + Circulation | Core だけ | Hitzones あり |
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

- 表の詳細: [血液量と出血の段階](bleeding-system.md#血液量と出血の段階) ／ [Circulation の有無で変わる薬の扱い](drug-effects.md#circulation-の有無で変わる薬の扱い) ／ [Circulation を入れているときの結果](death-second-chance.md#circulation-を入れているときの結果) ／ [心停止に入る経路](cardiac-arrest-system.md#心停止に入る経路) ／ [AI が治療する相手](ai-medic.md#ai-が治療する相手)
- AI（ACE Medical AI）は治療する側の追加なので、組み合わせとは別に、AI が関わる話題だけで書き分けた。

## 数値と注記の読み方

### 時間

- 時間の数値（意識が戻るまで・心停止までなど）は、**コードの式から計算した目安（シングルプレイ）**。
- 人の多いサーバーでは、負荷によって全体が 1〜2 割遅く進むことがある。出来事の順番は変わらない。
  - 観測例（2026-09-27）: 気道が塞がったまま放置して心停止するまでが、計算 15 分 14 秒（914 s）に対し、シングルプレイで 14 分 43 秒（撃たれた AI の失血で説明できる差）、人の多いサーバーで 17 分 35 秒（約 1.15 倍）だった。
- 処置の所要時間（止血帯を巻く時間など）は、ゲーム本体のアニメーションの長さから算出した値で、**実測ではない**。姿勢・部位・衛生兵かどうかで変わる（[処置の所要時間](treatment-times.md)）。
- 確率で起きる出来事（例: 仰向けで 15% の舌根沈下）は、確率や平均の時間で書いた。実際の 1 回ごとの結果はばらつく。

### 設定で決まる数値

- サーバーの設定で変わる数値には、設定名と既定値を「1.2 HP/s（`m_fDefaultResilienceRegenScale` の既定 0.3 のとき）」の形で書いた。サーバーが設定を変えていれば、数値も変わる。
- 設定名はサーバー管理者が変えられるもの（ミッションヘッダーの項目）だけを書いた。一覧と注意点は [サーバー設定の注意点](server-settings.md) を見る。

### 式と表

- 式は数式で書いた。例: $\text{出血率} = (1 - \text{部位の HP の割合}) \times \text{最大出血率}$。割り算は分数、べき乗は上付き、添字は下付きで表す。
- 一部の原稿では、式をまだインラインコードで書いている（例: `出血率 = (1 − 部位の HP の割合) × 最大出血率`）。記号は × − ÷ ≤ ≥ を使い、べき乗は `^` で表す。
- 式の後に、変数の意味と既定値の表、計算例を付けた。
- 各節は、結論（何を見て、何が起きるか）を先に書き、式・表・計算例を後に置いた。

### ゲームに表示される数値

- ゲームの通知に出る数値は、小数点以下を切り捨てた値。例: 無傷の人の血圧は計算上 119.997 / 79.997 mmHg だが、通知では「119/79 mmHg」と出る。SpO2・呼吸数・心拍数も同じく切り捨て。

### 注記の読み方

- 【**要確認**】は、ソースやゲーム本体のスクリプトでは決まらず、ゲームエンジン側の処理や実機の操作で確かめる必要があるものに付けた。理由を短く添えた。
- ACE のコードやゲーム本体の処理で確かめた事実と、実機で確かめた事実には付けていない。「〜とみられる」は、コードから強く推定できるが直接は確かめていないもの。
- マニュアルには、ACE とゲーム本体で確かめた事実だけを書いた。処置の手順（何をどの順で行うか）は ACE の仕様ではなく作者の方針なので、トリアージのフローとクイック表にだけ載せている。
- 公式ドキュメントと違う挙動は、「公式ドキュメントとの違い:」で始まる注記で示した。
- 危険な落とし穴は、警告（WARNING）の枠で示した。

## 表示名の言語

- ゲームを日本語にしていても、日本語で表示されるのは **本体と Core の物品・操作だけ**。**Circulation と Breathing の物品・操作は英語で表示される**（翻訳が無い）。
- このマニュアルでは、英語で表示されるものは初出で英語の表示名を括弧に併記した（例: 「炭酸アンモニウム（Ammonium Carbonate）」「CPR（Perform CPR）」）。
- 実機（2026-09-27、ACE All in One Dev・日本語）で確かめた表示:

| 物品・操作 | 表示 | MOD |
|---|---|---|
| 止血帯 | 止血帯を使う | 本体 |
| 包帯 | 包帯 | 本体 |
| 生理食塩水 | 生理食塩水 | 本体 |
| 医療キット | 医療キット | 本体 |
| モルヒネ | モルヒネ注射器 | 本体 |
| エピネフリン | Circulation を入れていると「Epinephrine」（Core だけなら、文字列表では「エピネフリン」） | Core / Circulation |
| 炭酸アンモニウム・ナロキソン・フェニレフリン・メトプロロール | Ammonium Carbonate ／ Naloxone ／ Phenylephrine ／ Metoprolol | Circulation |
| 呼吸数の確認 | Check respiratory rate | Breathing |

- エピネフリンの説明文も、名前と同じく英語（Circulation の文）で表示される。

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

## 用語

このマニュアルでの書き方。検索で見つからないときは、使う表記で探す。

| 使う表記 | 使わない表記 |
|---|---|
| 止血帯 | ターニケット、TQ |
| エピネフリン | アドレナリン、エピ |
| 心停止 | 心肺停止、CA |
| 意識喪失（意識を失う出来事） | 気絶、ダウン |
| 意識不明（意識がない状態） | 気絶中、ダウン中 |
| 生理食塩水 | 輸液パック、サライン |
| 意識の値（resilience） | 抵抗値、意識の HP |

## マニュアルの一覧

分類はライブラリと見出しツリーの見出しと同じ。並びもライブラリの「標準」の並び順と同じ。

### はじめに

| マニュアル | 対象 | 内容 |
|---|---|---|
| [このマニュアルの読み方](about-this-manual.md) | 一般 | どの版を対象にし、MOD の組み合わせや数値・注記をどう読むか |

### 処置

| マニュアル | 対象 | 内容 |
|---|---|---|
| [診察とバイタルの確かめ方](vitals.md) | Circulation | 脈・血圧・呼吸数・SpO2 をどう確かめ、通知の値をどう読むか |
| [出血と止血](hemorrhage.md) | Core | 出血をどう見分け、何で止めるか |
| [意識不明への対応](consciousness.md) | Core | 意識不明の人がいつ目覚め、どう起こすか |
| [気道閉塞と気道の確保](airway.md) | Breathing | 気道が塞がっているかをどう見分け、どう開けるか |
| [気胸と処置](breathing.md) | Breathing | 開放性気胸と緊張性気胸をどう見分け、何で治すか |
| [心停止と CPR](cardiac-arrest.md) | Circulation | 心停止をどう見分け、CPR でどう蘇生させるか |
| [痛みと抑え方](pain.md) | Core | 痛みをどう見分け、モルヒネでどう抑えるか |

### 物品

| マニュアル | 対象 | 内容 |
|---|---|---|
| [物品の一覧](items.md) | Core | どの MOD にどの物品があり、どこで手に入るか |
| [止血帯](tourniquet.md) | Core | 止血帯で何が止まり、巻いたままだとどうなるか |
| [包帯](bandage.md) | Core | 包帯 1 本でどこまで出血が消え、何秒かかるか |
| [生理食塩水](saline.md) | Core | 生理食塩水で血液がどれだけ、どの速さで戻るか |
| [医療キット](medical-kit.md) | Core | 医療キットで何が治り、何が入っているか |
| [モルヒネ注射器](morphine.md) | Core | モルヒネがどう効き、何本で危険か |
| [エピネフリン](epinephrine.md) | Core | エピネフリンが何をし、CPR でどう役立つか |
| [メトプロロール](metoprolol.md) | Circulation | メトプロロールで心拍数がどれだけ下がり、何本で危険か |
| [ナロキソン](naloxone.md) | Circulation | ナロキソンでモルヒネの効果がどれだけ弱まるか |
| [フェニレフリン](phenylephrine.md) | Circulation | フェニレフリンで血圧と出血がどう変わり、何本で危険か |
| [炭酸アンモニウム](ammonium-carbonate.md) | Circulation | 炭酸アンモニウムで誰が、どの確率で目覚めるか |
| [King LT](king-lt.md) | Breathing | King LT で気道がどう守られ、何秒かかるか |
| [チェストシール](chest-seal.md) | Breathing | チェストシールで気胸がどう治り、遅れるとどうなるか |
| [NCD キット](ncd-kit.md) | Breathing | NCD キットで緊張性気胸がどう治り、遅れるとどうなるか |
| [酸素マスク](oxygen-mask.md) | Breathing | 酸素マスクで SpO2 がどう変わるか |

### 操作

| マニュアル | 対象 | 内容 |
|---|---|---|
| [医療の操作](medical-actions.md) | Core | 医療ラジアルメニュー・体位の変え方・運び方・ゴミはどうなっているか |
| [処置の所要時間](treatment-times.md) | Core | 処置ごとに何秒かかり、衛生兵かどうかでどれだけ違うか |

### システム

| マニュアル | 対象 | 内容 |
|---|---|---|
| [状態と閾値](states.md) | Circulation | 5 つの状態で何が起き、どの値で状態が変わるか |
| [バイタルの仕組み](vitals-system.md) | Circulation | 心拍数と血圧がどう決まり、出血でどう変わるか |
| [出血の仕組み](bleeding-system.md) | Core | 傷ごとの出血の速さ、放置したときの時間、血液の戻り方 |
| [意識の仕組み](consciousness-system.md) | Core | どの条件で意識を失い、どの速さで戻るか |
| [呼吸と気道の仕組み](respiration-system.md) | Breathing | 呼吸数と SpO2 がどう決まり、気道が塞がるとどう推移するか |
| [気胸の仕組み](pneumothorax-system.md) | Breathing | 気胸がどう起きて悪化し、放置するといつ心停止するか |
| [心停止と蘇生](cardiac-arrest-system.md) | Circulation | 心停止に入る経路、脳が尽きるまでの時間、蘇生の確率と時間 |
| [致命傷と Second Chance](death-second-chance.md) | Core | 致命打で即死するか倒れるかがどう決まり、いつ死亡するか |
| [痛みの仕組み](pain-system.md) | Core | 痛みがどう決まり、放置するといつ消えるか |
| [薬の効き方](drug-effects.md) | Circulation | 薬の濃度と効果をどう計算し、何本で過量投与になるか |
| [AI の治療](ai-medic.md) | AI | AI の衛生兵が何をして何をしないか、AI 自身がどう死ぬか |

### 管理者向け

| マニュアル | 対象 | 内容 |
|---|---|---|
| [サーバー設定の注意点](server-settings.md) | 一般 | ミッションヘッダーの書き方の落とし穴と、効かない・危険な設定 |
| [設定の一覧](server-settings-defaults.md) | 一般 | サーバー設定の既定値 |
