import type { JSX } from "react";
import { RouterProvider } from "react-router/dom";

import { TooltipProvider } from "@/components/ui/tooltip";
import { webRouter } from "@/web/router";

export function WebApp(): JSX.Element {
  return (
    <TooltipProvider>
      <RouterProvider router={webRouter} />
    </TooltipProvider>
  );
}
