---
title: サーバー設定の注意点
mod: general
channel: dev
mod_version: "1.5.36"
ace_commit: "703d1aa7"
game_version: "1.8.0.13"
verified_at: 2026-09-27
tags: [管理者向け]
order: 510
category: 管理者向け
---

# サーバー設定の注意点

> [!NOTE]
> [acemod/ACE-Anvil](https://github.com/acemod/ACE-Anvil) のソースコードとゲーム本体の処理を読んで書いた。\
> 時間の数値は、コードの式から計算した目安。人の多いサーバーでは、負荷によって全体が 1〜2 割遅く進むことがある。\
> 公式ドキュメント: [ACE Anvil – Medical（Dev）](https://anvil.acemod.org/dev/components/medical/)

> [!WARNING]
> ミッションヘッダーで `m_ACE_Medical_Circulation` を書くなら、3 つの閾値のすべての項目を書く（Breathing 入りなら `m_fSpO2` も）。1 つでも書き漏らすと、例えば `m_fHeartRateHighBPM` が 0 になり、**全員がすぐ心停止する**おそれがある（[書き漏らすと危険な設定](#書き漏らすと危険な設定)）。

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
## ミッションヘッダーの書き方

書き方の例（Breathing の嘔吐を無くし、ほかは既定値のままにする）:

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

### ミッションヘッダーの設定は丸ごと差し替わる

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

### 書き漏らすと危険な設定

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

上の表のとおり、ACE の 2 つの倍率がゲームモードの倍率を上書きする。そのため Conflict では、本体だけのときの約 1.33 倍の速さで出血する（出血死までの時間は 0.75 倍）。

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

- どちらもプレイヤーだけに効く。AI の死に方を変える設定は [AI の設定](#ai-の設定)。

### 死亡を無効にしたとき

- 出血死しない設定では、血液が 0 になっても意識不明のまま残る。血液を 33.3% より上に戻せば目覚めうる（Circulation なし）。
- `m_bPlayerCannotDie` が true でも、次の死亡は防げない（本体の「無敵を無視して殺す」処理を使うため）: リスポーン画面からの自殺、Capture & Hold のスポーン地帯、Clean Sweep、ハブの範囲など。そのため、プレイヤーはリスポーン画面の自殺でやり直せる。
- ゲームマスターの「破壊」（Neutralize）と溺水は同じ死亡処理を通るので、`m_bPlayerCannotDie` が true なら防がれる。
- 設定の書き方の注意は [書き漏らすと危険な設定](#書き漏らすと危険な設定)、既定値の一覧は [設定の一覧](server-settings-defaults.md)。

## AI の設定

- AI 自身の負傷の扱いは、AI の MOD（ACE Medical AI）ではなく、Core と Circulation の設定で決まる。AI の MOD の有無に関係ない。
- AI 向けの違いを決める設定は 2 つだけ。既定では、**AI は致命打で即死し、心停止に入った瞬間に死ぬ**。

| 設定 | MOD | 既定値 | false のとき | true のとき |
|---|---|---|---|---|
| `m_bSecondChanceForAIEnabled` | Core | false | AI（ゲームマスターが乗り移った AI を含む）には Second Chance が無く、致命打で死ぬ | プレイヤーと同じく Second Chance の判定がある |
| `m_bCardiacArrestForAIEnabled` | Circulation | false | AI は心停止に入った瞬間に死ぬ | AI も心停止の状態になり、CPR で蘇生できる |

- 既定のままの AI の死に方（出血・気道閉塞・気胸）は [AI 自身が負傷したとき](ai-medic.md#ai-自身が負傷したとき)。
- プレイヤーだけに効く設定（`m_bPlayerCannotDie`・`m_bBleedOutForPlayersEnabled`）は [死亡を防ぐ設定](#死亡を防ぐ設定)。
- AI の MOD（ACE Medical AI Dev）にはサーバー設定が無い。AI の振る舞いの内部の値（衛生兵を探し直す間隔 5 s など）は既定値のまま使われ、サーバー設定では変えられない。AI の MOD は ACE All in One Dev に含まれない（[AI の治療](ai-medic.md)）。

## 関連ページ

- [設定の一覧](server-settings-defaults.md)
- [状態と閾値](states.md)
- [バイタルの仕組み](vitals-system.md)
- [出血の仕組み](bleeding-system.md)
- [意識の仕組み](consciousness-system.md)
- [呼吸と気道の仕組み](respiration-system.md)
- [気胸の仕組み](pneumothorax-system.md)
- [痛みの仕組み](pain-system.md)
- [薬の効き方](drug-effects.md)
- [致命傷と Second Chance](death-second-chance.md)
- [AI の治療](ai-medic.md)
- [このマニュアルの読み方](about-this-manual.md)
