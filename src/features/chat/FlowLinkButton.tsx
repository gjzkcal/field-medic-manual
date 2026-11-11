import { WorkflowIcon } from "lucide-react";
import type { JSX } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";

/**
 * 回答の中のフローへのリンク。押すとトリアージのフローを最初から開く。
 * フローの選択肢は利用者が自分で選ぶ（AI は押さない）ので、途中の位置は渡さない。
 */
export function FlowLinkButton({ flowId, label }: { flowId: string; label: string }): JSX.Element {
  const navigate = useNavigate();
  return (
    <Button
      variant="outline"
      size="xs"
      className="mx-0.5 align-text-bottom"
      onClick={() => {
        void navigate(`/triage/${encodeURIComponent(flowId)}`);
      }}
    >
      <WorkflowIcon data-icon="inline-start" aria-hidden />
      {label === "" ? "フローを開く" : label}
    </Button>
  );
}
