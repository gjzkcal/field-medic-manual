import type { JSX } from "react";
import { RouterProvider } from "react-router/dom";

import { router } from "@/app/router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UpdateDialog } from "@/features/updater/UpdateDialog";

export function App(): JSX.Element {
  return (
    <TooltipProvider>
      <RouterProvider router={router} />
      <UpdateDialog />
    </TooltipProvider>
  );
}
