import { useEffect, type JSX } from "react";
import { useRouteError } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { logClientError } from "@/lib/client-error-log";

/**
 * 画面の描画に失敗したときの受け皿。
 * React Router の既定の画面は配布版でもスタックを出すので、内部の文面は画面に出さず、ログにだけ残す。
 */
export function RouteErrorPage(): JSX.Element {
  const error = useRouteError();

  useEffect(() => {
    logClientError("画面の描画に失敗", error);
  }, [error]);

  return (
    <div className="flex justify-center p-6">
      <Card role="alert" className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-destructive">
            <h2>画面を表示できませんでした</h2>
          </CardTitle>
          <CardDescription>
            ほかの画面に移るか、読み込み直してください。データは失われていません。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => {
              window.location.reload();
            }}
          >
            読み込み直す
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
