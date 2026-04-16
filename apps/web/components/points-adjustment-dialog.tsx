"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Scale, WandSparkles } from "lucide-react";
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

type MemberOption = {
  userId: string;
  label: string;
};

type PointsAdjustmentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  usingPreviewData: boolean;
  onAdjusted: () => Promise<void> | void;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Something went wrong. Please retry.";
}

export function PointsAdjustmentDialog({
  open,
  onOpenChange,
  usingPreviewData,
  onAdjusted,
}: PointsAdjustmentDialogProps) {
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

  const submitLabel = adjustPointsMutation.isPending
    ? "Submitting..."
    : usingPreviewData
      ? "Simulate adjustment"
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

    if (usingPreviewData) {
      toast({
        title: "Live points adjustment unavailable",
        description:
          "Complete chapter auth/bootstrap and reload live member data before adjusting points.",
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
        description: getErrorMessage(error),
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-4 w-4" />
            Adjust points
          </DialogTitle>
          <DialogDescription>
            Apply a manual adjustment with a required reason for audit trail integrity.
          </DialogDescription>
        </DialogHeader>

        {usingPreviewData ? (
          <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Preview mode is active. Submissions are simulated to validate copy and form behavior.
            </div>
          </div>
        ) : null}

        <div className="grid gap-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Member</span>
            <select
              value={targetUserId}
              onChange={(event) => setTargetUserId(event.target.value)}
              className={dashboardFilterSelectClassName}
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
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Category</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as "MANUAL" | "FINE")}
                className={dashboardFilterSelectClassName}
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
            />
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={adjustPointsMutation.isPending}>
            {adjustPointsMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <WandSparkles className="h-4 w-4" />
            )}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
