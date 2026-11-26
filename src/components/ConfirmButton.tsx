import { Trash2Icon } from "lucide-react";
import { useState, type JSX } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmButtonProps {
  title: string;
  description: string;
  confirmLabel: string;
  triggerLabel: string;
  disabled?: boolean;
  onConfirm: () => void;
}

/** 消す操作は押し間違えると戻せないので、確かめてから行う */
export function ConfirmButton({
  title,
  description,
  confirmLabel,
  triggerLabel,
  disabled = false,
  onConfirm,
}: ConfirmButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
        }}
      >
        <Trash2Icon />
        {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>キャンセル</DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                onConfirm();
                setOpen(false);
              }}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
