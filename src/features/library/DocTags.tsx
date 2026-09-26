import type { JSX } from "react";

import { Badge } from "@/components/ui/badge";

/** ドキュメントのタグ。ライブラリの一覧とビューアのタイトルの下で同じ見た目にする。 */
export function DocTags({ tags }: { tags: readonly string[] }): JSX.Element | null {
  if (tags.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="ghost" className="text-muted-foreground">
          #{tag}
        </Badge>
      ))}
    </div>
  );
}
