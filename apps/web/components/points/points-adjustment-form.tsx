"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAdjustPoints, useMembers, useViewerUserId } from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import {
  POINTS_ADJUSTMENT_MAX,
  POINTS_REASON_MAX_LENGTH,
} from "@repo/validation";
import type {
  DispatchResult,
  PointsAdjustmentInput,
} from "@repo/chat-core/dispatch";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import {
  FieldError,
  FormFooter,
  fieldClass,
  primarySize,
  useReportDraft,
  type FormLayout,
} from "@/components/shared/short-form";
import { getErrorMessage } from "@/lib/utils";

/** The shortest reason the form takes, for the audit trail. */
const REASON_MIN_LENGTH = 8;

/** Everything the form holds, kept by the + card while it is closed. */
export interface PointsDraft {
  targetUserId: string;
  amount: string;
  category: "MANUAL" | "FINE";
  reason: string;
}

function emptyPointsDraft(): PointsDraft {
  return { targetUserId: "", amount: "10", category: "MANUAL", reason: "" };
}

type MemberOption = { userId: string; label: string };

/**
 * The members an officer can adjust, by name. Their own row is left out: the
 * API refuses an officer's own points (`PointsService`), so offering it only
 * set up a refusal after submit. Two members who share a name are told apart
 * by their email, never by a user id (#3983).
 */
