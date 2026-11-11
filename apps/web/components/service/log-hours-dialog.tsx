"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import { LogHoursForm } from "./log-hours-form";

type LogHoursDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every service-entry write is paid-ops (#841); the host owns the gate. */
  gate: SubscriptionGate;
  /** Rendered as the dialog's trigger (the Service page's Log service button). */
  trigger?: ReactNode;
  /** `useGatedDialog`'s `contentProps.onCloseAutoFocus`, when the host has one. */
  onCloseAutoFocus?: (event: Event) => void;
};

/**
 * The Service page's Log service hours dialog. The form is `LogHoursForm`,
 * which the chat composer's + card hosts too (#3983); this only draws the
 * dialog around it. The form unmounts with the dialog, so each open starts
 * fresh and a picked proof file never carries into the next entry.
 */
export function LogHoursDialog({
  open,
  onOpenChange,
  gate,
  trigger,
  onCloseAutoFocus,
}: LogHoursDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>Log service hours</DialogTitle>
          <DialogDescription>
            An admin approves it before points are awarded.
          </DialogDescription>
        </DialogHeader>
        {/* No notice of its own: the Service page shows the gate's. */}
        <LogHoursForm
          layout="dialog"
          gate={gate}
          onDone={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
