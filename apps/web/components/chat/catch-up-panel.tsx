"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  errorCopy,
  useChatCatchUp,
  type ChatCatchUpTarget,
} from "@repo/hooks";
import {
  CHAT_CATCH_UP_COPY,
  CHAT_CATCH_UP_POINT_KINDS,
  chatCatchUpGroupOf,
  chatCatchUpNotes,
  chatCatchUpSince,
  chatCatchUpTooLittleLine,
  chatCatchUpUnavailableLine,
  chatCatchUpWhen,
  type ChatCatchUp,
  type ChatCatchUpPoint,
  type ChatCatchUpRange,
} from "@repo/validation";
import { useAiConsentGate } from "@/components/ai/ai-consent-sheet";
import { ReportAiButton } from "@/components/ai/report-ai";
import { PanelBody } from "@/components/shared/panel";
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
 * **Where the others put it.** Slack's recap and Teams' Copilot recap both
 * open beside the conversation and keep each line tied to its message;
 * Discord's summaries sit above the channel as a strip to jump from. This
 * takes both halves: a strip above the timeline offers it when a channel
 * opens with many new messages (`CatchUpOffer`), and the summary itself is a
 * panel on the right edge, in Ask's place and at Ask's width, so the member
 * reads a line, opens its message, and the summary is still there.
 *
 * **Not a dialog**, for `ask-panel.tsx`'s reasons: nothing dims, the channel
 * stays live, and from `lg` up the shell moves over to make room
 * (`CATCH_UP_OPEN_ATTRIBUTE`). Below `lg` it covers the page and opening a
 * line closes it.
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
export const CATCH_UP_OPEN_ATTRIBUTE = "data-catch-up-open";

/** Tailwind's `lg`: from here the channel and the panel fit side by side. */
const BESIDE_PAGE_QUERY = "(min-width: 1024px)";

/** What a summary is of. */
export type CatchUpScope =
  | {
      kind: "channel";
      channelId: string;
      channelName: string | null;
      /**
       * The stretch that was new when the member opened the channel, or null
       * when there was none (or it is not known).
       */
      unread: { count: number; as_of: string } | null;
    }
  | {
      kind: "thread";
      channelId: string;
      channelName: string | null;
      rootId: string;
    };

type Held = { kind: "consent" } | { kind: "failed"; message: string };

function targetFor(scope: CatchUpScope, range: ChatCatchUpRange): ChatCatchUpTarget {
  if (scope.kind === "thread") return { thread_root_id: scope.rootId };
  if (range === "unread" && scope.unread) return { unread: scope.unread };
  return { since: chatCatchUpSince(range === "week" ? "week" : "day", new Date()) };
}

/**
 * The panel and what opens it. `start` asks for a summary straight away: of
 * the thread, of the new stretch when the channel had one, otherwise of the
 * last 24 hours. Render `element` once in the screen.
 */
