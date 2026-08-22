"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Scale } from "lucide-react";
import { useAdjustPoints, useMembers } from "@repo/hooks";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dashboardFilterSelectClassName } from "@/components/shared/table-controls";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { getErrorMessage } from "@/lib/utils";

type MemberOption = {
  userId: string;
  label: string;
};

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

export function PointsAdjustmentDialog({
  open,
  onOpenChange,
  onAdjusted,
  onCloseAutoFocus,
}: PointsAdjustmentDialogProps) {
  // `POST /v1/points/adjust` carries no `@FreeTier`, so it is paid-ops and this
  // dialog has to mirror the subscription gate (#841). No `useGatedDialog`
  // here: `open` is owned by the points page, so the trigger — and the refusal
  // to open onto a doomed form (§5 rule 1) — has to be gated there.
  const gate = useSubscriptionGate();
  const adjustPointsMutation = useAdjustPoints();
  const membersQuery = useMembers();
  const { toast } = useToast();
  const [targetUserId, setTargetUserId] = useState("");
  const [amount, setAmount] = useState("10");
  const [category, setCategory] = useState<"MANUAL" | "FINE">("MANUAL");
  const [reason, setReason] = useState("");

  const memberOptions = useMemo(() => {
    const membersData = membersQuery.data as unknown;
    if (!Array.isArray(membersData) || membersData.length === 0) {
      return [];
    }
    return (membersData as Record<string, unknown>[])
      .map((member) => {
        const userId = String(member.user_id ?? "");
        if (!userId) return null;
        const displayName = String(member.display_name ?? userId);
        return { userId, label: `${displayName} (${userId})` };
      })
      .filter((option): option is MemberOption => option !== null);
  }, [membersQuery.data]);

  /* eslint-disable react-hooks/set-state-in-effect -- reset the adjustment draft each time the dialog opens */
  useEffect(() => {
    if (!open) return;
    setTargetUserId((previous) =>
      memberOptions.some((option) => option.userId === previous)
        ? previous
        : memberOptions[0]?.userId || "",
    );
    setAmount("10");
    setCategory("MANUAL");
    setReason("");
  }, [open, memberOptions]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const submitLabel = adjustPointsMutation.isPending
    ? "Submitting..."
    : "Submit adjustment";

  async function handleSubmit() {
    const parsedAmount = Number(amount);
    if (!targetUserId) {
      toast({
        title: "Member required",
        description: "Select a member before submitting an adjustment.",
        variant: "destructive",
      });
      return;
    }

    if (!memberOptions.some((option) => option.userId === targetUserId)) {
      toast({
        title: "Member selection expired",
        description: "Pick a current member before submitting.",
        variant: "destructive",
      });
      return;
    }

    if (!Number.isInteger(parsedAmount) || parsedAmount === 0) {
      toast({
        title: "Valid amount required",
        description: "Use a non-zero whole number for point adjustments.",
        variant: "destructive",
      });
      return;
    }

    if (reason.trim().length < 8) {
      toast({
        title: "Reason required",
        description: "Add a reason with at least 8 characters for audit clarity.",
        variant: "destructive",
      });
      return;
    }

    try {
      await adjustPointsMutation.mutateAsync({
        target_user_id: targetUserId,
        amount: parsedAmount,
        category,
        reason: reason.trim(),
      });
    } catch (error) {
      toast({
        title: "Could not adjust points",
        description: getErrorMessage(error, "Something went wrong. Please retry."),
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Points adjusted",
      description: `${parsedAmount > 0 ? "+" : ""}${parsedAmount} points applied successfully.`,
    });

    try {
      await onAdjusted();
    } catch {
      toast({
        title: "Points adjusted, but refresh failed",
        description: "Reload the page to fetch the latest balances.",
        variant: "destructive",
      });
    }

    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-4 w-4" />
            Adjust points
          </DialogTitle>
          <DialogDescription>
            Apply a manual adjustment with a required reason for audit trail integrity.
          </DialogDescription>
        </DialogHeader>

        {/*
          Disable, don't hide (§5 rule 4): the lapse is recoverable, so the form
          stays visible with the reason stated above it. Until the page gates
          its trigger a blocked chapter can still open this dialog, which makes
          the notice the only thing explaining why nothing here accepts input.
        */}
        <SubscriptionNotice gate={gate} feature="adjusting points" />

        <div className="grid gap-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Member</span>
            {/*
              The fields are gated alongside the submit, not just next to it:
              this dialog can be opened while blocked, and an editable form
              behind a dead Submit is the exact wasted-effort failure §5 names.
            */}
            <select
              value={targetUserId}
              onChange={(event) => setTargetUserId(event.target.value)}
              className={`${dashboardFilterSelectClassName} w-full`}
              {...gate.controlProps()}
            >
              {memberOptions.map((option) => (
                <option key={option.userId} value={option.userId}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Amount</span>
              <Input
                type="number"
                step={1}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="10"
                {...gate.controlProps()}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Category</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as "MANUAL" | "FINE")}
                className={`${dashboardFilterSelectClassName} w-full`}
                {...gate.controlProps()}
              >
                <option value="MANUAL">Manual adjustment</option>
                <option value="FINE">Fine</option>
              </select>
            </label>
          </div>

          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Reason (required)</span>
            <Textarea
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Explain why this adjustment is needed and what policy it references."
              {...gate.controlProps()}
            />
          </label>
        </div>

        <DialogFooter>
          {/*
            Cancel stays live regardless: it closes the dialog rather than
            writing anything, and gating the way out would trap a blocked
            member in a form they cannot submit.
          */}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            {...gate.controlProps(adjustPointsMutation.isPending)}
          >
            {adjustPointsMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
