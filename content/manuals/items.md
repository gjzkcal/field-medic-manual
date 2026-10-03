---
title: 物品の一覧
mod: core
channel: dev
mod_version: "1.5.36"
ace_commit: "703d1aa7"
game_version: "1.8.0.13"
verified_at: 2026-09-27
tags: [薬・物品]
order: 100
category: 物品
---

# 物品の一覧

医療の物品を、本体と Core・Circulation・Breathing ごとに一覧にする。効果・使える条件・使った後の要点と、入手の方法をまとめる。物品ごとの詳しいことは、表の物品名から各原稿へ。

> [!NOTE]
> [acemod/ACE-Anvil](https://github.com/acemod/ACE-Anvil) のソースコードとゲーム本体の処理を読んで書いた。
> 時間の数値は、コードの式から計算した目安。人の多いサーバーでは、負荷によって全体が 1〜2 割遅く進むことがある。
> 公式ドキュメント: [ACE Anvil – Medical（Dev）](https://anvil.acemod.org/dev/components/medical/)

## 物品の一覧

- 本体と Core の物品（止血帯・包帯・生理食塩水・モルヒネ注射器・エピネフリン・医療キット）は、どの組み合わせにもある。
- Circulation を入れると、エピネフリン・モルヒネ注射器・生理食塩水の効き方が変わり、薬が 4 種類（炭酸アンモニウム・メトプロロール・ナロキソン・フェニレフリン）加わる。
- Breathing を入れると、気道と気胸の物品が 4 種類（King LT・チェストシール・NCD キット・酸素マスク）加わる。
- 表示名は、本体と Core の物品が日本語、Circulation と Breathing の物品が英語になる（[表示名の言語](about-this-manual.md#表示名の言語)）。

### 本体と Core の物品

| 物品（ゲームの表示） | 効果 | 使える条件 | 使った後 |
|---|---|---|---|
| [止血帯](tourniquet.md)（Tourniquet。表示は「止血帯を使う」） | 巻いた腕・脚のグループの傷の出血率を 0.001 倍にする（本体の既定は 0.05 倍で、ACE が強くしている）。出血そのものは包帯で消すまで残る | 左右の腕（上腕・前腕・手）か左右の脚（太もも・すね・足）のグループに出血があり、まだ巻いていない。頭・首・胸・腹・腰には巻けない | 巻いたまま残る。外す操作はその場で外れる（動きはない）。ゴミは出ない |
| [包帯](bandage.md) | 巻いた部位のグループ全体の出血をすべて消す。出血の強さに関係なく 1 本で消える。部位の HP は戻らない | 出血している | 消費する。ゴミが出る（[ゴミ](medical-actions.md#ゴミ)） |
| [生理食塩水](saline.md) | 血液を 90 s かけて戻す。量は血液の最大量の 25%（下の表）。出血は止めない | 血液が減っている。その人にまだ袋が付いていない（1 人 1 袋） | 袋は患者の右腕に付き、90 s 後に消える。消えるときに空の袋のゴミが出る |
| [モルヒネ注射器](morphine.md) | Circulation の有無で違う（下の表） | 同左 | 消費する。注射器のゴミが出る |
| [エピネフリン](epinephrine.md)（Circulation 入りの表示は「Epinephrine」） | Circulation の有無で違う（下の表） | 同左 | 消費する。注射器のゴミが出る |
| [医療キット](medical-kit.md) | 部位の HP を 1 回 10 ずつ回復する。血液と痛みは戻らない（[医療キット](medical-kit.md)） | 本体の条件のまま（ACE は変えていない） | 消費しない。ゴミは出ない |

### Circulation の有無で効き方が変わる物品

<!-- columns: - | circulation | !circulation -->

| 物品 | Circulation を入れている場合 | Circulation なし（Core だけ）の場合 |
|---|---|---|
| [生理食塩水](saline.md) | 750 ml を 90 s（8.33 ml/s） | 1500 ml を 90 s（16.7 ml/s） |
| [モルヒネ注射器](morphine.md) | 鎮痛量を足す（痛みそのものは残る）。心拍数と血管抵抗を下げる。使う条件はなく、何本でも打てる（過量で意識喪失・心停止する） | 痛みだけを実効 2.5 HP/s × 60 s 治す（体の傷は治さない）。痛みがあり、前のモルヒネの効果が切れているときだけ使える |
| [エピネフリン](epinephrine.md) | 意識は戻さない。心拍数を最大 +25 bpm 上げ、CPR の蘇生判定の頻度を最大 1.43 倍にする。使う条件はない | 意識（resilience）を実効 4 HP/s × 30 s 戻す。意識不明・前のエピネフリンの効果が切れている・出血していない・全体の健康度 0.33 以上（`m_fMinHealthScaledForEpinephrine` の既定 0.33 のとき）のときだけ使える |

- 薬の効き方の詳細は [薬の効き方](drug-effects.md#circulation-の有無で変わる薬の扱い)、エピネフリンで起こす条件は [エピネフリンで起こす](consciousness.md#エピネフリンで起こす) を見る。

### Circulation の物品

Circulation の物品は英語で表示される。医療キットに 8 本ずつ入っている（[医療キット](medical-kit.md)）。

| 物品（表示） | 操作（部位） | 効果 | 使える条件 | 使った後 |
|---|---|---|---|---|
| [炭酸アンモニウム](ammonium-carbonate.md)（Ammonium Carbonate） | 「Hold under nose」（頭） | 患者の状態が Stable のときだけ判定する。成功すると意識を 30 HP/s（実効 24 HP/s）× 5 s 戻し、約 3.1 s で目覚める | 意識不明の相手 | 失敗しても消費する |
| [メトプロロール](metoprolol.md)（Metoprolol） | 「Inject metoprolol」（左右の腕・脚） | 心拍数を下げる（1 本のピーク −16.5 bpm、投与から約 26 s） | 条件なし | 消費する |
| [ナロキソン](naloxone.md)（Naloxone） | 「Inject naloxone」（左右の腕・脚） | 単独では効果がない。モルヒネの効果（鎮痛・心拍数・血管抵抗）を弱める | 条件なし | 消費する |
| [フェニレフリン](phenylephrine.md)（Phenylephrine） | 「Inject phenylephrine」（左右の腕・脚） | 血管抵抗を上げて血圧を上げる（1 本のピーク +47%）。出血を遅くする（1 本のピーク 0.685 倍、下限 0.45 倍）。生理食塩水の速さは変えない | 条件なし | 消費する |

### Breathing の物品

Breathing の物品は英語で表示される。初期装備には無く、補給（アーセナル）で手に入れる（実機で確認）。

| 物品（表示） | 操作（部位） | 効果 | 使える条件 | 使った後 | 補給コスト |
|---|---|---|---|---|---|
| [King LT](king-lt.md) | 「Insert King LT」（頭） | 入れたときに舌根沈下と嘔吐の両方の閉塞を解除し、以後どちらも起きなくする | 患者の King LT の枠が空いている。意識のある相手には使えない。自分には使える（実機で確認） | 患者の口元に残る（消費しない） | 5 |
| [チェストシール](chest-seal.md)（Chest Seal） | 「Use chest seal」（胸） | 気胸を完全に治す（大きさを 0 にする）。緊張性気胸は治さない | 気胸がある。自分に使うときは伏せていない | 消費する | 3 |
| [NCD キット](ncd-kit.md)（NCD Kit） | 「Perform needle decompression」（胸） | 緊張性気胸だけを治す。開放性気胸は残る | 緊張性気胸がある | 消費する | 3 |
| [酸素マスク](oxygen-mask.md)（Oxygen Mask） | 「Put oxygen mask on」（頭） | 付けている間、気道が開いていれば酸素を補う（心停止中・CPR 中も換気する） | 患者の酸素マスクの枠が空いている | 患者の口元に残る（消費しない） | 5 |

> [!NOTE]
> 公式ドキュメントとの違い: ドキュメントは Breathing の物品を King LT・チェストシール・NCD キットの 3 つとしているが、酸素マスクもあり、補給で手に入る。

## 入手

- 医療キットには、初めから医療品が入っている（[医療キット](medical-kit.md)）。
- Core のエピネフリンは補給（アーセナル）でも手に入る（補給コスト 3）。
- 本体と ACE の標準の装備・補給には、ガーゼ（包帯より短時間で巻ける本体の物品）は無い。ミッションやほかの MOD で配られたときだけ使う。

### Breathing の物品の入手

Breathing の 4 物品（King LT・チェストシール・NCD キット・酸素マスク）は、**初期装備にも医療キットにも入っていない**（ゲーム内で確認）。**補給（アーセナル）で手に入れる**。

- 表示名・操作名は日本語に翻訳されておらず、英語で表示される。
- 医療ラジアルメニュー（既定 Ctrl+H）に「Airway/Thorax management」の分類が加わり、手持ちのこの 4 物品から選んで手に持てる（[医療ラジアルメニュー](medical-actions.md#医療ラジアルメニュー)）。
- 移動しながら使える。
- 所要時間の一覧は [処置の所要時間](treatment-times.md)。
- Circulation 入りの医療キットの中身（モルヒネ注射器・Epinephrine・包帯・生理食塩水・Ammonium Carbonate・Naloxone・Phenylephrine・Metoprolol）に、Breathing の物品は含まれない（[医療キット](medical-kit.md)）。
- AI の衛生兵は、これらの物品を使わない（[使わない物品と処置](ai-medic.md#使わない物品と処置)）。

## 関連ページ

- [医療キット](medical-kit.md)
- [医療の操作](medical-actions.md)
- [処置の所要時間](treatment-times.md)
- [薬の効き方](drug-effects.md)
- [この原稿の読み方](about-this-manual.md)
