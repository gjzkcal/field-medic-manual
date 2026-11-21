import { FolderOpenIcon } from "lucide-react";
import { useState, type JSX } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BackupSection } from "@/features/settings/BackupSection";
import { SettingsSection } from "@/features/settings/SettingsSection";
import { dataFolderOpen, errorMessage } from "@/lib/tauri";

/** このアプリが PC に保存しているデータの扱い。 */
export function DataSettingsCard(): JSX.Element {
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>データ</h2>
        </CardTitle>
        <CardDescription>
          お気に入り・履歴・設定は、この PC
          の中のフォルダに保存しています。マニュアルの本文はアプリに同梱しているので、フォルダを消しても次の起動で作り直されます。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <BackupSection />
        <SettingsSection title="保存場所">
          <p className="text-sm text-muted-foreground">
            自動のバックアップは、この中の backups フォルダにあります。
          </p>
          <div className="flex flex-col items-start gap-3 pt-1">
            <Button
              variant="outline"
              onClick={() => {
                setError(null);
                dataFolderOpen().catch((cause: unknown) => {
                  setError(errorMessage(cause));
                });
              }}
            >
              <FolderOpenIcon />
              保存場所を開く
            </Button>
            {error !== null && (
              <p role="alert" className="text-sm text-destructive">
                保存場所を開けませんでした: {error}
              </p>
            )}
          </div>
        </SettingsSection>
      </CardContent>
    </Card>
  );
}
