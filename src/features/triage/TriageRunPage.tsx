import type { JSX } from "react";
import { useParams } from "react-router";

import { PagePlaceholder } from "@/components/PagePlaceholder";

export function TriageRunPage(): JSX.Element {
  const { id = "" } = useParams();
  return (
    <PagePlaceholder
      title="トリアージ実行"
      description={`ID「${id}」のフローを実行します（Step 07）。`}
    />
  );
}
