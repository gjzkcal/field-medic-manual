import type { JSX } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SyncIssue } from "@/features/content/sync";

interface IssueCardProps {
  title: string;
  detail: string;
  issues: readonly SyncIssue[];
}

/** 起動時の同期や読み込みの失敗を、どの原稿の何が問題かと一緒に出す（ライブラリとトリアージの一覧で共通）。 */
export function IssueCard({ title, detail, issues }: IssueCardProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-destructive">{title}</CardTitle>
        {detail !== "" && <CardDescription>{detail}</CardDescription>}
      </CardHeader>
      {issues.length > 0 && (
        <CardContent>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {issues.map((issue) => (
              <li key={`${issue.fileName}:${issue.message}`}>
                {issue.fileName}: {issue.message}
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
