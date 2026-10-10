---
title: 炭酸アンモニウム
mod: circulation
channel: dev
mod_version: "1.5.36"
ace_commit: "703d1aa7"
game_version: "1.8.0.13"
verified_at: 2026-10-07
tags: [意識, 薬・物品]
order: 200
category: 物品
---

# 炭酸アンモニウム

> [!NOTE]
> [acemod/ACE-Anvil](https://github.com/acemod/ACE-Anvil) のソースコードとゲーム本体の処理を読んで書いた。\
> 時間の数値は、コードの式から計算した目安。人の多いサーバーでは、負荷によって全体が 1〜2 割遅く進むことがある。\
> 公式ドキュメント: [ACE Anvil – Medical（Dev）](https://anvil.acemod.org/dev/components/medical/)

## 概要

炭酸アンモニウムとは、気付け薬（スメリングソルト）の主な成分で、鼻の前で嗅がせて、失神を防いだり失神から回復させたりする。使うと、状態が Stable の意識不明の人が確率で目を覚ます。

## 効果

- 状態が Stable の意識不明の人を確率で起こす。成功すると約 3.1 s で目覚める。
- 成功すると意識の値を 24 HP/s（30 × 本体の基本倍率 0.8）で 5 s 回復する（最大 120）。回復倍率の影響は受けない。
- Stable 以外（Unstable・Critical・心停止）では何も起きない。失敗しても、Stable でなくても、物品は減る。
- 成功したときだけ投薬記録に残る（[投薬記録](vitals.md#投薬記録)）。
- 過量投与はない。

## 使い方

- 表示名は「Ammonium Carbonate」、操作は頭に対する「Hold under nose」（Circulation には日本語訳がなく、英語で表示される）。
- 使用条件はない（状態ごとに起きることは [5 つの状態](states.md#5-つの状態)）。
- 説明文は「Administered to unconscious patients.」、ヒントは「Increases wake-up chance」。

## 所要時間

意識のない相手に約 2.4 s（アニメーションの長さから算出。実測ではない）。詳しくは [処置の所要時間](treatment-times.md)。

## 効き方

`成功率 = m_fAmmoniumCarbonateSuccessChanceMin + (m_fAmmoniumCarbonateSuccessChanceMax − m_fAmmoniumCarbonateSuccessChanceMin) × 回復倍率 ÷ m_fMaxRevivalResilienceRecoveryScale`（1 以上なら必ず成功）

`目覚めるまでの時間 = (75 − 使ったときの意識の値) ÷ 24`

| 変数 | 意味 | 既定値 |
|---|---|---|
| `m_fAmmoniumCarbonateSuccessChanceMin` | 成功率の下限 | 0.2 |
| `m_fAmmoniumCarbonateSuccessChanceMax` | 成功率の上限 | 1.0 |
| `m_fMaxRevivalResilienceRecoveryScale` | 蘇生した後の回復倍率 | 0.2 |
| 回復倍率 | [回復倍率の決まり方](consciousness-system.md#回復倍率の決まり方)（蘇生していなければ 0.3 × 脳の割合、蘇生した後は 0.2 × 脳の割合） | — |

既定の設定では `成功率 = 0.2 + 0.8 × 回復倍率 ÷ 0.2`。

| 蘇生したか | 脳の HP | 回復倍率 | 1 回の成功率 | 平均の使用数 | 自然に目覚めるまで（参考） |
|---|---|---|---|---|---|
| していない | 100 | 0.3 | 1.0 | 1 | 62.5 s |
| していない | 75 | 0.225 | 1.0 | 1 | 83.3 s |
| していない | 50 | 0.15 | 0.8 | 1.25 | 125 s |
| していない | 25 | 0.075 | 0.5 | 2 | 250 s |
| した | 100 | 0.2 | 1.0 | 1 | 93.8 s |
| した | 90 | 0.18 | 0.92 | 1.09 | 104.2 s |
| した | 75 | 0.15 | 0.8 | 1.25 | 125 s |
| した | 50 | 0.1 | 0.6 | 1.67 | 187.5 s |
| した | 25 | 0.05 | 0.4 | 2.5 | 375 s |

- 蘇生していない Stable の人は、脳が 75% 以上なら必ず成功する。
- 「自然に目覚めるまで」は意識の値 0 から、待ちが終わっている場合。

> [!NOTE]
> 公式ドキュメントとの違い: ドキュメントは目覚めるまでを 2〜3 s としている。本体の基本倍率 0.8 が掛かるので、意識の値 0 からは約 3.1 s。

## 入手

医療キットに 8 個入っている（[医療キット](medical-kit.md)）。補給（アーセナル）でも手に入る（補給コスト 3）。

## 関連ページ

- [意識不明への対応](consciousness.md)
- [意識](consciousness-system.md)
- [状態と閾値](states.md)
- [薬の効き方](drug-effects.md)
- [エピネフリン](epinephrine.md)
- [診察とバイタルの確かめ方](vitals.md)
- [物品の一覧](items.md)

## 出典

- [DailyMed: Smelling Salt（ammonium carbonate inhalant）](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=41cbc0c9-3979-6762-e063-6294a90a07fb)（2026-10-07 に確認）
