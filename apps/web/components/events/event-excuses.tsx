"use client";

import { useId, useState, type FormEvent } from "react";
import {
  errorCopy,
  canDecideExcuse,
  excuseSummaryLine,
  myExcuseView,
  sortExcusesForReview,
  useDecideEventExcuse,
  useEditEventExcuse,
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
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { QUIET_LINK } from "@/components/ui/quiet-link";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { toastFailure } from "@/lib/failure-toast";
import { useToast } from "@/lib/hooks/use-toast";
import { cn } from "@/lib/utils";

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
  writeAsk = 0,
}: {
  eventId: string;
  /** Whether the event requires the viewer (`useRequiredOfViewer`). */
  required: boolean;
  start: unknown;
  end: unknown;
  opensMinutes: unknown;
  /**
   * The chat card's Can't make it (#4660): a nonzero count opens the line,
   * on arrival and again each time it changes while this stays mounted.
   */
  writeAsk?: number;
}) {
  const mine = useMyEventExcuse(eventId, { enabled: required });
  const own = useMyAttendance(eventId);
  const send = useSendEventExcuse();
  const edit = useEditEventExcuse();
  const withdraw = useWithdrawEventExcuse();
  const gate = useSubscriptionGate();
  const { toast } = useToast();
  const now = new Date(useNow());
  const [writing, setWriting] = useState(writeAsk > 0);
  // A new ask while mounted reopens the line: state adjusted during render,
  // React's pattern for following a prop, rather than an effect.
  const [seenAsk, setSeenAsk] = useState(writeAsk);
  if (writeAsk !== seenAsk) {
    setSeenAsk(writeAsk);
    if (writeAsk > 0) setWriting(true);
  }
  const [error, setError] = useState<string | null>(null);
  const [reasonOpen, setReasonOpen] = useState(false);

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

  async function save(write: () => Promise<unknown>, fallback: string) {
    setError(null);
    try {
      await write();
      setWriting(false);
    } catch (failure) {
      setError(errorCopy(failure, fallback, COPY_OPTIONS));
    }
  }

  async function takeBack() {
    try {
      await withdraw.mutateAsync({ eventId });
      setWriting(false);
      toast({ title: "Excuse withdrawn" });
    } catch (failure) {
      toastFailure({
        title: "Couldn't withdraw your excuse",
        error: failure,
        fallback: "Try again in a moment.",
        copyOptions: COPY_OPTIONS,
        retry: takeBack,
      });
    }
  }

  const cancel = () => {
    setWriting(false);
    setError(null);
  };

  if (view.kind === "offer") {
    // Closed, the offer is one quiet underlined line, not a bordered row with
    // a button: declining reads quieter than going (#4933, the way Google
    // Calendar's and Luma's RSVP rows keep No secondary).
    if (!writing) {
      return (
        <button
          type="button"
          // Centered under the check-in block, as on the phone; a grid
          // child stretches without it, which made the whole row the target.
          className={cn(QUIET_LINK, "justify-self-center")}
          onClick={() => setWriting(true)}
        >
          Can&apos;t make it?
        </button>
      );
    }
    return (
      <ExcuseComposer
        label="Can't make it"
        caption="Say why in one line. It goes to whoever runs this event."
        submitLabel="Send"
        submitA11y="Send excuse"
        busy={send.isPending}
        error={error}
        gate={gate}
        onSubmit={(reason) =>
          void save(
            () => send.mutateAsync({ eventId, reason }),
            "Couldn't send your excuse. Try again.",
          )
        }
        onCancel={cancel}
      />
    );
  }

  const declined = view.status === "DECLINED";
  if (writing && view.canEdit) {
    return (
      <ExcuseComposer
        label="Your excuse"
        caption={
          declined
            ? "Change it and send it again. You're still expected until it's accepted."
            : view.title
        }
        initial={view.reason}
        submitLabel={declined ? "Send again" : "Save"}
        submitA11y={declined ? "Send excuse again" : "Save excuse"}
        busy={edit.isPending}
        error={error}
        gate={gate}
        onSubmit={(reason) =>
          void save(
            () => edit.mutateAsync({ eventId, reason }),
            "Couldn't save your excuse. Try again.",
          )
        }
        onCancel={cancel}
        withdraw={
          view.canWithdraw
            ? { pending: withdraw.isPending, onClick: () => void takeBack() }
            : null
        }
      />
    );
  }

  // One row: the reason, where it stands, and the one thing it allows. The
  // receiver ("Sent to Jake") rides the section label, not a second line.
  const badge = excuseBadge(view.status);
  return (
    <section
      aria-label="Your excuse"
      className="grid min-w-0 gap-1 rounded-lg border border-border p-3"
    >
      <p className="text-caption text-muted-foreground">
        {view.status === "PENDING"
          ? `Your excuse · ${view.title.replace(/^Excuse sent/, "Sent")}`
          : "Your excuse"}
      </p>
      <div
        className={cn(
          "flex min-h-11 min-w-0 gap-3",
          reasonOpen ? "items-start" : "items-center",
        )}
      >
        {/* One line until tapped, as on the receiver's list. */}
        <button
          type="button"
          aria-expanded={reasonOpen}
          aria-label={`${view.title}: ${view.reason}`}
          onClick={() => setReasonOpen((value) => !value)}
          className={cn(
            "min-w-0 flex-1 rounded-sm text-left text-sm",
            reasonOpen ? "whitespace-normal break-words" : "truncate",
            FOCUS_RING_OFFSET,
          )}
        >
          {view.reason}
        </button>
        <Badge variant={badge.variant}>{badge.label}</Badge>
        {view.canEdit ? (
          <button
            type="button"
            className={ROW_ACTION}
            onClick={() => setWriting(true)}
          >
            Edit
          </button>
        ) : view.canWithdraw ? (
          <button
            type="button"
            className={ROW_ACTION}
            {...gate.controlProps(withdraw.isPending)}
            onClick={() => void takeBack()}
          >
            {withdraw.isPending ? "Withdrawing…" : "Withdraw excuse"}
          </button>
        ) : null}
      </div>
      {view.detail ? (
        <p className="text-sm text-muted-foreground">{view.detail}</p>
      ) : null}
    </section>
  );
}

