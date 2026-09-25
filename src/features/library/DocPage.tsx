import type { JSX } from "react";
import { useParams } from "react-router";

import { PagePlaceholder } from "@/components/PagePlaceholder";

export function DocPage(): JSX.Element {
  const { id = "" } = useParams();
  return (
    <PagePlaceholder
      title="ドキュメント"
      description={`ID「${id}」のドキュメントを表示します（Step 04）。`}
    />
  );
}
