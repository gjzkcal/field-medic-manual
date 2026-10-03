---
title: 状態と閾値
mod: circulation
channel: dev
mod_version: "1.5.36"
ace_commit: "703d1aa7"
game_version: "1.8.0.13"
verified_at: 2026-09-27
tags: [循環]
order: 410
category: システム
---

# 状態と閾値

Circulation の 5 つの状態（Stable / Unstable / Critical / 心停止 / 蘇生中）で起きること、状態が変わる閾値と設定、血液の分類をまとめる。状態は Circulation を入れたときだけある。

> [!NOTE]
> [acemod/ACE-Anvil](https://github.com/acemod/ACE-Anvil) のソースコードとゲーム本体の処理を読んで書いた。
> 時間の数値は、コードの式から計算した目安。人の多いサーバーでは、負荷によって全体が 1〜2 割遅く進むことがある。
> 公式ドキュメント: [ACE Anvil – Medical（Dev）](https://anvil.acemod.org/dev/components/medical/)

## 5 つの状態

Circulation を入れると、生存しているキャラクターは次の 5 つの状態のどれかになる。サーバーが約 1 s ごとに判定する。

| 状態 | 起きること |
|---|---|
| Stable（安定） | 意識不明なら自然に目覚める（抵抗値が 1.2 HP/s × 脳の割合で回復。CPR で蘇生した後は 0.8 HP/s × 脳の割合）。炭酸アンモニウムが効く |
| Unstable（不安定） | これだけでは意識を失わない。ただし意識不明なら自然には目覚めない（回復が 0）。炭酸アンモニウムは効かない |
| Critical（重篤） | **入った瞬間に意識を失う**。血液 40% 未満なら頻脈が始まる |
| 心停止（Cardiac arrest） | 心拍数・血圧が 0。意識不明。10 s 後から脳が減り、約 5 分で死亡（[心停止と CPR](cardiac-arrest.md)） |
| 蘇生中（Resuscitation） | CPR を受けている間。脳は減らない |

## 状態の閾値

次のどれか 1 つでも当たると、その状態に移る。判定は「心停止 → Critical → Unstable」の順で、最初に当たったものになる（Stable から直接 Critical や心停止に移ることもある）。

| 条件 | → Unstable | → Critical | → 心停止 |
|---|---|---|---|
| 心拍数が下限より低い | < 40 | < 30 | < 20 |
| 心拍数が上限より高い | > 220 | > 220 | > 220 |
| 平均血圧が下限より低く、かつ心拍数がこの値以下 | < 7.11 kPa（53.3 mmHg）かつ ≤ 80 | < 5.21 kPa（39.1 mmHg）かつ ≤ 40 | < 5.21 kPa かつ ≤ 30 |
| 平均血圧が上限より高い | > 29.5 kPa（221.3 mmHg） | > 29.5 kPa | > 29.5 kPa |
| 血液の残り | ≤ 70%（Class II） | ≤ 40%（Class III） | ≤ 20%（Class IV） |
| SpO2（Breathing のみ） | < 85% | < 75% | < 65% |

- 式: `当たる ⇔ (心拍数 < 下限) または (心拍数 > 上限) または (平均血圧 < 下限 かつ 心拍数 ≤ 条件の値) または (平均血圧 > 上限) または (血液の割合 ≤ 分類の閾値) または (SpO2 < 閾値)`
- 戻るとき（Unstable → Stable、Critical → Unstable）は、その状態の条件に**どれも当たらなくなった**時点で戻る。戻りの余裕（ヒステリシス）はない。
- 心拍数と平均血圧の上限は 3 つとも同じなので、**高すぎる心拍数・血圧では Stable からいきなり心停止**する（エピネフリン・フェニレフリンの過量投与。[過量投与](drug-effects.md#過量投与)）。

計算例:

- 薬も痛みもなく心拍数 80 のままなら、平均血圧は `12.443 × 血液の割合` kPa。平均血圧で Unstable になるのは血液 57.1% 未満だが、その前に血液 70% で Unstable になる。出血では血液の分類が先に効く。
- 血液 100% で心拍数が 33 まで下がると、平均血圧 `12.443 × 33 ÷ 80 = 5.13 kPa` < 5.21 かつ 心拍数 ≤ 40 → Critical。心拍数 30 なら心停止。

出血が続いたときに状態が変わる時刻と、そのときの血液の残りは [放置したときの時間](bleeding-system.md#放置したときの時間)。

> [!NOTE]
> 公式ドキュメントとの違い:
> - ドキュメントのバイタルの表は、Unstable・Critical の血圧の条件を血圧だけで書いているが、実際は「心拍数 ≤ 80」「心拍数 ≤ 40」も満たすときだけ当たる。心停止の注記「HR < 30」は、ソースでは「≤ 30」。
> - Critical の血圧はドキュメントでは 51/34 未満だが、式から計算すると 50.24/33.49（通知では 50/33）。
> - 出血による心停止は Class IV ではなく、多くは Class III の中（血液 25% 前後）で頻脈によって起きる（[心拍数の決まり方](vitals-system.md#心拍数の決まり方)）。
> - Breathing の説明には「気道が塞がると Unstable」とあるが、直接その規則はない。無呼吸で SpO2 が 85% を割ると（約 16 s 後）Unstable になる。

### 設定

閾値はサーバーの設定 `m_UnstableThresholds` / `m_CriticalThresholds` / `m_CardiacArrestThresholds` の中にある。項目は `m_fHeartRateLowBPM`（心拍数の下限）、`m_fHeartRateHighBPM`（上限）、`m_fMeanArterialPressureLowKPA`（平均血圧の下限）、`m_fMaxHeartForMeanArterialPressureLowBPM`（平均血圧の下限を使う心拍数の上限）、`m_fMeanArterialPressureHighKPA`（平均血圧の上限）、`m_eBloodState`（血液の分類）、`m_fSpO2`（Breathing）。既定値は上の表のとおり。

> [!WARNING]
> 閾値の項目にはスクリプトの既定値がない。ミッションヘッダーで Circulation の設定を書くときに 1 つでも書き漏らすと 0 になり、例えば `m_fHeartRateHighBPM` が 0 だと全員がすぐ心停止する。Breathing 入りで `m_fSpO2` を書き漏らすと、SpO2 で状態が悪化しなくなる（[書き漏らすと危険な設定](server-settings.md#書き漏らすと危険な設定)）。

### 血液の分類

| 分類 | 血液の残り（3000 ml が満タン） | 診察画面・インベントリの表示 |
|---|---|---|
| Normal | 100% | なし |
| Class I | 70〜100% | Class I hemorrhage |
| Class II | 40〜70%（70% ちょうどを含む） | Class II hemorrhage |
| Class III | 20〜40%（40% ちょうどを含む） | Class III hemorrhage |
| Class IV | 0〜20%（20% ちょうどを含む） | Class IV hemorrhage |
| Fatal | 0 | 死亡 |

満タンから少しでも減ると Class I になるとみられる（本体の処理からの推定）。

### Breathing を入れている場合
<!-- mods: breathing -->

- SpO2 の条件（85 / 75 / 65%）が加わる。戻るときは SpO2 が閾値以上であることも必要。
- 気道が塞がっている間は、状態に関係なく意識が戻らない（[気道と意識](consciousness.md#気道と意識)）。
- 気胸が最大（0.75）まで進むと、状態が心停止に切り替わる（設定 `m_fPneumothoraxArrestEnabled`、既定 true）。

### Circulation なし（Core だけ）の場合
<!-- mods: !circulation -->

- 5 つの状態はなく、生存・意識不明・死亡だけ。血液の分類（Class）もない。意識は抵抗値と血液量で決まる（[意識を失う条件](consciousness-system.md#意識を失う条件)、[血液量と出血の段階](bleeding-system.md#血液量と出血の段階)）。

## 関連ページ

- [診察とバイタルの確かめ方](vitals.md)
- [バイタル](vitals-system.md)
- [出血](bleeding-system.md)
- [心停止と蘇生](cardiac-arrest-system.md)
- [意識不明への対応](consciousness.md)
- [薬の効き方](drug-effects.md)
- [サーバー設定の注意点](server-settings.md)
