---
title: 炭酸アンモニウム
mod: circulation
channel: dev
mod_version: "1.5.36"
ace_commit: "703d1aa7"
game_version: "1.8.0.13"
verified_at: 2026-09-27
tags: [意識, 薬・物品]
order: 200
category: 物品
---

# 炭酸アンモニウム

炭酸アンモニウム（Ammonium Carbonate）の効果、使い方、所要時間、成功率の式（効き方）、入手をまとめる。Circulation の物品。

> [!NOTE]
> [acemod/ACE-Anvil](https://github.com/acemod/ACE-Anvil) のソースコードとゲーム本体の処理を読んで書いた。
> 時間の数値は、コードの式から計算した目安。人の多いサーバーでは、負荷によって全体が 1〜2 割遅く進むことがある。
> 公式ドキュメント: [ACE Anvil – Medical（Dev）](https://anvil.acemod.org/dev/components/medical/)

## 効果

炭酸アンモニウム（Ammonium Carbonate）は Circulation の物品で、状態が Stable の意識不明の人を確率で起こす。成功すると約 3.1 s で目覚める。失敗しても、Stable でなくても、物品は減る。

- Stable 以外（Unstable・Critical・心停止）では何も起きない。
- 成功すると意識の値を 24 HP/s（30 × 本体の基本倍率 0.8）で 5 s 回復する（最大 120）。回復倍率の影響は受けない。
- 成功したときだけ投薬記録に残る（[投薬記録](vitals.md#投薬記録)）。

## 使い方

- 操作は頭に対する「Hold under nose」。意識不明の人に使う。
- 効くのは状態が Stable のときだけ。状態ごとに起きることは [5 つの状態](states.md#5-つの状態)。

## 所要時間

約 2.4 s（アニメーションの長さから算出。実測ではない）。

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

- Circulation 入りの医療キットに 8 個入っている。Circulation なしでは存在しない。

## 関連ページ

- [意識不明への対応](consciousness.md)
- [意識](consciousness-system.md)
- [状態と閾値](states.md)
- [薬の効き方](drug-effects.md)
- [物品の一覧](items.md)
