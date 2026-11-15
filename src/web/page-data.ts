// Web 版のページが、最初の表示で読むデータの部分（virtual:web-store の部分の名前）。
// ビルドは、ページごとの HTML にこの部分の先読みを入れる（vite.config.ts の webPlugin）。
// 先読みが無いと、データを取りに行くのが最初の JS を実行した後になり、表示が通信 1 往復ぶん遅れる。
// 画面が読むデータ（src/lib/tauri.web.ts）を変えたら、ここも合わせる。
// 合っていなくても表示は壊れない（足りなければ今までどおり後から読み、余れば使わないデータを読むだけ）

/**
 * @param page サイトの中のパス（先頭と末尾の `/` なし。例: `library`、`doc/vitals-system`）
 * @returns 先読みする部分の名前
 */
export function pageDataParts(page: string): string[] {
  const [screen = ""] = page.split("/");
  switch (screen) {
    case "library":
      return ["index"];
    // 原稿（doc/<id>）は先読みしない。Lighthouse（モバイル）で比べると、先読みを入れても表示は早くならず、
    // LCP が 0.1〜0.4 秒遅く出た（本文は描くのに時間がかかり、データが先に着いても、最初の JS と回線を取り合うぶんだけ損になる）
    case "quickref":
      // 行の関連リンクの表題を index の目次から引く
      return ["index", "quickref"];
    case "triage":
      // 一覧も実行も、フローをまとめた 1 つの部分を読む
      return ["flows"];
    default:
      return [];
  }
}
