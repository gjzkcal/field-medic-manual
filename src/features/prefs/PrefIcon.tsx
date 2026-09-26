import { FileTextIcon, HashIcon, WorkflowIcon } from "lucide-react";
import type { JSX } from "react";

import type { PrefTarget } from "@/lib/bindings/PrefTarget";

export function PrefIcon({
  target,
  className,
}: {
  target: PrefTarget;
  className?: string;
}): JSX.Element {
  switch (target.kind) {
    case "section":
      return <HashIcon aria-hidden className={className} />;
    case "document":
      return <FileTextIcon aria-hidden className={className} />;
    case "flow":
      return <WorkflowIcon aria-hidden className={className} />;
  }
}
