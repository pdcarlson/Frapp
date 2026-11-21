"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import {
  catchUpFirstRange,
  catchUpRangesFor,
  catchUpTargetFor,
  errorCopy,
  useChatCatchUp,
  type CatchUpScope,
} from "@repo/hooks";
import {
  CHAT_CATCH_UP_COPY,
  CHAT_CATCH_UP_POINT_KINDS,
  chatCatchUpGroupOf,
  chatCatchUpNotes,
  chatCatchUpTooLittleLine,
  chatCatchUpUnavailableLine,
  chatCatchUpWhen,
  type ChatCatchUp,
  type ChatCatchUpPoint,
  type ChatCatchUpRange,
} from "@repo/validation";
import { useAiConsentGate } from "@/components/ai/meet-frapp-ai";
import { ReportAiButton } from "@/components/ai/report-ai";
import { Button } from "@/components/ui/button";
import { FOCUS_RING, FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { IconButton } from "@/components/ui/icon-button";
import { SegmentedChoice } from "@/components/ui/segmented";
import { EYEBROW } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

/**
 * Catch me up on web (#3946, `spec/behavior/ai.md` § Catch me up): a member
 * back to a busy channel asks for the short version and gets a few lines,
 * each one a link to the message it came from.
 *
 * **In the channel, never over it** (Paul, 2026-11-19: "I NEVER WANT TO SEE
 * ANOTHER ONE OF THESE SIDE CARDS"). It used to be a 440px card on the
 * window's right edge that covered the page beside chat. Now the summary is
 * a block at the top of the conversation it summarizes, between the channel
 * header and the first message (where the offer strip sits), or at the top of
 * the thread pane for a thread. That is where Gmail's and Outlook's thread
 * summaries sit, and where Discord's channel summaries strip is. It grows to
 * at most a third of the pane and scrolls inside itself, so the conversation
 * is always readable under it, and pressing a line scrolls the conversation
 * to that message with the summary still above it.
 *
 * **Hide folds it to one line** ("Your summary is still here.", Back to
 * summary), the same strip the phone shows after a line is pressed. Close
 * ends it. Nothing dims and nothing is modal: Escape inside the block closes
 * it, and the composer keeps its own Escape.
 *
 * **Only the member's, and gone when they leave.** The summary lives in this
 * hook's state. Nothing is cached or stored, here or on the server, and
 * switching channels drops it. Report this is the one way any of it is kept
 * (`report-ai.tsx` says what, for whom and for how long before it sends).
 *
 * **Consent is asked at the first summary**, not when the entry point shows
 * (`useAiConsentGate`). The server checks again.
 *
 * **Nothing moves while it works.** The working line sits where the first
 * group lands, under a header and range control that are already in place.
 */

export type { CatchUpScope };

type Held = { kind: "consent" } | { kind: "failed"; message: string };

/**
 * The summary and what opens it. `start` asks for a summary straight away: of
 * the thread, of the new stretch when the channel had one, otherwise of the
 * last 24 hours. Render `element` at the top of the conversation `openKind`
 * names (the channel's timeline, or the thread pane), and `dialogs` once in
 * the screen.
 */
export function useCatchUp({
  activeChannelId,
  activeThreadRootId,
  nameFor,
  onOpenPoint,
}: {
  /** The channel on screen. A summary of any other channel is dropped. */
  activeChannelId: string | null;
  /**
   * The thread open beside or over the channel, or null. A thread's summary
   * is drawn in its thread, so closing that thread or opening another ends
   * it, rather than leaving it open with nowhere to show.
   */
  activeThreadRootId: string | null;
  nameFor: (userId: string) => string | null;
  /** Opens the message a line rests on, given what the summary is of. */
  onOpenPoint: (point: ChatCatchUpPoint, scope: CatchUpScope) => void;
}): {
  /** The channel a summary is open for, or null. */
  openChannelId: string | null;
  /** What the open summary is of: where to render `element`. */
  openKind: CatchUpScope["kind"] | null;
  start: (scope: CatchUpScope) => void;
  close: () => void;
  /** The block itself, or null when no summary is open. */
  element: ReactNode;
  /** The consent sheet the first summary may ask through. */
  dialogs: ReactNode;
} {
  const { current, run, reset } = useChatCatchUp();
  const { ensureConsent, consentDialog } = useAiConsentGate();
  const [scope, setScope] = useState<CatchUpScope | null>(null);
  const [range, setRange] = useState<ChatCatchUpRange>("day");
  const [folded, setFolded] = useState(false);
  // A summary that never reached the server: no answer on the AI sheet yet,
  // or the answer could not be read.
  const [held, setHeld] = useState<Held | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const block = useRef<HTMLElement | null>(null);

  // Leaving the channel ends its summary, and leaving the thread ends a
  // thread's (state adjusted during render).
  if (
    scope &&
    (scope.channelId !== activeChannelId ||
      (scope.kind === "thread" && scope.rootId !== activeThreadRootId))
  ) {
    setScope(null);
    setHeld(null);
  }
  const open = scope !== null;

  // However it closed, a request in flight stops and the summary is gone.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  // Into the block as it opens, so Escape closes it and Tab starts inside
  // it; back to whatever opened it when it closes, unless the member has
  // moved on into the conversation.
  const scopeKey = scope
    ? `${scope.channelId}:${scope.kind === "thread" ? scope.rootId : ""}`
    : null;
  useEffect(() => {
    if (!scopeKey) return;
    const opener = returnFocus.current;
    block.current?.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if (
        opener?.isConnected &&
        (!active || active === document.body || !active.isConnected)
      ) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [scopeKey]);

  const summarize = useCallback(
    async (next: CatchUpScope, nextRange: ChatCatchUpRange) => {
      setHeld(null);
      let agreed: boolean;
      try {
        agreed = await ensureConsent();
      } catch (error) {
        setHeld({
          kind: "failed",
          message: errorCopy(error, CHAT_CATCH_UP_COPY.failed),
        });
        return;
      }
      if (!agreed) {
        setHeld({ kind: "consent" });
        return;
      }
      await run(next.channelId, catchUpTargetFor(next, nextRange));
    },
    [ensureConsent, run],
  );

  const start = useCallback(
    (next: CatchUpScope) => {
      const active = document.activeElement;
      returnFocus.current = active instanceof HTMLElement ? active : null;
      const nextRange = catchUpFirstRange(next);
      reset();
      setScope(next);
      setRange(nextRange);
      setFolded(false);
      void summarize(next, nextRange);
    },
    [reset, summarize],
  );

  const close = useCallback(() => {
    setScope(null);
    setHeld(null);
  }, []);

  // Hide and Back to summary each swap out the control that was pressed, so
  // focus goes to the block itself rather than falling to the page, where
  // Escape and Tab would no longer reach it.
  const fold = useCallback((next: boolean) => {
    setFolded(next);
    requestAnimationFrame(() => block.current?.focus({ preventScroll: true }));
  }, []);

  const shown = scope && current?.channelId === scope.channelId ? current : null;
  const working = !held && shown?.phase === "working";

  const element = scope ? (
    <section
      ref={block}
      tabIndex={-1}
      aria-label={
        scope.kind === "thread"
          ? CHAT_CATCH_UP_COPY.thread_title
          : CHAT_CATCH_UP_COPY.name
      }
      data-slot="catch-up"
      data-folded={folded ? "" : undefined}
      className={cn(
        "flex max-h-[33%] min-h-0 shrink-0 flex-col bg-surface-1 outline-none",
        // Folded, the strip draws its own hairline.
        !folded && "border-b border-border",
      )}
      onKeyDown={(event) => {
        // Escape inside the block only, and only when nothing inside (the
        // consent sheet, Report this) took it first.
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      {folded ? (
        <CatchUpStrip
          line={CHAT_CATCH_UP_COPY.resume_line}
          action={CHAT_CATCH_UP_COPY.resume_action}
          onAction={() => fold(false)}
          dismissLabel={CHAT_CATCH_UP_COPY.close}
          onDismiss={close}
        />
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 pb-1 pl-4 pr-1 pt-2">
            <h2 className="text-body font-semibold">
              {scope.kind === "thread"
                ? CHAT_CATCH_UP_COPY.thread_title
                : CHAT_CATCH_UP_COPY.name}
            </h2>
            {scope.kind === "channel" ? (
              <SegmentedChoice
                label={CHAT_CATCH_UP_COPY.range_label}
                dense
                // Never disabled while it works: a disabled control drops
                // focus out of the block, and picking another range
                // replaces the request in flight.
                value={range}
                onChange={(next) => {
                  setRange(next);
                  void summarize(scope, next);
                }}
                options={catchUpRangesFor(scope).map((value) => ({
                  value,
                  label: CHAT_CATCH_UP_COPY.ranges[value],
                }))}
              />
            ) : null}
            <span className="ml-auto flex shrink-0 items-center">
              <button
                type="button"
                onClick={() => fold(true)}
                className={cn(
                  "rounded-sm px-2 text-caption font-semibold text-muted-foreground hover:text-foreground",
                  FOCUS_RING_OFFSET,
                )}
              >
                {CHAT_CATCH_UP_COPY.hide}
              </button>
              <IconButton
                label={CHAT_CATCH_UP_COPY.close}
                onClick={close}
                className="shrink-0 text-muted-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            </span>
          </div>
          <div className="min-h-0 overflow-y-auto px-4 pb-3 pt-1">
            <div aria-live="polite" className="space-y-3">
              {held?.kind === "consent" ? (
                <Notice
                  line={chatCatchUpUnavailableLine("consent_required")}
                  action={CHAT_CATCH_UP_COPY.consent_action}
                  onAction={() => void summarize(scope, range)}
                />
              ) : held?.kind === "failed" ? (
                <Notice
                  line={held.message}
                  action={CHAT_CATCH_UP_COPY.try_again}
                  onAction={() => void summarize(scope, range)}
                />
              ) : working ? (
                <p className="text-sm text-muted-foreground">
                  {CHAT_CATCH_UP_COPY.working}
                </p>
              ) : shown?.phase === "failed" ? (
                <Notice
                  line={shown.failure ?? CHAT_CATCH_UP_COPY.failed}
                  action={CHAT_CATCH_UP_COPY.try_again}
                  onAction={() => void summarize(scope, range)}
                />
              ) : shown?.summary ? (
                <Summary
                  summary={shown.summary}
                  nameFor={nameFor}
                  onAgain={() => void summarize(scope, range)}
                  onOpenPoint={(point) => onOpenPoint(point, scope)}
                />
              ) : null}
            </div>
          </div>
        </>
      )}
    </section>
  ) : null;

  return {
    openChannelId: scope?.channelId ?? null,
    openKind: scope?.kind ?? null,
    start,
    close,
    element,
    dialogs: consentDialog,
  };
}

/** One line of plain words, and the one thing to do about it. */
function Notice({
  line,
  action,
  onAction,
  children,
}: {
  line: string;
  action?: string;
  onAction?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-foreground">{line}</p>
      {children}
      {action && onAction ? (
        <Button type="button" variant="secondary" size="sm" onClick={onAction}>
          {action}
        </Button>
      ) : null}
    </div>
  );
}

function Notes({ summary }: { summary: ChatCatchUp }) {
  const notes = chatCatchUpNotes(summary);
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-1 text-caption text-muted-foreground">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}

function Summary({
  summary,
  nameFor,
  onOpenPoint,
  onAgain,
}: {
  summary: ChatCatchUp;
  nameFor: (userId: string) => string | null;
  onOpenPoint: (point: ChatCatchUpPoint) => void;
  onAgain: () => void;
}) {
  // Read once per summary, so every line's "Today" is the same day.
  const [now] = useState(() => new Date());

  if (summary.status === "unavailable") {
    return (
      <Notice
        line={chatCatchUpUnavailableLine(summary.reason)}
        action={
          summary.reason === "consent_required"
            ? CHAT_CATCH_UP_COPY.consent_action
            : undefined
        }
        onAction={onAgain}
      />
    );
  }
  if (summary.status === "nothing_new") {
    return <Notice line={CHAT_CATCH_UP_COPY.nothing_new} />;
  }
  if (summary.status === "too_little") {
    return (
      <Notice line={chatCatchUpTooLittleLine(summary)}>
        <Notes summary={summary} />
      </Notice>
    );
  }
  if (summary.status === "refused") {
    return <Notice line={CHAT_CATCH_UP_COPY.refused} />;
  }
  if (summary.status !== "summarized" || summary.points.length === 0) {
    // `not_found`, and any status this build does not know.
    return (
      <Notice
        line={
          summary.status === "not_found"
            ? CHAT_CATCH_UP_COPY.not_found
            : chatCatchUpUnavailableLine(null)
        }
        action={CHAT_CATCH_UP_COPY.try_again}
        onAction={onAgain}
      >
        <Notes summary={summary} />
      </Notice>
    );
  }

  return (
    <>
      {CHAT_CATCH_UP_POINT_KINDS.map((kind) => {
        const points = summary.points.filter(
          (point) => chatCatchUpGroupOf(point.kind) === kind,
        );
        if (points.length === 0) return null;
        return (
          <section key={kind} className="space-y-1.5">
            <h3 className={cn(EYEBROW, "text-muted-foreground")}>
              {CHAT_CATCH_UP_COPY.groups[kind]}
            </h3>
            <ul className="space-y-1">
              {points.map((point) => {
                const who = point.author_id ? nameFor(point.author_id) : null;
                const when = chatCatchUpWhen(point.sent_at, now);
                return (
                  <li key={`${point.kind}:${point.message_id}`}>
                    <button
                      type="button"
                      onClick={() => onOpenPoint(point)}
                      title={CHAT_CATCH_UP_COPY.open_message}
                      className={cn(
                        "-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left transition-colors hover:bg-card-hover",
                        FOCUS_RING,
                      )}
                    >
                      <span className="block text-sm text-foreground">
                        {point.text}
                      </span>
                      <span className="block text-caption text-muted-foreground">
                        {[who, when].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <Notes summary={summary} />
      <p className="text-caption text-muted-foreground">
        {CHAT_CATCH_UP_COPY.private}
      </p>
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onAgain}>
          {CHAT_CATCH_UP_COPY.again}
        </Button>
        {/*
          Report this (#4315), on every AI-made surface. Keyed by the
          summary, so a new summary is not shown as already reported.
        */}
        {summary.summary_id ? (
          <ReportAiButton
            key={summary.summary_id}
            target={{
              subject: "chat_summary",
              subjectId: summary.summary_id,
              receipt: summary.report_receipt ?? null,
            }}
          />
        ) : null}
      </div>
    </>
  );
}

/**
 * The strip above a channel opened with many new messages: how many, and the
 * one button. Between the channel header and the timeline, at the Important
 * strip's height, in the quiet surface colours, since it is an offer and not
 * an alert. Always mounted as a live region so the offer is announced.
 */
export function CatchUpOffer({
  line,
  onStart,
  onDismiss,
}: {
  /** What to say, or null to show nothing. */
  line: string | null;
  onStart: () => void;
  onDismiss: () => void;
}) {
  return (
    <div role="status" aria-live="polite" className="shrink-0">
      {line ? (
        <CatchUpStrip
          slot="catch-up-offer"
          line={line}
          action={CHAT_CATCH_UP_COPY.offer_action}
          onAction={onStart}
          dismissLabel={CHAT_CATCH_UP_COPY.offer_dismiss}
          onDismiss={onDismiss}
        />
      ) : null}
    </div>
  );
}

/**
 * One line, one action and an ×: the offer above a busy channel, and the
 * open summary folded (Hide). The phone's `CatchUpStrip` is the same strip.
 */
function CatchUpStrip({
  slot,
  line,
  action,
  onAction,
  dismissLabel,
  onDismiss,
}: {
  slot?: string;
  line: string;
  action: string;
  onAction: () => void;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  return (
    <div
      data-slot={slot}
      className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface-1 pl-4 pr-1 pointer-coarse:h-11"
    >
      <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
        {line}
      </span>
      <button
        type="button"
        onClick={onAction}
        className={cn(
          "shrink-0 rounded-sm px-2 text-caption font-semibold text-foreground hover:underline",
          FOCUS_RING_OFFSET,
        )}
      >
        {action}
      </button>
      <IconButton label={dismissLabel} onClick={onDismiss} className="shrink-0">
        <X />
      </IconButton>
    </div>
  );
}