export function useCatchUpPanel({
  activeChannelId,
  nameFor,
  onOpenPoint,
}: {
  /** The channel on screen. A summary of any other channel is dropped. */
  activeChannelId: string | null;
  nameFor: (userId: string) => string | null;
  /** Opens the message a line rests on. */
  onOpenPoint: (point: ChatCatchUpPoint) => void;
}): {
  /** The channel a summary is open for, or null. */
  openChannelId: string | null;
  start: (scope: CatchUpScope) => void;
  close: () => void;
  element: ReactNode;
} {
  const { current, run, reset } = useChatCatchUp();
  const { ensureConsent, consentDialog } = useAiConsentGate();
  const [scope, setScope] = useState<CatchUpScope | null>(null);
  const [range, setRange] = useState<ChatCatchUpRange>("day");
  // A summary that never reached the server: no answer on the AI sheet yet,
  // or the answer could not be read.
  const [held, setHeld] = useState<Held | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLElement | null>(null);

  // Leaving the channel ends its summary (state adjusted during render).
  if (scope && scope.channelId !== activeChannelId) {
    setScope(null);
    setHeld(null);
  }
  const open = scope !== null;

  // However it closed, a request in flight stops and the summary is gone.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const opener = returnFocus.current;
    root.setAttribute(CATCH_UP_OPEN_ATTRIBUTE, "");
    // Into the panel, so Escape closes it and Tab starts inside it.
    panel.current?.focus({ preventScroll: true });
    return () => {
      root.removeAttribute(CATCH_UP_OPEN_ATTRIBUTE);
      if (opener?.isConnected && !document.activeElement?.closest("main")) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [open]);

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
      await run(next.channelId, targetFor(next, nextRange));
    },
    [ensureConsent, run],
  );

  const start = useCallback(
    (next: CatchUpScope) => {
      const active = document.activeElement;
      returnFocus.current = active instanceof HTMLElement ? active : null;
      const nextRange: ChatCatchUpRange =
        next.kind === "channel" && next.unread ? "unread" : "day";
      reset();
      setScope(next);
      setRange(nextRange);
      void summarize(next, nextRange);
    },
    [reset, summarize],
  );

  const close = useCallback(() => {
    setScope(null);
    setHeld(null);
  }, []);

  const shown = scope && current?.channelId === scope.channelId ? current : null;
  const working = !held && shown?.phase === "working";

  const element = (
    <>
      {scope
        ? createPortal(
            <aside
              ref={panel}
              tabIndex={-1}
              aria-label={CHAT_CATCH_UP_COPY.name}
              data-slot="catch-up-panel"
              className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-border bg-popover text-popover-foreground outline-none animate-in slide-in-from-right duration-300 sm:w-[440px] sm:rounded-l-2xl sm:border-l"
              onKeyDown={(event) => {
                // Escape inside the panel only, and only when nothing inside
                // (the consent sheet) took it first.
                if (event.key !== "Escape" || event.defaultPrevented) return;
                event.preventDefault();
                event.stopPropagation();
                close();
              }}
            >
              <div className="flex min-h-14 shrink-0 items-start gap-2 py-2.5 pl-5 pr-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-bold leading-[26px]">
                    {scope.kind === "thread"
                      ? CHAT_CATCH_UP_COPY.thread_title
                      : CHAT_CATCH_UP_COPY.name}
                  </h2>
                  <p className="truncate text-caption text-muted-foreground">
                    {scope.channelName ? `#${scope.channelName} · ` : ""}
                    {CHAT_CATCH_UP_COPY.private}
                  </p>
                </div>
                <IconButton
                  label={CHAT_CATCH_UP_COPY.close}
                  onClick={close}
                  className="shrink-0 text-muted-foreground"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </IconButton>
              </div>
              {scope.kind === "channel" ? (
                <div className="shrink-0 px-5 pb-3">
                  <SegmentedChoice
                    label={CHAT_CATCH_UP_COPY.range_label}
                    fill
                    // Never disabled while it works: a disabled control
                    // drops focus out of the panel, and picking another
                    // range replaces the request in flight.
                    value={range}
                    onChange={(next) => {
                      setRange(next);
                      void summarize(scope, next);
                    }}
                    options={(scope.unread
                      ? (["unread", "day", "week"] as const)
                      : (["day", "week"] as const)
                    ).map((value) => ({
                      value,
                      label: CHAT_CATCH_UP_COPY.ranges[value],
                    }))}
                  />
                </div>
              ) : null}
              <PanelBody>
                <div aria-live="polite" className="space-y-4">
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
                      onOpenPoint={(point) => {
                        onOpenPoint(point);
                        if (!window.matchMedia?.(BESIDE_PAGE_QUERY).matches) {
                          close();
                        }
                      }}
                    />
                  ) : null}
                </div>
              </PanelBody>
            </aside>,
            document.body,
          )
        : null}
      {consentDialog}
    </>
  );

  return { openChannelId: scope?.channelId ?? null, start, close, element };
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
        <div
          data-slot="catch-up-offer"
          className="flex h-9 items-center gap-2 border-b border-border bg-surface-1 pl-4 pr-1 pointer-coarse:h-11"
        >
          <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
            {line}
          </span>
          <button
            type="button"
            onClick={onStart}
            className={cn(
              "shrink-0 rounded-sm px-2 text-caption font-semibold text-foreground hover:underline",
              FOCUS_RING_OFFSET,
            )}
          >
            {CHAT_CATCH_UP_COPY.offer_action}
          </button>
          <IconButton
            label={CHAT_CATCH_UP_COPY.offer_dismiss}
            onClick={onDismiss}
            className="shrink-0"
          >
            <X />
          </IconButton>
        </div>
      ) : null}
    </div>
  );
}
