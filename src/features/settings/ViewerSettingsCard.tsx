import type { JSX } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FONT_SIZE_PX,
  LINE_HEIGHT_VALUE,
  useViewerSettings,
} from "@/features/settings/viewer-settings";
import { ViewerSettingsFields } from "@/features/settings/ViewerSettingsFields";

/** テーマと本文の文字サイズ・行間。デスクトップ版と Web 版の設定画面で共有する。 */
export function ViewerSettingsCard(): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>表示</h2>
        </CardTitle>
        <CardDescription>
          テーマと、マニュアルの本文の文字サイズ・行間。マニュアルを読んでいる画面の「表示」ボタンからも変えられます。システムを選ぶと
          OS の設定（ライト / ダーク）に合わせます。画面全体は Ctrl+＋ / Ctrl+−（または
          Ctrl+ホイール）で拡大・縮小でき、Ctrl+0 で元に戻ります。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-start gap-6">
        <ViewerSettingsFields />
        <Preview />
      </CardContent>
    </Card>
  );
}

/** 設定画面では本文が見えないので、選んだ大きさで見本を出して、変えた結果をその場で確かめられるようにする */
function Preview(): JSX.Element {
  const settings = useViewerSettings((s) => s.settings);
  return (
    // 名前を読ませるには役割が要る（役割のない div の aria-label は読まれない）
    <div
      role="group"
      aria-label="表示の見本"
      className="manual-body min-w-60 flex-1 rounded-lg border p-4"
      style={{
        fontSize: `${String(FONT_SIZE_PX[settings.fontSize])}px`,
        lineHeight: LINE_HEIGHT_VALUE[settings.lineHeight],
      }}
    >
      <p>見本: マニュアルの本文はこの大きさと行間で表示されます。</p>
      <ol>
        <li>番号付きの手順は、このように並びます。</li>
        <li>2 つ目の手順です。</li>
      </ol>
    </div>
  );
}
