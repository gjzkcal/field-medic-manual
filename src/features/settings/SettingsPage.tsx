import type { JSX } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DebugPanel } from "@/features/settings/debug/DebugPanel";
import {
  FONT_SIZE_PX,
  LINE_HEIGHT_VALUE,
  useViewerSettings,
} from "@/features/settings/viewer-settings";
import { ViewerSettingsFields } from "@/features/settings/ViewerSettingsFields";

export function SettingsPage(): JSX.Element {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">設定</h1>
      <Card>
        <CardHeader>
          <CardTitle>マニュアルの表示</CardTitle>
          <CardDescription>
            本文の文字サイズと行間。マニュアルを読んでいる画面の「表示」ボタンからも変えられます。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-start gap-6">
          <ViewerSettingsFields />
          <Preview />
        </CardContent>
      </Card>
      {/* 配布版に開発用の操作を出さないため、開発ビルドだけで表示する */}
      {import.meta.env.DEV && <DebugPanel />}
    </section>
  );
}

/** 設定画面では本文が見えないので、選んだ大きさで見本を出して、変えた結果をその場で確かめられるようにする */
function Preview(): JSX.Element {
  const settings = useViewerSettings((s) => s.settings);
  return (
    <div
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
