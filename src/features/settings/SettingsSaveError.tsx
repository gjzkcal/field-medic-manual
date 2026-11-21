import type { JSX } from "react";

import { cn } from "cn";

/** 設定を保存できなかったときの知らせ。エラーが無ければ何も出さない。 */
export function SettingsSaveError({
  error,
  className,
}: {
  error: string | null;
  className?: string;
}): JSX.Element | null {
  if (error === null) {
    return null;
  }
  return (
    <p role="alert" className={cn("text-sm text-destructive", className)}>
      設定を保存できませんでした: {error}
    </p>
  );
}
