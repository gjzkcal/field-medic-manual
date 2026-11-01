// 負傷者の画面は開くまで読み込まない（起動を遅くしないため。メイン・小窓・Web 版のルートから使う）。
import { lazy, Suspense, type JSX } from "react";

import { Skeleton } from "@/components/ui/skeleton";

const CasualtiesPage = lazy(() =>
  import("@/features/casualties/CasualtiesPage").then((m) => ({ default: m.CasualtiesPage })),
);

export function LazyCasualtiesPage({ compact = false }: { compact?: boolean }): JSX.Element {
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <CasualtiesPage compact={compact} />
    </Suspense>
  );
}
