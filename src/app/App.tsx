import type { JSX } from "react";
import { RouterProvider } from "react-router/dom";

import { router } from "@/app/router";
import { TooltipProvider } from "@/components/ui/tooltip";

export function App(): JSX.Element {
  return (
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  );
}