/** A row's trailing text action: the accent label, 44px to a finger. */
const ROW_ACTION = cn(
  "shrink-0 rounded-sm text-sm font-semibold text-primary hover:underline",
  "pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center pointer-coarse:justify-center",
  "disabled:pointer-events-none disabled:opacity-50",
  FOCUS_RING_OFFSET,
);

/**
 * The excuse line, new or being edited: one field with its button beside it,
 * and a caption, Withdraw and Cancel under it. It takes the place of the
 * row's own block, in the sheet's section box, so opening it moves nothing
 * else on the sheet.
 */
function ExcuseComposer({
  label,
  caption,
  initial = "",
  submitLabel,
  submitA11y,
  busy,
  error,
  gate,
  onSubmit,
  onCancel,
  withdraw = null,
}: {
  label: string;
  caption: string;
  initial?: string;
  submitLabel: string;
  submitA11y: string;
  busy: boolean;
  error: string | null;
  gate: ReturnType<typeof useSubscriptionGate>;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
  withdraw?: { pending: boolean; onClick: () => void } | null;
}) {
  const [reason, setReason] = useState(initial);
  const inputId = useId();
  const errorId = useId();
  const captionId = useId();
  const trimmed = reason.trim();
  // Saving the words already there would ask the server for nothing.
  const unchanged = initial !== "" && trimmed === initial.trim();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed || unchanged || busy) return;
    onSubmit(trimmed);
  }

  return (
    <section
      aria-label={label}
      className="min-w-0 rounded-lg border border-border p-3"
    >
      <form onSubmit={submit} className="grid min-w-0 gap-1">
        <label htmlFor={inputId} className="text-caption text-muted-foreground">
          {label}
        </label>
        <div className="flex items-center gap-2">
          <Input
            id={inputId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Exam review, away game, sick…"
            maxLength={EVENT_EXCUSE_REASON_MAX}
            autoFocus
            className="min-w-0 flex-1"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${errorId} ${captionId}` : captionId}
          />
          <Button
            type="submit"
            size="sm"
            aria-label={submitA11y}
            aria-busy={busy || undefined}
            {...gate.controlProps(busy || !trimmed || unchanged)}
          >
            {/* The label keeps its place while saving, so nothing shifts. */}
            <span className={busy ? "opacity-60" : undefined}>
              {submitLabel}
            </span>
          </Button>
        </div>
        {error ? (
          <p id={errorId} className="text-sm text-destructive-text">
            {error}
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <p
            id={captionId}
            className="min-w-0 flex-1 text-sm text-muted-foreground"
          >
            {caption}
          </p>
          {withdraw ? (
            <button
              type="button"
              className={QUIET_LINK}
              {...gate.controlProps(withdraw.pending)}
              onClick={withdraw.onClick}
            >
              {withdraw.pending ? "Withdrawing…" : "Withdraw excuse"}
            </button>
          ) : null}
          <button type="button" className={QUIET_LINK} onClick={onCancel}>
            Cancel
          </button>
        </div>
        <SubscriptionNotice
          gate={gate}
          feature="excuses"
          className="mb-0 w-full"
        />
      </form>
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
  const [deciding, setDeciding] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

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
      toastFailure({
        title: "Couldn't save that decision",
        error: failure,
        fallback: "Try again in a moment.",
        copyOptions: COPY_OPTIONS,
        retry: () => run(row, decision),
      });
    } finally {
      setDeciding(null);
    }
  }

  return (
    <section
      aria-labelledby="event-excuses-label"
      className="grid min-w-0 gap-1 rounded-lg border border-border p-3"
    >
      <p
        id="event-excuses-label"
        className="text-caption text-muted-foreground"
      >
        Excuses{summary ? ` · ${summary}` : ""}
      </p>
      <ul className="min-w-0 divide-y divide-border">
        {sortExcusesForReview(rows).map((row) => {
          const name = row.display_name.trim() || "A member";
          const decidable = canDecideExcuse(row, decider);
          const badge = excuseBadge(row.status);
          const expanded = open === row.id;
          return (
            <li
              key={row.id}
              className={cn(
                "flex min-h-11 gap-3 py-2",
                expanded ? "items-start" : "items-center",
              )}
            >
              {/* The row's text opens to the whole reason; one line until then. */}
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={`${name}: ${row.reason}`}
                onClick={() => setOpen(expanded ? null : row.id)}
                className={cn(
                  "min-w-0 flex-1 rounded-sm text-left text-sm",
                  expanded ? "whitespace-normal break-words" : "truncate",
                  FOCUS_RING_OFFSET,
                )}
              >
                <span className="font-semibold text-foreground">{name}</span>
                <span className="ml-2 text-muted-foreground">{row.reason}</span>
              </button>
              {decidable ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Decline ${name}'s excuse`}
                    {...gate.controlProps(deciding !== null)}
                    onClick={() => void run(row, "DECLINED")}
                  >
                    Decline
                  </Button>
                  <Button
                    size="sm"
                    variant="tinted"
                    aria-label={`Approve ${name}'s excuse`}
                    aria-busy={deciding === row.user_id || undefined}
                    {...gate.controlProps(deciding !== null)}
                    onClick={() => void run(row, "APPROVED")}
                  >
                    <span
                      className={
                        deciding === row.user_id ? "opacity-60" : undefined
                      }
                    >
                      Approve
                    </span>
                  </Button>
                </div>
              ) : (
                <Badge variant={badge.variant} className="shrink-0">
                  {badge.label}
                </Badge>
              )}
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
