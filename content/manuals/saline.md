---
title: 生理食塩水
mod: core
channel: dev
mod_version: "1.5.36"
ace_commit: "703d1aa7"
game_version: "1.8.0.13"
verified_at: 2026-10-07
tags: [出血, 薬・物品]
order: 130
category: 物品
---

# 生理食塩水

> [!NOTE]
> [acemod/ACE-Anvil](https://github.com/acemod/ACE-Anvil) のソースコードとゲーム本体の処理を読んで書いた。\
> 時間の数値は、コードの式から計算した目安。人の多いサーバーでは、負荷によって全体が 1〜2 割遅く進むことがある。\
> 公式ドキュメント: [ACE Anvil – Medical（Dev）](https://anvil.acemod.org/dev/components/medical/)

## 概要

生理食塩水とは、体の液と同じ濃さ（等張）の食塩水で、点滴で入れて、ショックなどで減った血管の中の量を補う。使うと血液の量が増えるが、出血は止めない。

## 効果

- 血液量の 25% を 90 s かけて入れる。出血は止めない。
- 出血中に入れると、差し引きで増減する。血液の自然回復とは別に足される。

## 使い方

- 表示名は「生理食塩水」（本体の物品。実機で確認）。
- 患者の左右の腕に使う（本体の部位）。
- 使える条件: 血液が満タンでないこと。1 人に 1 袋ずつ（袋は患者の右腕の枠に付き、90 s 後に消える）。

## 所要時間

自分に 6.3 s、他人に 2.5〜5.2 s（立って 3.0〜3.6 s）、意識のない相手に 2.6 s（アニメーションの長さから算出。実測ではない）。詳しくは [処置の所要時間](treatment-times.md)。

## 効き方

`入る速さ = 総量 ÷ 90 s`

<!-- columns: - | circulation | !circulation -->

| 項目 | Circulation あり | Circulation なし |
|---|---|---|
| 総量 | 750 ml（3000 ml の 25%） | 1500 ml（6000 ml の 25%） |
| 速さ | 8.33 ml/s | 16.7 ml/s |
| 時間 | 90 s | 90 s |

- `m_fBloodRegenScale`（自然回復の倍率）は掛からない。フェニレフリンでも遅くならない。
- 生理食塩水は本体の物品。ACE は、ゴミを袋が空になって消えるときに出すように変えている。Circulation は総量を 750 ml に変えている。

### Circulation を入れている場合
<!-- mods: circulation -->

- 例: Class III（血液 38%）に 1 袋 → 90 s 後に 63%（Class II）。もう 1 袋で 88%（Class I）。
- 状態は閾値を外れた次の更新で戻る（戻りの余裕はない）。40% を超えれば Critical から Unstable へ、70% を超えれば Stable へ移る。
- 15 ml/s の出血が続いている間に入れると、90 s で `750 − 15 × 90 = −600 ml` と出血に負ける。

### Circulation なし（Core だけ）の場合
<!-- mods: !circulation -->

- 例: 胸の 42.25 ml/s の傷に、60 s の時点で包帯と生理食塩水を同時に使う → 3465 ml から増え始め、10 s 後からは自然回復と合わせて 21.1 ml/s で増え、120 s で 4687 ml。

## 入手

医療キットに 3 袋入っている（Core だけでも Circulation 入りでも。[医療キット](medical-kit.md)）。補給（アーセナル）でも手に入る（補給コスト 3。本体の補給の一覧にある）。

## 関連ページ

- [出血と止血](hemorrhage.md)
- [出血](bleeding-system.md)
- [薬の効き方](drug-effects.md)
- [フェニレフリン](phenylephrine.md)
- [診察とバイタルの確かめ方](vitals.md)
- [物品の一覧](items.md)

## 出典

- [MSD マニュアル プロフェッショナル版「輸液蘇生」](https://www.msdmanuals.com/ja-jp/professional/21-%E6%95%91%E5%91%BD%E5%8C%BB%E7%99%82/%E3%82%B7%E3%83%A7%E3%83%83%E3%82%AF%E3%81%8A%E3%82%88%E3%81%B3%E8%BC%B8%E6%B6%B2%E8%98%87%E7%94%9F/%E8%BC%B8%E6%B6%B2%E8%98%87%E7%94%9F-fluid-resuscitation)（2026-10-07 に確認）
