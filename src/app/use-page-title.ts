import { useEffect } from "react";

import { pageTitle } from "@/app/page-title";

/** 画面ごとに document.title を変える。null は読み込み中など、まだ名前が決まらないとき（アプリの名前だけ） */
export function usePageTitle(page: string | null): void {
  useEffect(() => {
    document.title = pageTitle(page);
  }, [page]);
}
