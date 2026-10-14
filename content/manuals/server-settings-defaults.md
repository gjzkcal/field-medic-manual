---
title: 設定の一覧
mod: general
channel: dev
mod_version: "1.5.36"
ace_commit: "703d1aa7"
game_version: "1.8.0.13"
verified_at: 2026-09-27
tags: [管理者向け]
order: 520
category: 管理者向け
---

# 設定の一覧

> [!NOTE]
> [acemod/ACE-Anvil](https://github.com/acemod/ACE-Anvil) のソースコードとゲーム本体の処理を読んで書いた。\
> 時間の数値は、コードの式から計算した目安。人の多いサーバーでは、負荷によって全体が 1〜2 割遅く進むことがある。\
> 公式ドキュメント: [ACE Anvil – Medical（Dev）](https://anvil.acemod.org/dev/components/medical/)


## Core の設定

「止めたいとき」の列は、機能ごと止められる設定の書き方。

| 設定 | 既定値 | 内容 | 止めたいとき |
|---|---|---|---|
| `m_fDefaultResilienceRegenScale` | 0.3 | 意識の自然回復の倍率。回復は $5 \times 0.8 \times \text{この値}$ HP/s（既定で 1.2 HP/s） | — |
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

## Hitzones の設定

| 設定 | 既定値 | 内容 | 止めたいとき |
|---|---|---|---|
| `m_bOrganHitZonesEnabled` | true | 臓器（心臓・大腿動脈）を有効にする | false で臓器なし |
| `m_fSecondChanceOnHeart` | 0 | 心臓の Second Chance の確率 $p$。判定が 2 回あるので、実際の生存率は $p \times p$ | — |
| `m_bInstantUnconOnMassiveBleeding` | true | 首・大腿動脈の大出血でその場で意識を失う | false で大出血でも即時には意識を失わない |

- 詳しくは [Hitzones の急所と心臓](death-second-chance.md#hitzones-の急所と心臓) を見る。

## Circulation の設定

| 設定 | 既定値 | 内容 |
|---|---|---|
| `m_fDefaultHeartRateBPM` | 80 | 基準の心拍数（bpm） |
| `m_fDefaultStrokeVolumeML` | 95 | 基準の 1 回拍出量（ml） |
| `m_fDefaultMeanArterialPressureKPA` | 12.443 | 基準の平均血圧（kPa） |
| `m_fDefaultPulsePressureKPA` | 5.3329 | 基準の脈圧（kPa）。血圧の表示だけに影響する |
| `m_UnstableThresholds` ／ `m_CriticalThresholds` ／ `m_CardiacArrestThresholds` | [書き漏らすと危険な設定](server-settings.md#書き漏らすと危険な設定) の閾値の表 | 状態の閾値（既定値なし。Settings.conf の値） |
| `m_fBrainDamageRate`（`m_CardiacArrestDamageEffect` の中） | 0.333 | 心停止中の脳の損傷（HP/s）。死亡まで $10 + 100 \div \text{この値}$ s |
| `m_fEffectStartDelayS`（同上） | 10 | 心停止から脳の損傷が始まるまで（s） |
| `m_bCardiacArrestForAIEnabled` | false | AI も心停止の状態になるか（false なら即死） |
| `m_fCPRStrokeVolumeScale` | 0.23 | CPR 中の 1 回拍出量の倍率 |
| `m_fCPRSuccessCheckTimeoutS` | 22 | 蘇生判定の間隔（CPR の累計の秒数） |
| `m_fCPRSuccessChanceMin` | 0 | 蘇生判定の最小の成功率（血液が Class IV の閾値以下） |
| `m_fCPRSuccessChanceMax` | 0.4 | 蘇生判定の最大の成功率（血液が Class II の閾値以上） |
| `m_fAmmoniumCarbonateSuccessChanceMin` | 0.2 | 炭酸アンモニウムの最小の成功率 |
| `m_fAmmoniumCarbonateSuccessChanceMax` | 1.0 | 炭酸アンモニウムの最大の成功率 |
| `m_fMaxRevivalResilienceRecoveryScale` | 0.2 | 蘇生した後の意識の回復倍率 |
| `m_fCardiacArrestMaxTotalBleedingRate` | 20 | 出血の上限 $\max(\text{この値},\ \text{心拍出量} \div 60)$ ml/s の下限側 |

- 計算例（脳）: 既定なら心停止から死亡まで 10 + 100 ÷ 0.333 ≈ 310 s（約 5 分）。CPR 中は脳の損傷が止まる（[脳の損傷と残り時間](cardiac-arrest-system.md#脳の損傷と残り時間)）。

## 薬の設定（Circulation）

- 薬の設定 `m_ACE_Medical_Medication` は、薬ごとの吸収と消失の速さ（薬物動態）と、効き方（効果）の一覧を持つ。値はすべて Settings.conf にあり、ほとんどの項目にスクリプトの既定値が無い（`m_fGamma` と `m_fMaxEffect` だけは既定値 1）。
- 変えるときは一覧を丸ごと書く必要がある（[書き漏らすと危険な設定](server-settings.md#書き漏らすと危険な設定)）。各薬の値は [薬の効き方の計算](drug-effects.md#薬の効き方の計算) を見る。

## Breathing の設定

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
| `m_bPaCO2Enabled` | true | 効かない（[効かない設定](server-settings.md#効かない設定)） |
| `m_bKidneyEnabled` | false | 効かない（未実装） |

- 例: `"m_ACE_Medical_Breathing": {"m_fVomitChancePerMinute": 0}` だけを書くと、嘔吐は起きず、ほかは既定値のままとみられる（Breathing の項目はすべて既定値があるので安全）。
- `m_fPneumothoraxArrestEnabled` を false にすると、気胸が上限に達しても心停止しない。ただし悪化の判定もそこで止まる。
- SpO2 の閾値 `m_fSpO2`（85 / 75 / 65）は Breathing の設定ではなく、Circulation の閾値の中にある（[書き漏らすと危険な設定](server-settings.md#書き漏らすと危険な設定)）。

## 関連ページ

- [サーバー設定の注意点](server-settings.md)
- [出血の仕組み](bleeding-system.md)
- [意識の仕組み](consciousness-system.md)
- [痛みの仕組み](pain-system.md)
- [致命傷と Second Chance](death-second-chance.md)
- [状態と閾値](states.md)
- [バイタルの仕組み](vitals-system.md)
- [心停止と蘇生](cardiac-arrest-system.md)
- [薬の効き方](drug-effects.md)
- [呼吸と気道の仕組み](respiration-system.md)
- [気胸の仕組み](pneumothorax-system.md)
