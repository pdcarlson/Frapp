"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PointsAdjustmentForm } from "./points-adjustment-form";

type PointsAdjustmentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdjusted: () => Promise<void> | void;
  /**
   * Forwarded to the underlying `DialogContent`. `useGatedDialog` splits its
   * contract across `dialogProps` and `contentProps`, and a parent that owns
   * `open` while this component owns the content cannot reach the second half
   * on its own — so the revoke-path focus redirect would silently degrade to
   * Radix's default, which refocuses a trigger that just went `disabled` and
   * therefore drops focus to `<body>`. Pass `contentProps.onCloseAutoFocus`.
   */
  onCloseAutoFocus?: (event: Event) => void;
};

/**
 * The Points page's Adjust points dialog. The form is `PointsAdjustmentForm`,
 * which the chat composer's + card hosts too (#3983); this only draws the
 * dialog around it. The form unmounts with the dialog, so each open starts a
 * new adjustment with a fresh idempotency key.
 */
export function PointsAdjustmentDialog({
  open,
  onOpenChange,
  onAdjusted,
  onCloseAutoFocus,
}: PointsAdjustmentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        No description: the one it had restated what the required Reason field
        already says. `aria-describedby={undefined}` tells Radix the omission is
        deliberate, so it does not warn about a missing `Description`.
      */}
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={onCloseAutoFocus}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>Adjust points</DialogTitle>
        </DialogHeader>
        <PointsAdjustmentForm
          layout="dialog"
          onAdjusted={onAdjusted}
          onDone={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
