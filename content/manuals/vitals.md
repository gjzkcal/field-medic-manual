---
title: 診察とバイタルの確かめ方
mod: circulation
channel: dev
mod_version: "1.5.36"
ace_commit: "703d1aa7"
game_version: "1.8.0.13"
verified_at: 2026-09-27
tags: [循環]
order: 20
category: 処置
---

# 診察とバイタルの確かめ方

脈・血圧・呼吸数・SpO2 の確かめ方と正常値、Circulation の 5 つの状態のあらまし、診察画面と画面の効果をまとめる。バイタルは Circulation を入れたときだけある（呼吸数と SpO2 は Breathing も必要）。状態の閾値は [状態と閾値](states.md)、心拍数・血圧の決まり方は [バイタル](vitals-system.md)、呼吸数と SpO2 の決まり方は [呼吸と SpO2](respiration-system.md) にある。

> [!NOTE]
> [acemod/ACE-Anvil](https://github.com/acemod/ACE-Anvil) のソースコードとゲーム本体の処理を読んで書いた。\
> 時間の数値は、コードの式から計算した目安。人の多いサーバーでは、負荷によって全体が 1〜2 割遅く進むことがある。\
> 公式ドキュメント: [ACE Anvil – Medical（Dev）](https://anvil.acemod.org/dev/components/medical/)

## バイタルを確かめる操作

確かめる方法は 2 つある。結果はどちらも画面の通知（英語）で出る。

| 方法 | 相手 | 所要時間 | 開き方 |
|---|---|---|---|
| 医療ラジアルメニューの「診察する（Examine patient）」 | 照準の先のキャラクターなら誰でも（意識があっても） | なし（すぐ出る） | 既定 Ctrl+H |
| 体への操作 | 意識不明の相手だけ | 押し続け 3 s | 相手の体の部位を見て操作 |

| 項目 | 体の操作の名前と部位 | 通知の文 | 必要な MOD |
|---|---|---|---|
| 脈 | 「Check pulse」（頭・胸・腕・脚） | You find a heart rate of 80 | Circulation |
| 血圧 | 「Check blood pressure」（腕・脚） | You find a blood pressure of 119/79 mmHg（収縮期/拡張期） | Circulation |
| 呼吸数 | 「Check respiratory rate」または「Check Breathing」（頭。場面で表記が変わり、実機で両方を確認） | You find a respiratory rate of 14 breaths per minute | Breathing |
| SpO2 | 「Check SpO2」（腕） | You find a SpO2 of 97% | Breathing |

- 通知の数値は**小数点以下を切り捨て**て出る（心拍数 79.9 なら 79）。
- 体への操作は、ラグドール中・水中・落下中のときと、手に道具を持っているときは出ない。
- 確かめる操作は、患者の状態を変えない。
- 表示は英語のまま（Circulation・Breathing には日本語訳がない）。
- ゲームマスターは、キャラクターのツールチップの「Vital signs」（心拍数と血圧。四捨五入、1 s ごとに更新）と「Brain」（脳の残り）で見られる。

### Circulation なし（Core だけ）の場合
<!-- mods: !circulation -->

- バイタル（脈・血圧）はなく、確かめる操作もない。診察画面の本体の表示（出血・止血帯など）で見る（[出血の見分け方](hemorrhage.md#出血の見分け方)）。

## 正常値と表示

無傷のキャラクターの値:

| 項目 | 内部の値 | 通知に出る値 | 決める設定（既定値） |
|---|---|---|---|
| 心拍数 | 80 bpm | 80 | `m_fDefaultHeartRateBPM`（80） |
| 血圧 | 収縮期 120.0 / 拡張期 80.0 mmHg（平均 93.3 mmHg = 12.443 kPa） | **119/79**（実機で確認） | `m_fDefaultMeanArterialPressureKPA`（12.443）、`m_fDefaultPulsePressureKPA`（5.3329） |
| 呼吸数（Breathing） | 14.573 回/分 | 14 | `m_fDefaultRespiratoryRateBPM`（14.573） |
| SpO2（Breathing） | 97.149% | 97 | —（既定値の釣り合いで決まる） |
| 一回拍出量 | 95 ml | 出ない | `m_fDefaultStrokeVolumeML`（95） |
| 心拍出量 | 7600 ml/分 | 出ない | — |

- 血圧が 120/80 ではなく 119/79 と出るのは、切り捨てのため（ゲームマスターのツールチップは四捨五入で 120/80）。
- 単位の換算: `mmHg = 7.5006 × kPa`。

場面ごとの通知の値:

| 場面 | 平均血圧 | 通知の血圧 | 通知の脈 |
|---|---|---|---|
| 無傷 | 12.443 kPa（93.3 mmHg） | 119/79 | 80 |
| 血液 60%・心拍数 80 | 7.466 kPa（56.0 mmHg） | 71/47 | 80 |
| Unstable になる平均血圧の境目 | 7.11 kPa（53.3 mmHg） | 68/45 | — |
| Critical・心停止になる平均血圧の境目 | 5.21 kPa（39.1 mmHg） | 50/33 | — |
| 平均血圧の上限（超えると心停止） | 29.5 kPa（221.3 mmHg） | 284/189 | — |
| CPR 中（血液 100%、心拍数 105.3） | 3.77 kPa（28.3 mmHg） | 36/24 | 100〜120 の乱数 |
| 心停止中 | 0 | 0/0 | 0 |

## 5 つの状態

Circulation を入れると、生存しているキャラクターは 5 つの状態（Stable / Unstable / Critical / 心停止 / 蘇生中）のどれかになる。Critical に入ると意識を失い、Unstable 以下では意識不明のまま自然には目覚めない。出血では血液 70% 以下で Unstable、40% 以下で Critical になる。

状態ごとに起きること、閾値と設定は [状態と閾値](states.md) にまとめた。

## 診察画面の表示

- 診察画面（負傷者を診察 / Inspect casualty）に、Circulation 入りで**出血の分類（Class I〜IV hemorrhage）**と**投薬記録（最新 8 件）**が加わる。
- **心拍数・血圧の数値は診察画面には出ない**。バイタルは [バイタルを確かめる操作](#バイタルを確かめる操作) で見る。
- Breathing 入りで、気胸（Open pneumothorax / Tension pneumothorax。緊張性を優先して表示）が出る。

### Circulation を入れている場合
<!-- mods: circulation -->

- 診察の操作は、本体の条件に加えて「痛みの HP が少しでも減っている」「状態が Stable でない」ときにも出る。
- 診察画面は 10 s 表示される。
- 医療ラジアルメニューの「診察する」から離れた位置でも開けるが、相手との距離が 3 m を超えると薄くなり、4 m 以上で閉じる（この距離の挙動は本体の診察画面のもので、Circulation がなくても同じ）。
- 自分のインベントリでは、血液の表示が Class I〜IV になり、出血の欄が Class I から出る。投薬記録はツールチップに出る。
- 投薬記録の形式は [投薬記録](#投薬記録)。

### Breathing を入れている場合
<!-- mods: breathing -->

| 状態 | 見え方 |
|---|---|
| 開放性気胸 | 診察画面とインベントリに「Open pneumothorax」 |
| 緊張性気胸 | 同「Tension pneumothorax」。呼吸数 0 |
| 嘔吐による気道閉塞 | 頭に「Clear vomit」の操作が出る。呼吸数 0 |
| 舌根沈下 | **直接は見えない**（「Lift chin」は塞がっていなくても出る）。呼吸数 0 で見分ける |
| King LT・酸素マスク | 口元に付けた物が見える |

- インベントリの気胸の表示は、自分のキャラクターの状態を出す。
- 詳しくは [気道閉塞の見分け方](airway.md#気道閉塞の見分け方)。

### Circulation なし（Core だけ）の場合
<!-- mods: !circulation -->

- 本体の表示（出血・止血帯・生理食塩水など）に、Core が骨折（腕・脚）の表示を足す。全体の損傷度は ACE の全体の健康度で計算し直している（Hitzones では最も減った部位の割合）。

## 投薬記録

- Circulation だけにある。注射と炭酸アンモニウム（成功したときだけ）を記録し、**最新 8 件**を残す。
- 診察画面（負傷者を診察）と、自分のインベントリのツールチップに、新しい順に出る。
- 形式は「時:分 物品名 (投与者)」。時刻はゲーム内の時刻で、分は 0 で埋めない（14 時 5 分は「14:5」）。投与者の名前がなければ「N/A」。

例: `14:5 Epinephrine (Player1)`

- 炭酸アンモニウムは、失敗したとき（Stable でなかったときを含む）は記録に残らない。
- Circulation なし（Core だけ）では投薬記録はない。

## 画面の効果

自分のキャラクターの状態で、自分の画面に出る効果:

| 状態 | 画面・音 |
|---|---|
| 心停止・蘇生中（Circulation） | 画面がほぼ真っ黒（不透明度 0.85）になり、心停止用の音の合図が入る |
| 意識不明（本体の処理） | 暗いマスクが 0.5 s ごとに揺れる。開き具合は抵抗値（0 → 75 で開いていく）で決まり、血液が最も少ない段階（Circulation では Class IV、20% 以下）では最も閉じる |
| 痛みあり・意識あり（Core） | 白い点滅（[痛みの画面効果](pain-system.md#痛みの画面効果)） |
| 失血（本体の処理） | 画面の色が抜ける（[出血の見分け方](hemorrhage.md#出血の見分け方)） |
| SpO2 の低下・無呼吸・気道閉塞（Breathing） | **何も出ない** |

> [!WARNING]
> Breathing の無呼吸・SpO2 の低下には、画面の効果も音もない（意識不明の暗いマスクも、SpO2 や気道には反応しない）。画面や音で気づく手がかりはなく、呼吸数・SpO2 を確かめると分かる（[呼吸数と SpO2 を確かめる](#バイタルを確かめる操作)）。

## 詳しい仕組み

- 状態が変わる閾値（心拍数・平均血圧・血液・SpO2）と設定、血液の分類（Class I〜IV）は [状態の閾値](states.md#状態の閾値)。
- 心拍数は「目標の心拍数」（通常 80、痛みで最大 130）に向かって、毎秒、残りの差の半分ずつ近づく。出血で血液が 40% を切り Critical になると頻脈が始まり、約 26% を切ると心停止する（[心拍数の決まり方](vitals-system.md#心拍数の決まり方)）。
- 薬と痛みがなければ、平均血圧は血液の割合に比例する（血液 50% で 47 mmHg）。通知の上下の値は平均血圧から決まった比で作る（[血圧の決まり方](vitals-system.md#血圧の決まり方)）。
- 呼吸数は気胸の大きさだけで決まり、気道が塞がると 0 になる。無呼吸になると SpO2 は 16 s で 85% 未満（Unstable）、85 s で 75% 未満（Critical）、約 15 分で 65% 未満（心停止）になる（[呼吸数と SpO2](respiration-system.md#呼吸数と-spo2)）。

## 関連ページ

- [状態と閾値](states.md)
- [バイタル](vitals-system.md)
- [呼吸と SpO2](respiration-system.md)
- [心停止と CPR](cardiac-arrest.md)
- [痛みと抑え方](pain.md)
- [出血と止血](hemorrhage.md)
- [気胸と処置](breathing.md)
- [気道閉塞と気道の確保](airway.md)
- [意識不明への対応](consciousness.md)