function pointsMemberOptions(
  members: readonly {
    user_id?: unknown;
    display_name?: unknown;
    email?: unknown;
  }[],
  viewerId: string | null,
): MemberOption[] {
  const rows = members
    .map((member) => {
      const userId = typeof member.user_id === "string" ? member.user_id : "";
      if (!userId || userId === viewerId) return null;
      return {
        userId,
        name: memberLabel(member.display_name, userId),
        email: typeof member.email === "string" ? member.email : null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const seen = new Map<string, number>();
  for (const row of rows) seen.set(row.name, (seen.get(row.name) ?? 0) + 1);
  return rows
    .map((row) => ({
      userId: row.userId,
      label:
        (seen.get(row.name) ?? 0) > 1 && row.email
          ? `${row.name} (${row.email})`
          : row.name,
    }))
    .sort((first, second) => first.label.localeCompare(second.label));
}

type Problems = { member?: string; amount?: string; reason?: string };

export interface PointsAdjustmentFormProps {
  layout: FormLayout;
  /**
   * The chat composer's + card (#3865, #3983): adjust through chat, so the
   * points card lands in the channel the form was opened in, as `/points`
   * does, with its placeholder and unconfirmed-retry row. `{ ok: false }`
   * keeps the form open; anything else is done, and the host reports a
   * warning. Without it the form writes through `useAdjustPoints`, with no
   * card.
   */
  submitToChannel?: (input: PointsAdjustmentInput) => Promise<DispatchResult>;
  /** The Points page's refresh after a write with no card. */
  onAdjusted?: () => Promise<void> | void;
  initialDraft?: PointsDraft;
  onDraftChange?: (draft: PointsDraft) => void;
  onDone: () => void;
  /** Cancel in the dialog, Discard draft in the card. */
  onCancel: () => void;
}

/**
 * Adjust a member's points: member, amount, category and reason. One body for
 * the Points page's dialog and the chat composer's + card. A missing or
 * invalid field is outlined, named under it and focused on submit, as the
 * Task form does; only a write the server refuses toasts.
 */
export function PointsAdjustmentForm({
  layout,
  submitToChannel,
  onAdjusted,
  initialDraft,
  onDraftChange,
  onDone,
  onCancel,
}: PointsAdjustmentFormProps) {
  const field = fieldClass(layout);
  const ids = useId();
  // `POST /v1/points/adjust` carries no `@FreeTier`, so it is paid-ops and
  // this form mirrors the subscription gate (#841).
  const gate = useSubscriptionGate();
  const adjustPointsMutation = useAdjustPoints();
  const membersQuery = useMembers();
  const viewerId = useViewerUserId();
  const { toast } = useToast();
  const [draft, setDraft] = useState<PointsDraft>(
    () => initialDraft ?? emptyPointsDraft(),
  );
  useReportDraft(draft, onDraftChange);
  const edit = (patch: Partial<PointsDraft>) =>
    setDraft((previous) => ({ ...previous, ...patch }));
  const [problems, setProblems] = useState<Problems>({});
  const clear = (key: keyof Problems) =>
    setProblems((previous) =>
      previous[key] ? { ...previous, [key]: undefined } : previous,
    );
  const [postingToChannel, setPostingToChannel] = useState(false);
  const submitting = adjustPointsMutation.isPending || postingToChannel;
  const memberRef = useRef<HTMLButtonElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const memberOptions = useMemo(
    () => pointsMemberOptions(membersQuery.data ?? [], viewerId),
    [membersQuery.data, viewerId],
  );

  // Opening starts a new adjustment, so it drops the idempotency key the
  // hook held for the last one (#1906). Resubmitting from a still-open form
  // after a failure reuses that key and replays; reopening and re-entering
  // the same grant is a new one, as re-typing `/points` is.
  const { reset: resetAdjustment } = adjustPointsMutation;
  useEffect(() => {
    resetAdjustment();
  }, [resetAdjustment]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const amount = Number(draft.amount);
    const reason = draft.reason.trim();
    const next: Problems = {
      member: !draft.targetUserId
        ? "Pick a member."
        : !memberOptions.some((option) => option.userId === draft.targetUserId)
          ? "That member isn't in the chapter any more. Pick another."
          : undefined,
      // `AdjustPointsDto`'s bounds, checked here so a refusal names the
      // field: through chat a 4xx comes back as one generic "nothing was
      // recorded".
      amount:
        draft.amount.trim() === "" || !Number.isInteger(amount) || amount === 0
          ? "Use a whole number other than 0, like 10 or -5."
          : Math.abs(amount) > POINTS_ADJUSTMENT_MAX
            ? `Adjust by at most ${POINTS_ADJUSTMENT_MAX.toLocaleString()} points at a time.`
            : undefined,
      reason:
        reason.length < REASON_MIN_LENGTH
          ? `Give a reason of at least ${REASON_MIN_LENGTH} characters, for the ledger.`
          : undefined,
    };
    setProblems(next);
    if (next.member) return memberRef.current?.focus();
    if (next.amount) return amountRef.current?.focus();
    if (next.reason) return reasonRef.current?.focus();

    const input: PointsAdjustmentInput = {
      target_user_id: draft.targetUserId,
      amount,
      category: draft.category,
      reason,
    };

    if (submitToChannel) {
      setPostingToChannel(true);
      try {
        const result = await submitToChannel(input);
        if (!result.ok) {
          toast({
            title: "Could not adjust points",
            description: result.error ?? "Something went wrong. Please retry.",
            variant: "destructive",
          });
          return;
        }
      } finally {
        setPostingToChannel(false);
      }
      onDone();
      return;
    }

    try {
      await adjustPointsMutation.mutateAsync(input);
    } catch (error) {
      toast({
        title: "Could not adjust points",
        description: getErrorMessage(
          error,
          "Something went wrong. Please retry.",
        ),
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Points adjusted",
      description: `${amount > 0 ? "+" : ""}${amount} points applied successfully.`,
    });

    try {
      await onAdjusted?.();
    } catch {
      toast({
        title: "Points adjusted, but refresh failed",
        description: "Reload the page to fetch the latest balances.",
        variant: "destructive",
      });
    }

    onDone();
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="grid gap-3" noValidate>
      {/*
        Disable, don't hide (§5 rule 4): the lapse is recoverable, so the form
        stays visible with the reason stated above it.
      */}
      <SubscriptionNotice gate={gate} feature="adjusting points" />

      <div className="grid gap-1">
        <Label htmlFor={`${ids}-member`}>Member</Label>
        {/*
          The fields are gated alongside the submit, not just next to it: an
          editable form behind a dead Submit is the wasted-effort failure §5
          names.
        */}
        <Select
          value={draft.targetUserId}
          onValueChange={(value) => {
            edit({ targetUserId: value });
            clear("member");
          }}
        >
          <SelectTrigger
            ref={memberRef}
            id={`${ids}-member`}
            data-plus-autofocus
            className={field}
            aria-invalid={problems.member ? true : undefined}
            {...gate.controlProps()}
          >
            <SelectValue placeholder="Pick a member" />
          </SelectTrigger>
          <SelectContent>
            {memberOptions.map((option) => (
              <SelectItem key={option.userId} value={option.userId}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {problems.member ? <FieldError>{problems.member}</FieldError> : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid min-w-0 grid-cols-1 content-start gap-1">
          <Label htmlFor={`${ids}-amount`}>Amount</Label>
          <Input
            ref={amountRef}
            id={`${ids}-amount`}
            type="number"
            step={1}
            className={field}
            value={draft.amount}
            aria-invalid={problems.amount ? true : undefined}
            onChange={(event) => {
              edit({ amount: event.target.value });
              clear("amount");
            }}
            placeholder="10"
            {...gate.controlProps()}
          />
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-1">
          <Label htmlFor={`${ids}-category`}>Category</Label>
          <Select
            value={draft.category}
            onValueChange={(value) =>
              edit({ category: value as PointsDraft["category"] })
            }
          >
            <SelectTrigger
              id={`${ids}-category`}
              className={field}
              {...gate.controlProps()}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MANUAL">Adjustment</SelectItem>
              <SelectItem value="FINE">Fine</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {problems.amount ? (
          <div className="col-span-2">
            <FieldError>{problems.amount}</FieldError>
          </div>
        ) : null}
      </div>

      <div className="grid gap-1">
        <Label htmlFor={`${ids}-reason`}>Reason</Label>
        <Textarea
          ref={reasonRef}
          id={`${ids}-reason`}
          rows={layout === "card" ? 2 : 4}
          value={draft.reason}
          aria-invalid={problems.reason ? true : undefined}
          onChange={(event) => {
            edit({ reason: event.target.value });
            clear("reason");
          }}
          placeholder="Why, and which rule it follows."
          maxLength={POINTS_REASON_MAX_LENGTH}
          {...gate.controlProps()}
        />
        {problems.reason ? <FieldError>{problems.reason}</FieldError> : null}
      </div>

      {/*
        Cancel stays live regardless: it writes nothing, and gating the way
        out would trap a blocked member in a form they cannot submit.
      */}
      <FormFooter layout={layout} onCancel={onCancel}>
        <Button
          type="submit"
          size={primarySize(layout)}
          {...gate.controlProps(submitting)}
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {submitting ? "Submitting..." : "Submit adjustment"}
        </Button>
      </FormFooter>
    </form>
  );
}
