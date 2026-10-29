import { DownloadIcon } from "lucide-react";
import type { JSX } from "react";

import { usePageTitle } from "@/app/use-page-title";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AboutDetails, AboutSection } from "@/features/settings/AboutCard";
import { version } from "../../package.json";
import { DOWNLOAD_URL } from "@/web/links";

/** Web 版の「このサイトについて」。デスクトップ版の案内と、ライセンス・出典・免責。 */
export function WebAboutPage(): JSX.Element {
  usePageTitle("このサイトについて");
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">このサイトについて</h1>
      <Card>
        <CardHeader>
          <CardTitle>Field Medic Manual（Web 版）</CardTitle>
          <CardDescription>
            Arma Reforger の ACE Medical 向けの非公式マニュアル。Windows
            向けのデスクトップアプリと同じマニュアルを、ブラウザで読めるようにしたものです。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 text-sm">
          <AboutSection title="版とデスクトップ版">
            <p>
              v{version}
              のデスクトップ版と同じ内容です。マニュアルの閲覧・検索・クイック表を使えます。
            </p>
            <p>
              トリアージのフロー、お気に入りと履歴、ゲームの上に重なる小窓とホットキーは、デスクトップ版（Windows
              10 / 11）だけにあります。
            </p>
            <div>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<a href={DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" />}
              >
                <DownloadIcon />
                デスクトップ版をダウンロード（GitHub Releases）
              </Button>
            </div>
          </AboutSection>
          <AboutDetails />
        </CardContent>
      </Card>
    </section>
  );
}
