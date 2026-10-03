---
title: メトプロロール
mod: circulation
channel: dev
mod_version: "1.5.36"
ace_commit: "703d1aa7"
game_version: "1.8.0.13"
verified_at: 2026-09-27
tags: [薬・物品]
order: 170
category: 物品
---

# メトプロロール

メトプロロール（Metoprolol）の効果、使い方、所要時間、効き方（式と推移）、入手をまとめる。Circulation の物品。

> [!NOTE]
> [acemod/ACE-Anvil](https://github.com/acemod/ACE-Anvil) のソースコードとゲーム本体の処理を読んで書いた。\
> 時間の数値は、コードの式から計算した目安。人の多いサーバーでは、負荷によって全体が 1〜2 割遅く進むことがある。\
> 公式ドキュメント: [ACE Anvil – Medical（Dev）](https://anvil.acemod.org/dev/components/medical/)

## 効果

- Circulation だけの薬（表示「Metoprolol」）。心拍数を下げる（1 本のピークで −16.5 bpm、約 26 s 後）。血圧は心拍数を通じて下がる。
- 健康な人に同時に 3 本で Critical（意識喪失）、4 本で心停止する。痛みがある患者では心拍数が上がっているので、必要な本数が増える（激痛なら 5.84 本で Critical、6.05 本で心停止）。

## 使い方

- 左右の腕・脚に打つ（「Inject metoprolol」）。表示と操作は英語（Circulation には日本語訳がない）。
- 使用条件はない（意識のある健康な仲間にも打てる）。
- 説明文は「Administered to patients with too high heart rate」、ヒントは「Decreases heart rate」。

## 所要時間

注射の所要時間は、自分に 3.2〜4.1 s（立ちで 4.1 s）、意識のある他人に 3.3 s、意識のない相手に 2.4 s（アニメーションの長さから算出。実測ではない）。詳しくは [処置の所要時間](treatment-times.md)。

## 効き方

式: `心拍数の補正 = −C ÷ 10.674` bpm（C = メトプロロールの濃度 nM）

| 項目 | 値 |
|---|---|
| 1 本の量 | 480 nM |
| 濃度が最大になる時刻 | 25.8 s |
| 最大の濃度 | 176.6 nM |
| 最大の半分に下がる時刻 | 69.2 s |
| 体内から消える時刻 | 168 s（約 2 分 48 秒） |

1 本打ったときの体内の濃度（体内から消える時刻に 0 になる）:

<!-- chart: x=経過; y=濃度; unit=nM; data=data/metoprolol-concentration.csv -->

健康な人に 1 本打ったときの推移:

<!-- chart: x=経過; y=心拍数, 平均血圧; data=data/metoprolol.csv -->

| 経過 | 心拍数 | 平均血圧 |
|---|---|---|
| 0 s | 80 | 93.3 mmHg |
| 10 s | 69.0 | 80.5 mmHg |
| 30 s | 63.6 | 74.2 mmHg |
| 60 s | 69.5 | 81.1 mmHg |
| 120 s | 77.9 | 90.9 mmHg |
| 180 s | 80.0 | 93.3 mmHg |

## 入手

Circulation 入りの医療キットに 8 本入っている（[医療キット](medical-kit.md)）。Circulation なしでは存在しない。

## 関連ページ

- [状態と閾値](states.md)
- [バイタル](vitals-system.md)
- [薬の効き方](drug-effects.md)
- [痛みと抑え方](pain.md)
- [診察とバイタルの確かめ方](vitals.md)
- [物品の一覧](items.md)
