---
title: NCD キット
mod: breathing
channel: dev
mod_version: "1.5.36"
verified_at: 2026-09-27
tags: [気道・呼吸, 薬・物品]
order: 230
category: 物品
---

# NCD キット

NCD キット（NCD Kit）の効果、使い方、所要時間、使うまでの時間と結果、入手をまとめる。Breathing の物品。

> [!NOTE]
> ACE Medical **Dev 1.5.36** のソースコード（[acemod/ACE-Anvil](https://github.com/acemod/ACE-Anvil) の dev ブランチ `703d1aa7`）とゲーム本体 1.8.0.13 の処理を読んで書いた（2026-09-27 確認）。Release 版（1.4.3）では違う場合がある。
> 時間の数値は、コードの式から計算した目安（シングルプレイ）。人の多いサーバーでは、負荷によって全体が 1〜2 割遅く進むことがある（出来事の順番は変わらない）。
> 公式ドキュメント: [ACE Anvil – Medical（Dev）](https://anvil.acemod.org/dev/components/medical/)

関連: [気胸と処置](breathing.md) ／ [チェストシール](chest-seal.md) ／ [呼吸と SpO2](respiration-system.md) ／ [物品の一覧](items.md)

## 効果

患者の胸の操作「Perform needle decompression」で NCD キット（NCD Kit）を使うと、**緊張性気胸だけを解除する**。開放性気胸（大きさ）はそのまま残るので、悪化の判定が続き、再び約 60 秒ごとに 5% で緊張性になりうる。

- 式: `緊張性 ← なし`（気胸の大きさはそのまま）
- 開放性気胸も治すには、チェストシールも要る（チェストシールは緊張性を治さず、NCD キットは大きさを戻さないため）。

## 使い方

- 使える条件: 患者が緊張性気胸になっていること。
- 使うと消費する（ソースの dev ブランチ `703d1aa7` ではケースとホースのゴミが出るが、Workshop の Dev 1.5.36 にはまだこのゴミが無い）。
- 物品の説明は「Kit for performing needle decompression」、ヒントは「Used for treating tension pneumothorax」（英語のまま）。

## 所要時間

- 所要時間: 6.3 秒（アニメーションの長さから算出。実測ではない）。自分に使うときはすぐ終わる（自分用の動きが無い。実機で確認）。

## 使うまでの時間と結果

緊張性気胸（大きさ 0.18）に、T 秒後に NCD キットを使ったとき:

| 使うまでの時間 T | そのときの SpO2 | そのときの状態 | 20 分後 |
|---|---|---|---|
| 使わない | — | — | 心停止（SpO2 35.9%） |
| 30 秒 | 79.5% | Unstable | Stable（呼吸数 17.8、SpO2 96.1%） |
| 60 秒 | 75.7% | Unstable | Stable |
| 2 分 | 74.5% | Critical | Stable |
| 5 分 | 72.3% | Critical | Stable |
| 10 分 | 68.6% | Critical | Stable |
| 15 分 | 58.0% | 心停止（805 秒で心停止済み） | 心停止のまま（CPR が要る） |

- 心停止する前に使えば、Stable に戻る。使った後は開放性気胸（0.18）が残り、呼吸数 17.8、SpO2 96.1% になる。
- 心停止した後に使っても、それだけでは蘇生しない（[CPR を行う](cardiac-arrest.md#cpr-を行う)）。

## 入手

初期装備にも医療キットにも入っていない（ゲーム内で確認）。補給（アーセナル）で手に入れる。補給コスト 3。
