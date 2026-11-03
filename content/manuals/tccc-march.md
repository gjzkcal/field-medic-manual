---
title: TCCC と MARCH
mod: general
channel: dev
mod_version: "1.5.36"
ace_commit: "703d1aa7"
game_version: "1.8.0.13"
verified_at: 2026-11-03
order: 600
category: 参考
---

# TCCC と MARCH

> [!NOTE]
> 現実の戦傷救護の枠組み（TCCC）を、米国防総省と米陸軍が公開している資料から紹介する。ACE Medical の仕様ではない。\
> ゲームでの手順は、トリアージのフローとクイック表にある。この原稿は、ゲームでの手順を勧めるものではない。\
> ACE Medical との対応は [acemod/ACE-Anvil](https://github.com/acemod/ACE-Anvil) のソースコードで確かめ、詳しいことは各原稿の節に書いた。

## TCCC の 3 つの段階

TCCC（Tactical Combat Casualty Care、戦術的戦傷救護）は、戦場での負傷者の救護の指針。米国防総省の Joint Trauma System（JTS）の委員会 CoTCCC が定める。救護を、脅威の強さで 3 つの段階に分ける。

| 段階 | 場面 | 指針の主な内容 | ACE Medical で当たる操作 |
|---|---|---|---|
| Care Under Fire/Threat（CUF/T） | 撃たれている・脅威が続いている | 反撃して遮蔽に入る。負傷者は、戦えるなら戦い続け、動けるなら自分で遮蔽へ移って自分で手当てする。動けなければ遮蔽へ引きずる。命に関わる手足の出血は止血帯（Tourniquet）で止め、出血の場所が分からなければ手足のできるだけ上に服の上から巻く。気道の処置は次の段階に回す | [負傷者を運ぶ](medical-actions.md#負傷者を運ぶ)（Drag・Carry）、[止血帯](tourniquet.md) |
| Tactical Field Care（TFC） | 差し迫った脅威が去った後 | 周りの警戒を固め、負傷者を区分し、[MARCH](#march) と [PAWS](#paws) の項目を順に処置する | 下の MARCH と PAWS の表 |
| Tactical Evacuation Care（TACEVAC） | 車両・航空機での後送 | 後送の要員に負傷者の状態を伝え、乗せて固定し、TFC の処置を続ける | 運んだまま車両のドアで「載せる（Load carried）」（[負傷者を運ぶ](medical-actions.md#負傷者を運ぶ)） |

- 指針の TFC の項目は、警戒 → 区分 → 大出血 → 気道 → 呼吸 → 循環 → 低体温の予防 → 頭部外傷 → 目の穿通外傷 → 観察 → 鎮痛 → 抗菌薬 → 傷 → ほかの傷の確認 → 熱傷 → 副子固定 → CPR → 伝達 → 記録 → 後送の準備の順に並ぶ。
- 指針の TACEVAC では、「Tactical Evacuation」は CASEVAC と MEDEVAC の両方を指す。

### CASEVAC と MEDEVAC

米陸軍の教範 ATP 4-02.2 は、2 つを次のように分ける。

| 項目 | MEDEVAC（Medical Evacuation） | CASEVAC（Casualty Evacuation） |
|---|---|---|
| 乗り物 | 後送のための、医療の設備を持つ車両・航空機 | 医療用でない車両・航空機 |
| 途中の処置 | 訓練を受けた医療の要員が行う | 無い |

- 教範は、MEDEVAC が使えるならそちらで運び、CASEVAC は MEDEVAC が足りないときの軽い負傷者に限るとする。
- 負傷者の集合点（Casualty Collection Point、CCP）は、負傷者を集めて医療施設へ後送するための地点。人を置かないこともある。前進の軸や後送の経路の上に、あらかじめ決めておく。
- ACE Medical に後送を扱う仕組みは無い。

## MARCH

MARCH は、TFC で処置する項目の頭文字。JTS の Combat Lifesaver（CLS）課程は、MARCH PAWS の順で負傷者を評価して処置し、まず出血を止めることに重点を置くと教える。

| 文字 | 意味 | 指針の主な内容 | ACE Medical で当たるもの |
|---|---|---|---|
| M | Massive Bleeding（大出血） | 見落とした出血を探し、すべて止める。手足は止血帯（止まらなければ 2 本目を並べて巻く）、止血帯を巻けない場所は止血剤のガーゼを押し当てる | [止血帯](tourniquet.md)（腕・脚だけ）、[包帯](bandage.md)。首には止血帯を巻けない（[首と大腿動脈の大出血](hemorrhage.md#首と大腿動脈の大出血)） |
| A | Airway（気道） | 気道を開いて保つ（体位・手技・器具） | [あご先挙上](airway.md#あご先挙上)（Lift chin）、[嘔吐物の除去](airway.md#嘔吐物の除去)（Clear vomit）、[回復体位](airway.md#回復体位)、[King LT](king-lt.md) |
| R | Respiration（呼吸） | 緊張性気胸を疑ったら、針で胸の圧を抜く。開いた胸の傷はチェストシールで覆い、その後も緊張性気胸にならないかを見る | [チェストシール](chest-seal.md)（開放性気胸を治す）、[NCD キット](ncd-kit.md)（緊張性気胸を解除する）、[酸素マスク](oxygen-mask.md) |
| C | Circulation（循環） | 巻いた止血帯を見直し、出血によるショックを見分け、要れば輸液・輸血をする | [生理食塩水](saline.md)、脈と血圧の確認（[バイタルを確かめる操作](vitals.md#バイタルを確かめる操作)）。輸血の物品は無い |
| H | Hypothermia/Head（低体温・頭部外傷） | 体の熱が逃げるのを早くから防ぐ。中等度以上の頭部外傷を見分け、悪化を防いで早く後送する | 体温を扱う処理は無い。頭部外傷だけを扱う処置も無い。Hitzones を入れると頭は急所になる（[Hitzones の急所と心臓](death-second-chance.md#hitzones-の急所と心臓)） |

- 気道・呼吸の物品（King LT・チェストシール・NCD キット・酸素マスク）は Breathing の、脈と血圧の確認は Circulation の MOD にある（[物品の一覧](items.md)）。

## PAWS

PAWS は、MARCH の後に続く項目の頭文字。

| 文字 | 意味 | 指針の主な内容 | ACE Medical で当たるもの |
|---|---|---|---|
| P | Pain（痛み） | 痛みを無くすのではなく、気道・呼吸・意識を保てる程度まで抑える | [モルヒネ注射器](morphine.md)（[痛みと抑え方](pain.md)）。モルヒネの効果を弱める [ナロキソン](naloxone.md) |
| A | Antibiotics（抗菌薬） | 開いた戦傷のすべてに抗菌薬を使う | 傷の感染を扱う処理は無い |
| W | Wounds（傷） | 分かっている傷を確かめて覆い、見落とした傷を探す | [診察する](medical-actions.md#診察する)、[包帯](bandage.md)、[医療キット](medical-kit.md)（部位の HP を治す） |
| S | Splint（副子固定） | 骨折を固定し、脈を確かめ直す | 診察画面に腕・脚の骨折が出る（[診察画面の表示](vitals.md#診察画面の表示)）。医療ラジアルメニューの「骨折の治療」には [医療キット](medical-kit.md) が出る |

## CPR の扱い

指針は、CPR を MARCH PAWS の外の TFC の項目として扱う。

- TFC: 爆発や貫通する傷で、脈・呼吸・ほかの生きている兆しが無い負傷者は、戦場で蘇生を試みても成功しないので行わない。ただし胴体の傷で脈・呼吸が無いときは、手当てをやめる前に両側の胸の圧を針で抜き、緊張性気胸でないことを確かめる。
- TACEVAC: 明らかに助からない傷が無く、短い時間で外科の施設に着くなら、CPR を試みてよい。任務や、ほかの負傷者の救命を損なってまで行わない。
- ACE Medical では、心停止は CPR を続けると確率で蘇生する（[CPR を行う](cardiac-arrest.md#cpr-を行う)）。

## トリアージの区分

指針の付録（Supplement A – Triage in TCCC）は、負傷者を 2 回に分けて区分する。

| 回 | 区分 | 意味 |
|---|---|---|
| 1 回目 | Urgent | 今まさに命を落としかけていて、すぐの救命の処置が要る |
| 1 回目 | Nonurgent | すぐの救命の処置は要らないが、手当ては要る |
| 2 回目 | Urgent | 命に関わる重い傷で、すぐの手術・蘇生・高度な処置でしか助からない |
| 2 回目 | Priority | 重い傷で、後で手術・高度な処置が要る。手足・視力を脅かす傷を含む |
| 2 回目 | Routine | 軽い傷で、手当ては要る。救命の処置を最小限にする負傷者（Expectant）もここに入る |

- 区分は、どの段階でも見直して伝え続ける。
- ACE Medical に、負傷者に区分の印を付ける仕組みは無い。診察で見える情報は [診察画面の表示](vitals.md#診察画面の表示)。

## 引き継ぎと記録

### MIST

負傷者の状態を伝える・書くときの項目の頭文字。

| 文字 | 意味 |
|---|---|
| M | Mechanism of injury（傷を負った原因） |
| I | Injuries（傷） |
| S | Signs & Symptoms（徴候と症状） |
| T | Treatments（行った処置） |

- ATP 4-02.2 では、MIST は後送の要請（[9-Line MEDEVAC](#9-line-medevac)）の後に、追加の情報として送る。MIST を待って後送を遅らせない。
- 指針の TACEVAC では、引き継ぐときに最低限、安定か不安定か・見つけた傷・行った処置を伝える。

### TCCC Casualty Card（DD Form 1380）

負傷した場所で行った処置を MIST の形で書く、国防総省のカード。医療の要員でない人も含め、処置をした人が書き、負傷者に見えるように付けて次の救護へ渡す。

| 書く項目 | 内容 |
|---|---|
| 後送の優先度 | Urgent / Priority / Routine |
| 傷を負った原因 | 銃弾・手榴弾・砲撃・地雷・即席爆発装置・落下・熱傷など |
| 傷の場所 | 人の図に印を付ける |
| 止血帯 | 腕・脚ごとに、種類と巻いた時刻 |
| 徴候 | 脈・血圧・呼吸数・SpO2、意識（AVPU）、痛み（0〜10）を時刻と一緒に |
| 処置（裏面） | 止血・気道・呼吸・輸液・輸血・薬（名前・量・経路・時刻）・そのほか |

- AVPU は意識の段階で、Alert（目覚めている）・Verbal（声に反応する）・Pain（痛みに反応する）・Unresponsive（反応しない）。
- ACE Medical の [投薬記録](vitals.md#投薬記録) は、注射と炭酸アンモニウムの最新 8 件をゲーム内の時刻と一緒に残す。カードの薬の欄に当たる。
- このアプリの「負傷者」の画面は、負傷者ごとに薬を打った時刻を残す。

## 9-Line MEDEVAC

後送を頼むときの決まった書式。ATP 4-02.2 の付録 C にあり、航空機でも陸の車両でも同じ形を使う。

| 行 | 内容（戦時） |
|---|---|
| 1 | 収容地点の位置（グリッド座標） |
| 2 | 収容地点の無線の周波数・コールサイン |
| 3 | 優先度ごとの人数（A URGENT ／ B URGENT-SURG ／ C PRIORITY ／ D ROUTINE ／ E CONVENIENCE） |
| 4 | 要る特別な装備（A なし ／ B ホイスト ／ C 救出の器材 ／ D 人工呼吸器） |
| 5 | 種類ごとの人数（L 担架 ／ A 歩ける） |
| 6 | 収容地点の安全（N 敵はいない ／ P 敵がいるかもしれない ／ E 敵がいる ／ X 敵がいて護衛が要る） |
| 7 | 収容地点の目印（A パネル ／ B 信号弾 ／ C 発煙 ／ D なし ／ E そのほか） |
| 8 | 負傷者の国籍と身分（A 米軍 ／ B 米国民 ／ C 米国以外の軍 ／ D 米国以外の民間人 ／ E 敵の捕虜） |
| 9 | 化学・生物・放射性物質・核の汚染（あるときだけ） |

- 平時は、6 行目が傷・病気の数と種類に、9 行目が地形の説明に替わる。
- 3 行目の優先度の目安は、URGENT が 1 時間以内（命・手足・視力を救うため）、URGENT-SURG が 1 時間以内で前方での外科の処置が要るもの、PRIORITY が 4 時間以内、ROUTINE が 24 時間以内、CONVENIENCE が医療の車両で運ぶのが便宜のためだけのもの。
- ACE Medical に後送を頼む仕組みは無い。

## 関連ページ

- [出血と止血](hemorrhage.md)
- [気道閉塞と気道の確保](airway.md)
- [気胸と処置](breathing.md)
- [心停止と CPR](cardiac-arrest.md)
- [痛みと抑え方](pain.md)
- [致命傷と Second Chance](death-second-chance.md)
- [止血帯](tourniquet.md)
- [包帯](bandage.md)
- [生理食塩水](saline.md)
- [医療キット](medical-kit.md)
- [モルヒネ注射器](morphine.md)
- [ナロキソン](naloxone.md)
- [King LT](king-lt.md)
- [チェストシール](chest-seal.md)
- [NCD キット](ncd-kit.md)
- [酸素マスク](oxygen-mask.md)
- [医療の操作](medical-actions.md)
- [診察とバイタルの確かめ方](vitals.md)
- [物品の一覧](items.md)
- [このマニュアルの読み方](about-this-manual.md)

## 出典

- [CoTCCC「Tactical Combat Casualty Care (TCCC) Guidelines」（2026-05-01）](https://books.allogy.com/web/tenant/8/books/b729b76a-1a34-4bf7-b76b-66bb2072b2a7/)（2026-11-03 に確認）
- [CoTCCC「Supplement A (Triage in TCCC) to TCCC Guidelines」（2026 年版の指針の付録。資料に日付の記載なし）](https://books.allogy.com/web/tenant/8/books/d13ceb92-85df-4511-a871-5f037bd82b85/)（2026-11-03 に確認）
- [Joint Trauma System「Combat Lifesaver (CLS) Tactical Combat Casualty Care Course Plan」（TCCC-CLS-09-01、2025-02-10）](https://learning-media.allogy.com/api/v1/pdf/6e366cd9-8a4a-4fc4-940c-1c41c1027e68/contents)（2026-11-03 に確認）
- [Headquarters, Department of the Army「ATP 4-02.2 Medical Evacuation」（2019-07-12）](https://armypubs.army.mil/epubs/DR_pubs/DR_a/pdf/web/ARN17834_ATP%204-02x2%20FINAL%20WEB.pdf)（2026-11-03 に確認）
- [Joint Trauma System「INSTRUCTIONS: DD Form 1380, Tactical Combat Casualty Care (TCCC) Card」（2025-07）](https://jts.health.mil/assets/docs/forms/DD_form_1380_TCCC_Card_Instructions.pdf)（2026-11-03 に確認）
