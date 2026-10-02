---
title: サーバー設定の注意点
mod: general
channel: dev
mod_version: "1.5.36"
verified_at: 2026-09-27
tags: [管理者向け]
order: 510
category: 管理者向け
---

# サーバー設定の注意点

ACE Medical の設定をどこで変えるか、ミッションヘッダーで設定するときの落とし穴、効かない設定、ゲームモードの設定との関係（出血倍率・意識喪失の禁止）、死亡を防ぐ設定、AI に関わる設定、主な設定の既定値をまとめる。サーバー管理者とミッション作者向け。

> [!NOTE]
> ACE Medical **Dev 1.5.36** のソースコード（[acemod/ACE-Anvil](https://github.com/acemod/ACE-Anvil) の dev ブランチ `703d1aa7`）とゲーム本体 1.8.0.13 の処理を読んで書いた（2026-09-27 確認）。Release 版（1.4.3）では違う場合がある。
> 時間の数値は、コードの式から計算した目安（シングルプレイ）。人の多いサーバーでは、負荷によって全体が 1〜2 割遅く進むことがある（出来事の順番は変わらない）。
> 公式ドキュメント: [ACE Anvil – Medical（Dev）](https://anvil.acemod.org/dev/components/medical/)

## 設定の入口

- 設定を持つのは**サーバーだけ**。クライアントには、必要な値だけが送られる（エピネフリンの最小健康度、医療キットの 2 つの値、痛みの画面効果の種類など）。
- 値が決まる場所は 3 つある。

| 場所 | 誰が変えるか | 内容 |
|---|---|---|
| 既定値のファイル（MOD の中の `Configs/ACE/Settings.conf`） | 変えない（MOD に入っている） | サーバーの起動時に 1 回読む。値を書いていない項目は、スクリプトの既定値になる |
| ミッションヘッダーの `m_ACE_Settings` | サーバー管理者（サーバー設定の JSON の `missionHeader`）、ミッション作者（ワールドエディタのミッションヘッダー） | MOD ごとの設定を差し替える（[ミッションヘッダーの設定は丸ごと差し替わる](#ミッションヘッダーの設定は丸ごと差し替わる)） |
| 物品・キャラクターの prefab の値 | ミッション作者（prefab を継承して変える） | 物品の効果の量、部位の HP、生理食塩水の量など。サーバー設定では変えられない |

`m_ACE_Settings` の中に書く MOD ごとの項目:

| 項目 | 対象 |
|---|---|
| `m_ACE_Medical_Core` | Core（出血・意識・痛み・医療キット・Second Chance・ゴミ） |
| `m_ACE_Medical_Hitzones` | Hitzones |
| `m_ACE_Medical_Circulation` | Circulation（バイタル・状態の閾値・CPR・炭酸アンモニウム・AI の心停止） |
| `m_ACE_Medical_Medication` | Circulation の薬（薬物動態と効果） |
| `m_ACE_Medical_Breathing` | Breathing |

- AI（ACE Medical AI）にはサーバー設定が無い（[AI の設定](#ai-の設定)）。
- ミッションヘッダーの設定は、**サーバーで最初のミッションのときだけ**適用される（2 つ目以降のミッションのヘッダーにはサーバー設定が入らないという本体の不具合への対策）。
- 書き方の例（Breathing の嘔吐を無くし、ほかは既定値のままにする）:

```json
"missionHeader": {
  "m_ACE_Settings": {
    "m_ACE_Medical_Breathing": {
      "m_fVomitChancePerMinute": 0
    }
  }
}
```

- bool（真偽値）の項目を JSON で `true` / `false` と書くか `1` / `0` と書くか: 公式ドキュメントは整数で書くよう注記しつつ、雛形の一部は `true` と書いている。どちらが読み込めるかは未確認（[ミッションヘッダーの設定は丸ごと差し替わる](#ミッションヘッダーの設定は丸ごと差し替わる) の注記）。

## ミッションヘッダーの設定は丸ごと差し替わる

> [!NOTE]
> 【要確認】ミッションヘッダーの JSON の読み込みはゲームエンジン側で行われ、サーバーでは確かめていない。この原稿に書いた「書かなかった項目の扱い（既定値に戻る・0 や空になる）」「bool を `true` と `1` のどちらで書くか」「列挙の値や入れ子のオブジェクトの書き方」は、ACE のコードからの推論。

- ミッションヘッダーに MOD の項目（例: `m_ACE_Medical_Circulation`）を書くと、その MOD の設定が**丸ごと**書いた内容に差し替わる。項目ごとに既定値と混ぜる（マージする）のではない。
- 書かなかった項目は、スクリプトの既定値（defvalue）に戻るとみられる。既定値のファイル（Settings.conf）の値ではない。
- 既定値（defvalue）を持たない項目は、書き漏らすと 0 や空（null）になるとみられる。

| MOD の項目 | 書かなかった項目 | 危険か |
|---|---|---|
| `m_ACE_Medical_Core` | 既定値に戻るとみられる（Settings.conf が空なので、結果は同じ） | 安全 |
| `m_ACE_Medical_Hitzones` | 同上 | 安全 |
| `m_ACE_Medical_Breathing` | 既定値に戻るとみられる（16 項目すべてに既定値がある） | 安全 |
| `m_ACE_Medical_Circulation` | 数値の項目は既定値に戻る。**状態の閾値 3 つ（`m_UnstableThresholds`・`m_CriticalThresholds`・`m_CardiacArrestThresholds`）の中身には既定値が無い**。脳の損傷の設定（`m_CardiacArrestDamageEffect`）だけは、空なら既定値で作り直される | **危険**（[書き漏らすと危険な設定](#書き漏らすと危険な設定)） |
| `m_ACE_Medical_Medication` | 薬物動態・効果の設定のほとんど（吸収と消失の速さ、効き始める濃度、薬の一覧など）に既定値が無い。`m_fGamma` と `m_fMaxEffect` だけは既定値 1 | **危険** |

- 計算例: `"m_ACE_Medical_Circulation": { "m_fCPRSuccessChanceMax": 0.6 }` だけを書くと、CPR の最大成功率が 0.6 になり、ほかの数値の項目は既定値に戻る。ただし状態の閾値 3 つは空（null）になるとみられる。
- 設定の一部は、ゲームの開始時に一度だけ読み込まれて保存される。ミッションヘッダーの適用はワールドの読み込みより前とみられるので、通常は問題にならない。

> [!NOTE]
> 公式ドキュメントとの違い: ドキュメントの JSON の雛形には、薬の設定 `m_ACE_Medical_Medication` が無い。Circulation の雛形の閾値には Breathing の `m_fSpO2` が無い。Breathing の `m_bKidneyEnabled` も載っていない。閾値の「既定値」はドキュメントに書いてあるが、実際にはスクリプトの既定値ではなく、Settings.conf の値である（ミッションヘッダーで省くと 0 になるとみられる）。

## 書き漏らすと危険な設定

> [!WARNING]
> ミッションヘッダーで `m_ACE_Medical_Circulation` を書くなら、3 つの閾値のすべての項目を書く（Breathing 入りなら `m_fSpO2` も）。1 つでも書き漏らすと、例えば `m_fHeartRateHighBPM` が 0 になり、**全員がすぐ心停止する**おそれがある。

次の表は、コードから推論した結果（省いた項目が 0 や空になる前提）。

| 書き方 | 結果 | 理由 |
|---|---|---|
| 閾値の中の `m_fHeartRateHighBPM` を省く（0 になる） | その閾値が常に成り立つ。心停止の閾値なら、**全員が最初の更新で心停止**し、AI は即死する | `心拍数 > 0` が常に真 |
| 閾値の中の `m_eBloodState` を省く（0 になる） | 常に成り立つとみられる。心停止の閾値なら、全員が最初の更新で心停止する | 血液の段階の比べ方で、0 の段階の閾値は 1.0（満タン）とみられる |
| 閾値のオブジェクトごと省く（null になる） | 状態の判定のたびにスクリプトのエラーが出て、バイタルの状態が進まない。蘇生中の血圧の上限・蘇生直後の心拍数も読めない | 閾値を確かめずに読んでいる |
| Unstable の `m_fHeartRateLowBPM` を 0 にする | 心拍数の下限による Unstable が無くなるだけ（安全側） | `心拍数 < 0` は常に偽 |
| Breathing 入りで、閾値に `m_fSpO2` を書かない（0 になる） | SpO2 では状態が悪化しない。SpO2 による蘇生の制限も無くなる。気道が塞がって SpO2 が 0% まで下がっても Stable のまま | `SpO2 < 0` は常に偽 |
| `m_fDefaultHeartRateBPM` を 0 にする | 目標の心拍数が 0 になり、心拍数 < 20 で全員心停止する | 基準の心拍数で割る式がある |
| `m_fCPRSuccessCheckTimeoutS` を 0 にする | 蘇生判定が約 1 s ごとになり、血液 100% なら平均 2.5 s で蘇生する | 判定の間隔そのもの |
| `"m_ACE_Medical_Medication": {}`（中身なし） | 薬を打つと設定が見つからずスクリプトのエラーになる。効果の適用でもエラーになる | 薬の設定の一覧が空 |
| 薬の効果の `m_fEC50` を省く（0 になる） | 効きの強さが無限大か非数になり、心拍数・血管抵抗が壊れる。非数は比べるとすべて偽になり、状態が固まる | `濃度 ÷ 0` |
| 薬の効果の `m_fMaxEffect` を省く | 既定値 1 になる。フェニレフリンで出血を最大 100% 止められ、エピネフリンで蘇生判定の頻度が最大 2 倍になる | 本来は 0.55（出血）・0.5（蘇生） |

Circulation の閾値の値（Settings.conf の値。ミッションヘッダーで書くときはこの値を写す）:

| 項目 | Unstable | Critical | 心停止 | 意味 |
|---|---|---|---|---|
| `m_fHeartRateLowBPM` | 40 | 30 | 20 | 心拍数がこれ未満で移る。Critical の値は蘇生直後の心拍数にも使う |
| `m_fHeartRateHighBPM` | 220 | 220 | 220 | 心拍数がこれを超えると移る |
| `m_fMeanArterialPressureLowKPA` | 7.11 | 5.21 | 5.21 | 平均血圧（kPa）がこれ未満、かつ心拍数が下の上限以下で移る |
| `m_fMeanArterialPressureHighKPA` | 29.5 | 29.5 | 29.5 | 平均血圧がこれを超えると移る。心停止の値は蘇生中の平均血圧の上限 |
| `m_fMaxHeartForMeanArterialPressureLowBPM` | 80 | 40 | 30 | 平均血圧の下限を使うときの心拍数の上限 |
| `m_eBloodState` | Class II | Class III | Class IV | 血液がこの段階以下で移る |
| `m_fSpO2`（Breathing） | 85 | 75 | 65 | SpO2（%）がこれ未満で移る |

- 閾値の意味は [状態の閾値](states.md#状態の閾値) を見る。
- 段階（`m_eBloodState`）などの列挙の値や、入れ子のオブジェクトを JSON でどう書くかは未確認（[ミッションヘッダーの設定は丸ごと差し替わる](#ミッションヘッダーの設定は丸ごと差し替わる) の注記）。

## 効かない設定

設定しても挙動が変わらない（または一部しか効かない）もの:

| 設定 | 既定値 | 効かない条件 | 内容 |
|---|---|---|---|
| `m_bPaCO2Enabled`（Breathing） | true | 常に | どこからも読まれない。二酸化炭素の計算は設定に関係なく常に行われ、呼吸数には影響しない |
| `m_bKidneyEnabled`（Breathing） | false | 常に | 未実装 |
| `m_fSecondChanceResilienceRegenScale`（Core） | 0 | Circulation を入れているとき | Circulation が意識の回復の計算を置き換えるので使われない |
| `m_fMinHealthScaledForEpinephrine`（Core） | 0.33 | Circulation を入れているとき・Hitzones を入れているとき | Circulation ではエピネフリンの使用条件そのものが無い。Hitzones では見ている全体の体力が減らないので、条件が常に満たされる |
| `m_ePainScreenEffectType`（Core） | 1（白い点滅） | 4 を選んだとき | 4（RADIAL_BLUR）を選ぶと画面効果が出ない。3（CHROMATIC_ABERRATION）を選ぶと放射ブラーになる |
| `m_fSecondChanceOnHeart`（Hitzones） | 0 | — | 効くが、判定が 2 回あるので実際の生存率は p × p（p = 設定値） |

- ゲームモード側の設定で効かないものは [ゲームモードの設定との関係](#ゲームモードの設定との関係) を見る。
- Breathing の嘔吐と気胸の判定の間隔（約 60 s）は、サーバー設定ではなく MOD の中のシステム設定で決まり、サーバー設定では変えられない。確率の設定名の「PerMinute」（1 分あたり）は、この間隔を前提にしている。

> [!NOTE]
> 公式ドキュメントとの違い: ドキュメントでは `m_bPaCO2Enabled` が「二酸化炭素と呼吸数への影響を有効にする」設定（範囲 0〜∞）とされているが、ソースではどこからも使われていない。痛みの画面効果は 0〜4 の 5 種類から選べるとされているが、3 は放射ブラー、4 は効果なしになる。

## ゲームモードの設定との関係

- 本体のゲームモードは、モードごとに健康の設定を変えている。ACE はそのうち**出血と再生の倍率を自分の設定で上書き**し、**意識喪失の許可などは判定ごと置き換えて無視する**。

| ゲームモードの設定 | 意味 | 本体の既定 | モードで変えている値 | ACE を入れたとき |
|---|---|---|---|---|
| 出血の倍率 | 部位の最大出血率に掛かる | 1 | Conflict 0.75 | ACE の `m_fBleedingRateScale`（既定 1）で上書き。Conflict の 0.75 は効かない |
| 部位・血液の再生の倍率 | 意識以外の自然回復に掛かる | 1 | Conflict 0.725 | ACE の `m_fBloodRegenScale`（既定 1）で上書き |
| 意識（resilience）の再生の倍率 | 意識の自然回復 | 1 | — | そのまま（ACE の倍率と掛け合わせる） |
| 再生が始まるまでの待ち | 損傷・出血の後 | 10 s | — | そのまま |
| 意識喪失を許すか | 許さないなら死亡 | 許す | Capture & Hold は許さない | **無視される** |
| 自力で目覚められない意識不明を死亡にするか | — | しない | — | **無視される** |
| 意識不明中の無線 | — | 使えない | Conflict・Plain・Editor は使える | 変更なし |
| 医療用の座席での再生の倍率 | — | 1 | Conflict 1.775 | 変更なし（使う処理が見当たらない） |
| 脚に止血帯を巻いたときの減速 | — | 0.75 | — | 変更なし（同上） |

- 出血を遅くしたいときは、ACE の `m_fBleedingRateScale` を変える（例: 0.75 にすると Conflict の本体の出血と同じ速さ）。

### ゲームモードの出血倍率

ACE は、ゲームモードが決めている出血と回復の倍率を、自分の設定 `m_fBleedingRateScale`（既定 1）と `m_fBloodRegenScale`（既定 1）で上書きする。そのため Conflict では、本体だけのときの約 1.33 倍の速さで出血する（出血死までの時間は 0.75 倍）。

- `m_fBleedingRateScale` を 0.5 にすると、同じ傷で出血は半分、出血死までの時間は 2 倍になる。大腿動脈の出血にも掛かる。
- ゲームマスターがキャラクターごとに倍率を変えた場合は、そちらが優先される。
- 生理食塩水には、どちらの倍率も掛からない。

> [!NOTE]
> 公式ドキュメントとの違い: ドキュメントには、ACE の `m_fBleedingRateScale`・`m_fBloodRegenScale` がゲームモードの同じ種類の値を上書きすることが書かれていない。

### 意識喪失を禁止したゲームモード

ACE を入れると、意識喪失を禁止しているゲームモード（本体の Capture & Hold）でも、致命的でない負傷では即死せずに意識を失う。ACE が本体の意識の判定を置き換え、許可の確認と「目覚められない意識不明を死亡にする」処理を外しているため。

- ゲームマスターや Scenario Framework で、個人ごとに意識喪失を禁止した場合も効かない。
- コードで確認した。Capture & Hold での実機の確認はまだない。
- 致命打での即死は Second Chance で決まる（[Second Chance とは](death-second-chance.md#second-chance-とは)）。

> [!NOTE]
> 公式ドキュメントとの違い: ドキュメントには、ゲームモードの意識喪失の禁止が ACE を入れると効かなくなることが書かれていない。

## 死亡を防ぐ設定

ACE の死亡処理による死亡（[死亡の条件](death-second-chance.md#死亡の条件)）は、次の設定で防げる。

| 設定 | 意味 | 既定値 |
|---|---|---|
| `m_bPlayerCannotDie` | true にすると、プレイヤーは上の経路で死なない | false |
| `m_bBleedOutForPlayersEnabled` | プレイヤーが出血死するか（AI は常に出血死する） | true |
| `m_bCardiacArrestForAIEnabled` | AI が心停止に入れるか（false なら心停止で即死） | false |

### 死亡を無効にしたとき

- 出血死しない設定では、血液が 0 になっても意識不明のまま残る。血液を 33.3% より上に戻せば目覚めうる（Circulation なし）。
- `m_bPlayerCannotDie` が true でも、次の死亡は防げない（本体の「無敵を無視して殺す」処理を使うため）: リスポーン画面からの自殺、Capture & Hold のスポーン地帯、Clean Sweep、ハブの範囲など。そのため、プレイヤーはリスポーン画面の自殺でやり直せる。
- ゲームマスターの「破壊」（Neutralize）と溺水は同じ死亡処理を通るので、`m_bPlayerCannotDie` が true なら防がれる。
- 設定の書き方の注意は [書き漏らすと危険な設定](#書き漏らすと危険な設定)、既定値の一覧は [主な設定の既定値](#主な設定の既定値)。

## AI の設定

- AI 自身の負傷の扱いは、AI の MOD（ACE Medical AI）ではなく、Core と Circulation の設定で決まる。AI の MOD の有無に関係ない。
- AI 向けの違いを決める設定は 2 つだけ。既定では、**AI は致命打で即死し、心停止に入った瞬間に死ぬ**。

| 設定 | MOD | 既定値 | false のとき | true のとき |
|---|---|---|---|---|
| `m_bSecondChanceForAIEnabled` | Core | false | AI（ゲームマスターが乗り移った AI を含む）には Second Chance が無く、致命打で死ぬ | プレイヤーと同じく Second Chance の判定がある |
| `m_bCardiacArrestForAIEnabled` | Circulation | false | AI は心停止に入った瞬間に死ぬ | AI も心停止の状態になり、CPR で蘇生できる |

既定のままだと、次のような AI の死に方が起きる:

- Circulation 入り: 出血した AI は、血液が約 25% になったところで心停止に入り、死にうる（出血性ショックの頻脈で心拍数が 220 を超えるため。計算）。
- Breathing 入り: 意識不明で仰向けの AI は、気道が塞がると約 15 分（914 s）で心停止し、死ぬ。意識不明のまま仰向けで放置すると、15 分までは 0%、20 分で 49.8%、30 分で 82.6% が死ぬ計算（意識不明が続く場合の値）。気胸が最大まで進んだときや緊張性気胸でも同じ。

プレイヤーだけに効く設定（AI には効かない）:

| 設定 | 既定値 | 内容 |
|---|---|---|
| `m_bPlayerCannotDie` | false | true にすると、プレイヤーは死なない（死亡の処理を無効にする）。AI は死ぬ |
| `m_bBleedOutForPlayersEnabled` | true | false にすると、プレイヤーは出血では死なない。AI は常に出血で死ぬ |

AI の MOD について:

- AI の MOD（ACE Medical AI Dev）にはサーバー設定が無い。AI の振る舞いの内部の値（衛生兵を探し直す間隔 5 s など）は既定値のまま使われ、サーバー設定では変えられない。
- AI の MOD は ACE All in One Dev に含まれない。別に入れる。
- 詳しくは [AI 自身が負傷したとき](ai-medic.md#ai-自身が負傷したとき) と [AI の心停止](ai-medic.md#ai-の心停止) を見る。

## 主な設定の既定値

サーバー設定（ミッションヘッダーで変えられるもの）の既定値。「0 にすると」などの列は、機能ごと止められる設定の書き方。

### Core の設定

| 設定 | 既定値 | 内容 | 止めたいとき |
|---|---|---|---|
| `m_fDefaultResilienceRegenScale` | 0.3 | 意識の自然回復の倍率。回復は 5 × 0.8 × この値 HP/s（既定で 1.2 HP/s） | — |
| `m_fResilienceDamageScale` | 1.0 | 意識（resilience）への損傷の倍率 | 0 で「損傷では意識を失わない」 |
| `m_fMinHealthScaledForEpinephrine` | 0.33 | Core のエピネフリンに要る全体の健康度 | 0 で条件なし |
| `m_bPlayerCannotDie` | false | プレイヤーを死なせない | true でプレイヤーは死なない |
| `m_bLitterEnabled` | true | 処置の後にゴミを出す | false でゴミなし |
| `m_fLitterCleanUpTime` | 600 | ゴミが消えるまでの秒数 | — |
| `m_bBleedOutForPlayersEnabled` | true | プレイヤーが出血で死ぬか | false でプレイヤーの出血死なし |
| `m_fBleedingRateScale` | 1.0 | 傷の出血率の倍率（大腿動脈にも掛かる） | 0 で出血なし |
| `m_fMaxTotalBleedingRate` | −1 | 出血の合計の上限（ml/s）。負の値は上限なし | — |
| `m_fBloodRegenScale` | 1.0 | 意識以外の自然回復（血液・部位・痛み）の倍率。生理食塩水には掛からない | — |
| `m_fMedicalKitMaxHealScaled` | 1.0 | 医療キットで施設の外で回復できる上限の割合 | — |
| `m_fMedicalKitHealingPerExecution` | 10 | 医療キットの 1 回の回復量 | 0 で医療キットが回復しない |
| `m_ePainScreenEffectType` | 1 | 痛みの画面効果（0 なし、1 白い点滅、2 灰色の点滅、3 放射ブラー、4 効果なし） | 0 で画面効果なし |
| `m_fSecondChanceResilienceRegenScale` | 0 | Second Chance の後の意識の回復倍率（Circulation なしのときだけ効く） | — |
| `m_fDefaultSecondChance` | 1.0 | 頭・胸・腹以外の部位の Second Chance の確率 | 0 にすると、頭・胸・腹以外への致命打も即死 |
| `m_fSecondChanceOnHead` | 0 | 頭の Second Chance の確率 | — |
| `m_fSecondChanceOnChest` | 1.0 | 胸の Second Chance の確率 | — |
| `m_fSecondChanceOnAbdomen` | 1.0 | 腹の Second Chance の確率 | — |
| `m_bSecondChanceForFallDamageEnabled` | false | 落下の損傷にも Second Chance を与える | — |
| `m_bSecondChanceForAIEnabled` | false | AI にも Second Chance を与える | — |

- Second Chance を機能ごと無効にする設定は無い。`m_fDefaultSecondChance`・`m_fSecondChanceOnChest`・`m_fSecondChanceOnAbdomen` を 0 にすれば、致命打は常に死亡になり、実質無効になる（[死亡の条件](death-second-chance.md#死亡の条件)）。

### Hitzones の設定

| 設定 | 既定値 | 内容 | 止めたいとき |
|---|---|---|---|
| `m_bOrganHitZonesEnabled` | true | 臓器（心臓・大腿動脈）を有効にする | false で臓器なし |
| `m_fSecondChanceOnHeart` | 0 | 心臓の Second Chance の確率 p。判定が 2 回あるので、実際の生存率は p × p | — |
| `m_bInstantUnconOnMassiveBleeding` | true | 首・大腿動脈の大出血でその場で意識を失う | false で大出血でも即時には意識を失わない |

- 詳しくは [Hitzones の急所と心臓](death-second-chance.md#hitzones-の急所と心臓) を見る。

### Circulation の設定

| 設定 | 既定値 | 内容 |
|---|---|---|
| `m_fDefaultHeartRateBPM` | 80 | 基準の心拍数（bpm） |
| `m_fDefaultStrokeVolumeML` | 95 | 基準の 1 回拍出量（ml） |
| `m_fDefaultMeanArterialPressureKPA` | 12.443 | 基準の平均血圧（kPa） |
| `m_fDefaultPulsePressureKPA` | 5.3329 | 基準の脈圧（kPa）。血圧の表示だけに影響する |
| `m_UnstableThresholds` ／ `m_CriticalThresholds` ／ `m_CardiacArrestThresholds` | 上の閾値の表 | 状態の閾値（既定値なし。Settings.conf の値） |
| `m_fBrainDamageRate`（`m_CardiacArrestDamageEffect` の中） | 0.333 | 心停止中の脳の損傷（HP/s）。死亡まで `10 + 100 ÷ この値` s |
| `m_fEffectStartDelayS`（同上） | 10 | 心停止から脳の損傷が始まるまで（s） |
| `m_bCardiacArrestForAIEnabled` | false | AI も心停止の状態になるか（false なら即死） |
| `m_fCPRStrokeVolumeScale` | 0.23 | CPR 中の 1 回拍出量の倍率 |
| `m_fCPRSuccessCheckTimeoutS` | 22 | 蘇生判定の間隔（CPR の累計の秒数） |
| `m_fCPRSuccessChanceMin` | 0 | 蘇生判定の最小の成功率（血液が Class IV の閾値以下） |
| `m_fCPRSuccessChanceMax` | 0.4 | 蘇生判定の最大の成功率（血液が Class II の閾値以上） |
| `m_fAmmoniumCarbonateSuccessChanceMin` | 0.2 | 炭酸アンモニウムの最小の成功率 |
| `m_fAmmoniumCarbonateSuccessChanceMax` | 1.0 | 炭酸アンモニウムの最大の成功率 |
| `m_fMaxRevivalResilienceRecoveryScale` | 0.2 | 蘇生した後の意識の回復倍率 |
| `m_fCardiacArrestMaxTotalBleedingRate` | 20 | 出血の上限 `max(この値, 心拍出量 ÷ 60)` ml/s の下限側 |

- 計算例（脳）: 既定なら心停止から死亡まで 10 + 100 ÷ 0.333 ≈ 310 s（約 5 分）。CPR 中は脳の損傷が止まる（[脳の損傷と残り時間](cardiac-arrest-system.md#脳の損傷と残り時間)）。

### 薬の設定（Circulation）

- 薬の設定 `m_ACE_Medical_Medication` は、薬ごとの吸収と消失の速さ（薬物動態）と、効き方（効果）の一覧を持つ。値はすべて Settings.conf にあり、ほとんどの項目にスクリプトの既定値が無い（`m_fGamma` と `m_fMaxEffect` だけは既定値 1）。
- 変えるときは一覧を丸ごと書く必要がある（[書き漏らすと危険な設定](#書き漏らすと危険な設定)）。各薬の値は [薬の効き方の計算](drug-effects.md#薬の効き方の計算) を見る。

### Breathing の設定

| 設定 | 既定値 | 内容 |
|---|---|---|
| `m_fAirwayObstructionChance` | 0.15 | 仰向けになるたびに舌根沈下する確率 |
| `m_fVomitChancePerMinute` | 0.1 | 意識不明の間、約 60 s ごとに嘔吐する確率 |
| `m_fVomitCooldown` | 6 | 嘔吐の後、次の抽選までの休み（分） |
| `m_fPneumothoraxChance` | 0.51 | 胸への致命的な打撃で気胸になる確率 |
| `m_fPneumothoraxDeteriorationChancePerMinute` | 0.5 | 約 60 s ごとに気胸が悪化する確率 |
| `m_fMaxPneumothoraxScale` | 0.75 | 気胸の大きさの上限。達すると心停止（下の設定が true のとき） |
| `m_fPneumothoraxScaleDeteriorationStep` | 0.18 | 気胸になったときの大きさと、1 回の悪化の量 |
| `m_fPneumothoraxArrestEnabled` | true | 気胸が上限に達したら心停止にする（名前は `m_f` だが真偽値） |
| `m_fTensionPneumothoraxChance` | 0.15 | 気胸のある胸への致命的な打撃で緊張性になる確率 |
| `m_fDeteriorateToTensionPneumothoraxChancePerMinute` | 0.05 | 約 60 s ごとに緊張性へ移る確率 |
| `m_fDefaultRespiratoryRateBPM` | 14.573 | 基準の呼吸数（回/分） |
| `m_fMaxRespiratoryRateBPM` | 40 | 呼吸数の上限 |
| `m_fDefaultSpO2` | 97.149 | SpO2 の初期値（%） |
| `m_fDefaultPalvCO2KPA` | 5.21 | 肺胞の二酸化炭素の初期値（kPa） |
| `m_bPaCO2Enabled` | true | 効かない（[効かない設定](#効かない設定)） |
| `m_bKidneyEnabled` | false | 効かない（未実装） |

- 例: `"m_ACE_Medical_Breathing": {"m_fVomitChancePerMinute": 0}` だけを書くと、嘔吐は起きず、ほかは既定値のままとみられる（Breathing の項目はすべて既定値があるので安全）。
- `m_fPneumothoraxArrestEnabled` を false にすると、気胸が上限に達しても心停止しない。ただし悪化の判定もそこで止まる。
- SpO2 の閾値 `m_fSpO2`（85 / 75 / 65）は Breathing の設定ではなく、Circulation の閾値の中にある（[書き漏らすと危険な設定](#書き漏らすと危険な設定)）。

## 関連ページ

- [この原稿の読み方](about-this-manual.md)
- [物品の一覧](items.md)
- [致命傷と Second Chance](death-second-chance.md)
- [AI の治療](ai-medic.md)
