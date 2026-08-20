"use client";

import * as React from "react";
import { Button } from "./button";

export interface ConfirmDialogHandle {
  open: () => void;
  close: () => void;
}

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

/**
 * Accessible confirmation dialog for disruptive actions (Section 18:
 * transfer, cancel, close, article archive). Uses the native <dialog>
 * element, which provides built-in focus trapping and Escape-to-close
 * without pulling in a component library dependency.
 */
export const ConfirmDialog = React.forwardRef<ConfirmDialogHandle, ConfirmDialogProps>(
  ({ title, description, confirmLabel = "Confirm", destructive, onConfirm }, ref) => {
    const dialogRef = React.useRef<HTMLDialogElement>(null);
    const [pending, setPending] = React.useState(false);

    React.useImperativeHandle(ref, () => ({
      open: () => dialogRef.current?.showModal(),
      close: () => dialogRef.current?.close(),
    }));

    return (
      <dialog
        ref={dialogRef}
        className="rounded-lg border border-border p-0 shadow-lg backdrop:bg-black/40"
        aria-labelledby="confirm-dialog-title"
      >
        <div className="w-80 max-w-full p-6">
          <h2 id="confirm-dialog-title" className="text-lg font-semibold">
            {title}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => dialogRef.current?.close()}
            >
              Cancel
            </Button>
            <Button
              variant={destructive ? "destructive" : "default"}
              type="button"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                try {
                  await onConfirm();
                  dialogRef.current?.close();
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? "Working..." : confirmLabel}
            </Button>
          </div>
        </div>
      </dialog>
    );
  },
);
ConfirmDialog.displayName = "ConfirmDialog";
