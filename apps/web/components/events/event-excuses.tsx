"use client";

import { useId, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import {
  errorCopy,
  canDecideExcuse,
  excuseSummaryLine,
  myExcuseView,
  sortExcusesForReview,
  useDecideEventExcuse,
  useEventExcuses,
  useMyAttendance,
  useMyEventExcuse,
  useNow,
  useSendEventExcuse,
  useWithdrawEventExcuse,
  type EventExcuseStatus,
  type EventExcuseWithMember,
} from "@repo/hooks";
import { EVENT_EXCUSE_REASON_MAX, statusLabel } from "@repo/validation";
import { Badge, type BadgeKind } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/lib/hooks/use-toast";

/**
 * Absence excuses on the event sheet (`spec/behavior/events.md` § Excuses,
 * #3735), mobile's `components/events/event-excuses.tsx` read for web. The
 * member's block ({@link MyExcuse}) and the receiver's list
 * ({@link ExcuseReview}) follow `myExcuseView` in `@repo/hooks`, the rule
 * both surfaces read. Calendar apps put "can't go, with a note" on the event
 * (Google Calendar's Decline with a note, Outlook's Decline with a message);
 * the receiver's Approve and Decline read as a leave request does in Slack's
 * or Teams' approvals.
 *
 * The writes carry no `@FreeTier`, so they are paid-ops behind the
 * subscription gate, as Check in is.
 */

/**
 * An excuse status's badge: the shared word (`statusLabel`), in the status
 * kind this design system paints it. A status a newer API adds reads as
 * quiet metadata, as the other status mappers here do.
 */
function excuseBadge(status: string): { label: string; variant: BadgeKind } {
  const label = statusLabel("eventExcuse", status);
  switch (status as EventExcuseStatus) {
    case "PENDING":
      return { label, variant: "warning" };
    case "APPROVED":
      return { label, variant: "success" };
    case "DECLINED":
      return { label, variant: "destructive" };
    default:
      return { label, variant: "outline" };
  }
}

const COPY_OPTIONS = { serverWritesForMembers: true } as const;

export function MyExcuse({
  eventId,
  required,
  start,
  end,
  opensMinutes,
  startWriting = false,
}: {
  eventId: string;
  /** Whether the event requires the viewer (`useRequiredOfViewer`). */
  required: boolean;
  start: unknown;
  end: unknown;
  opensMinutes: unknown;
  /** Open the line on arrival: the chat card's Can't make it (#4660). */
  startWriting?: boolean;
}) {
  const mine = useMyEventExcuse(eventId, { enabled: required });
  const own = useMyAttendance(eventId);
  const send = useSendEventExcuse();
  const withdraw = useWithdrawEventExcuse();
  const gate = useSubscriptionGate();
  const { toast } = useToast();
  const now = new Date(useNow());
  const [writing, setWriting] = useState(startWriting);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();

  const view = myExcuseView({
    required,
    mine: mine.data,
    mineUnanswered: mine.data === undefined,
    ownAttendance: own.data,
    ownUnanswered: own.data === undefined,
    start,
    end,
    opensMinutes,
    now,
  });
  if (view.kind === "none") return null;

  const trimmed = reason.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed || send.isPending) return;
    setError(null);
    try {
      await send.mutateAsync({ eventId, reason: trimmed });
      setWriting(false);
      setReason("");
    } catch (failure) {
      setError(
        errorCopy(
          failure,
          "Couldn't send your excuse. Try again.",
          COPY_OPTIONS,
        ),
      );
    }
  }

  async function takeBack() {
    try {
      await withdraw.mutateAsync({ eventId });
      toast({ title: "Excuse withdrawn" });
    } catch (failure) {
      toast({
        title: "Couldn't withdraw your excuse",
        description: errorCopy(failure, "Try again in a moment.", COPY_OPTIONS),
        variant: "destructive",
      });
    }
  }

  if (view.kind === "offer") {
    return (
      <section
        aria-label="Can't make it"
        className="rounded-lg border border-border p-3"
      >
        {writing ? (
          <form onSubmit={(event) => void submit(event)} className="grid gap-2">
            <label htmlFor={inputId} className="text-sm font-semibold">
              Can&apos;t make it
            </label>
            <p className="text-sm text-muted-foreground">
              Say why in one line. It goes to whoever runs this event.
            </p>
            <Input
              id={inputId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Exam review, away game, sick…"
              maxLength={EVENT_EXCUSE_REASON_MAX}
              autoFocus
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            />
            {error ? (
              <p id={errorId} className="text-sm text-destructive-text">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                size="sm"
                {...gate.controlProps(send.isPending || !trimmed)}
              >
                {send.isPending ? (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                Send excuse
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setWriting(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
            <SubscriptionNotice
              gate={gate}
              feature="excuses"
              className="mb-0 w-full"
            />
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Required, and you can&apos;t be there?
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setWriting(true)}
            >
              Can&apos;t make it
            </Button>
          </div>
        )}
      </section>
    );
  }

  const badge = excuseBadge(view.status);
  return (
    <section
      aria-label="Your excuse"
      className="rounded-lg border border-border p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{view.title}</p>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      <p className="mt-1 break-words text-sm">“{view.reason}”</p>
      {view.detail ? (
        <p className="mt-1 text-sm text-muted-foreground">{view.detail}</p>
      ) : null}
      {view.canWithdraw ? (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          {...gate.controlProps(withdraw.isPending)}
          onClick={() => void takeBack()}
        >
          {withdraw.isPending ? "Withdrawing…" : "Withdraw excuse"}
        </Button>
      ) : null}
    </section>
  );
}

/**
 * The receiver's Excuses list: "2 to decide · 3 excused", then each excuse.
 * Mounted only for a viewer who may decide (the event's creator or an
 * `events:update` holder); draws nothing until there is an excuse, and
 * nothing on a refusal. A row the viewer may not decide (the creator's own
 * excuse, which goes to the officers) shows without buttons.
 */
export function ExcuseReview({
  eventId,
  viewerId,
  canUpdateEvents,
}: {
  eventId: string;
  viewerId: string | null;
  canUpdateEvents: boolean;
}) {
  const excuses = useEventExcuses(eventId);
  const decide = useDecideEventExcuse();
  const gate = useSubscriptionGate();
  const { toast } = useToast();
  const [deciding, setDeciding] = useState<string | null>(null);

  const rows = excuses.data ?? [];
  if (rows.length === 0) return null;

  const decider = { viewerId, canUpdateEvents };
  const summary = excuseSummaryLine(rows, decider);

  async function run(
    row: EventExcuseWithMember,
    decision: "APPROVED" | "DECLINED",
  ) {
    setDeciding(row.user_id);
    try {
      await decide.mutateAsync({ eventId, userId: row.user_id, decision });
    } catch (failure) {
      toast({
        title: "Couldn't save that decision",
        description: errorCopy(failure, "Try again in a moment.", COPY_OPTIONS),
        variant: "destructive",
      });
    } finally {
      setDeciding(null);
    }
  }

  return (
    <section
      aria-labelledby="event-excuses-label"
      className="rounded-lg border border-border p-3"
    >
      <p
        id="event-excuses-label"
        className="mb-2 text-caption text-muted-foreground"
      >
        Excuses{summary ? ` · ${summary}` : ""}
      </p>
      <ul className="grid gap-2">
        {sortExcusesForReview(rows).map((row) => {
          const name = row.display_name.trim() || "A member";
          const decidable = canDecideExcuse(row, decider);
          const badge = excuseBadge(row.status);
          return (
            <li key={row.id} className="rounded-md border border-border p-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{name}</p>
                {decidable ? null : (
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                )}
              </div>
              <p className="mt-1 break-words text-sm text-muted-foreground">
                “{row.reason}”
              </p>
              {decidable ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    aria-label={`Approve ${name}'s excuse`}
                    {...gate.controlProps(deciding !== null)}
                    onClick={() => void run(row, "APPROVED")}
                  >
                    {deciding === row.user_id ? (
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : null}
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`Decline ${name}'s excuse`}
                    {...gate.controlProps(deciding !== null)}
                    onClick={() => void run(row, "DECLINED")}
                  >
                    Decline
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <SubscriptionNotice
        gate={gate}
        feature="deciding excuses"
        className="mb-0 mt-2 w-full"
      />
    </section>
  );
}
