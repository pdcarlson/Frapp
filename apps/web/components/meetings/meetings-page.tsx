"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { codeOf } from "@repo/api-sdk";
import {
  useEvents,
  useMeetingNoteTaking,
  useMeetings,
  useMeetingsNoMinutes,
  useMemberDisplayNames,
  useMyPermissions,
  useSetMeetingNoMinutes,
  useStartMeeting,
  useViewerUserId,
  type MeetingSummary,
} from "@repo/hooks";
import {
  MEETING_ENTRY_COPY,
  MEETING_LIST_COPY,
  MEETING_NOTE_TAKERS_COPY,
  can,
  guessMeetingType,
  meetingTypeLabel,
  minutesRowTags,
  minutesTimeline,
  minutesToWrite,
  startedEventIds,
  type CalendarMeeting,
  type MeetingType,
} from "@repo/validation";
import { Can } from "@/components/shared/can";
import { PageActions } from "@/components/layout/page-actions";
import { ErrorState } from "@/components/shared/async-states";
import { InlineNote } from "@/components/shared/inline-note";
import { SectionLabel } from "@/components/shared/section-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToastAction } from "@/components/ui/toast";
import { RowMenu, type RowMenuEntry } from "@/components/shared/row-menu";
import { NewButton } from "@/components/ui/new-button";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { asArray, cn, getErrorMessage } from "@/lib/utils";
import {
  MINUTES_DRAFT,
  StartMinutesPanel,
} from "@/components/meetings/start-minutes-panel";
import { useKeptPanel } from "@repo/hooks/kept-drafts";
import { MeetingRowsSkeleton } from "@/components/meetings/meetings-skeleton";
import {
  meetingDayLabel,
  meetingHref,
  meetingWhenLabel,
} from "@/components/meetings/meeting-copy";
import { useToast } from "@/lib/hooks/use-toast";

/** Keyed by chapter, so a switch never shows one chapter's minutes in another. */
export function MeetingsPage() {
  const chapterId = useChapterStore((state) => state.activeChapterId);
  return <ChapterMeetingsPage key={chapterId ?? "none"} />;
}

/**
 * `/meetings` (`spec/behavior/meetings.md`): the minutes this member may
 * read, tied to the calendar (Paul, 2026-11-19), as one timeline (Paul,
 * 2026-11-20: "should this go in chronological order?"; `minutesTimeline`).
 * For someone who records minutes, the next meeting sits on top, then
 * Taking notes (other officers' drafts the viewer was added to, #4935),
 * then every past meeting at its date, newest first, grouped This week,
 * Last week, then by month, as Granola lists the calendar's meetings with
 * their notes: posted minutes, drafts (tagged Draft, named when another
 * officer's), and a meeting that ended in the last 30 days with none, with
 * Write minutes and, in its menu, No minutes for this meeting, which settles
 * it. The same order and words as the phone's Minutes list.
 */
function ChapterMeetingsPage() {
  const meetingsQuery = useMeetings();
  const takingQuery = useMeetingNoteTaking();
  const viewerId = useViewerUserId();
  const names = useMemberDisplayNames();
  const [starting, setStarting] = useState(false);
  // Reopens on return when the page was left mid-form (#4593), once the
  // viewer is known to still start minutes, as the button that opens it is.
  const canRecord = can(
    "meetings:record",
    useMyPermissions().data?.permissions ?? [],
  );
  useKeptPanel({
    page: "meetings",
    form: MINUTES_DRAFT,
    open: starting,
    setOpen: setStarting,
    ready: canRecord,
  });
  // The calendar and its "No minutes" marks, read only by someone who can
  // start minutes from it.
  const eventsQuery = useEvents({ enabled: canRecord });
  const noMinutesQuery = useMeetingsNoMinutes({ enabled: canRecord });
  const setNoMinutes = useSetMeetingNoMinutes();
  // Moves on each minute, so a meeting that ends while the page is open
  // leaves Next up for its Write minutes row without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  // Events whose start answered "already started": someone else's draft
  // this viewer can't read, so the list can't see it and Start can't win.
  const [taken, setTaken] = useState<ReadonlySet<string>>(() => new Set());
  const toWrite = useMemo(() => {
    const started = startedEventIds(meetingsQuery.data, takingQuery.data);
    for (const id of taken) started.add(id);
    return minutesToWrite(
      asArray<CalendarMeeting>(eventsQuery.data),
      started,
      now,
      new Set(noMinutesQuery.data ?? []),
    );
  }, [
    eventsQuery.data,
    meetingsQuery.data,
    takingQuery.data,
    noMinutesQuery.data,
    taken,
    now,
  ]);
  // Unknown is not "none written": wait for every read before listing any.
  // The No minutes marks only settle rows, so if their read fails the list
  // still asks for every meeting rather than hiding Next up and the rest.
  const showToWrite =
    canRecord &&
    eventsQuery.isSuccess &&
    meetingsQuery.isSuccess &&
    takingQuery.isSuccess &&
    (noMinutesQuery.isSuccess || noMinutesQuery.isError);
  const router = useRouter();
  const { toast } = useToast();
  const start = useStartMeeting();
  const [startingId, setStartingId] = useState<string | null>(null);

  /**
   * Starts minutes on an event that ended with none, with the type its name
   * suggests, as the event's own Minutes row does. One at a time.
   */
  async function startFor(event: CalendarMeeting) {
    if (startingId) return;
    setStartingId(event.id);
    try {
      const meeting = await start.mutateAsync({
        event_id: event.id,
        meeting_type: guessMeetingType(event.name),
      });
      router.push(meetingHref(meeting.id));
    } catch (error) {
      if (codeOf(error) === "meeting.already_started") {
        setTaken((current) => new Set(current).add(event.id));
        void meetingsQuery.refetch();
        void takingQuery.refetch();
        toast({
          title: MEETING_ENTRY_COPY.alreadyStartedTitle,
          description: MEETING_ENTRY_COPY.alreadyStartedBody,
        });
        return;
      }
      toast({
        title: MEETING_ENTRY_COPY.startFailed,
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    } finally {
      setStartingId(null);
    }
  }
  /**
   * Settles a meeting that had no minutes, or takes that back. Shown at
   * once, with Undo, as Gmail's archive is.
   */
  function markNoMinutes(event: CalendarMeeting, noMinutes: boolean) {
    const failed = (error: unknown) =>
      toast({
        title: MEETING_LIST_COPY.noMinutesFailed,
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    setNoMinutes.mutateAsync({ eventId: event.id, noMinutes }).then(() => {
      if (!noMinutes) return;
      toast({
        title: MEETING_LIST_COPY.markedNoMinutes(event.name),
        action: (
          <ToastAction
            altText={`${MEETING_LIST_COPY.undo}: ${MEETING_LIST_COPY.markedNoMinutes(event.name)}`}
            onClick={() =>
              void setNoMinutes
                .mutateAsync({ eventId: event.id, noMinutes: false })
                .catch(failed)
            }
          >
            {MEETING_LIST_COPY.undo}
          </ToastAction>
        ),
      });
    }, failed);
  }

  const groups = useMemo(
    () =>
      minutesTimeline(meetingsQuery.data ?? [], {
        write: showToWrite ? toWrite.needs : [],
        skipped: showToWrite ? toWrite.skipped : [],
        now,
      }),
    [meetingsQuery.data, showToWrite, toWrite, now],
  );
  const authorOf = (row: MeetingSummary) =>
    row.status === "draft" && row.created_by && row.created_by !== viewerId
      ? names.nameFor(row.created_by)
      : null;

  return (
    <div className="space-y-6">
      <Can permission="meetings:record">
        <PageActions>
          <NewButton thing="minutes" onClick={() => setStarting(true)} />
        </PageActions>
      </Can>

      {meetingsQuery.isPending ? (
        <MeetingRowsSkeleton />
      ) : meetingsQuery.isError && !meetingsQuery.data ? (
        <ErrorState
          title={MEETING_LIST_COPY.loadFailedTitle}
          description={MEETING_LIST_COPY.loadFailedBody}
          onRetry={() => void meetingsQuery.refetch()}
        />
      ) : (
        <>
          {showToWrite && toWrite.next ? (
            <section aria-labelledby="meetings-next" className="space-y-2">
              <SectionLabel id="meetings-next">
                {MEETING_LIST_COPY.nextUp}
              </SectionLabel>
              <Link
                href={`/events?event=${toWrite.next.id}`}
                className={cn(
                  "flex min-h-14 items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-card-hover",
                  FOCUS_RING_OFFSET,
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {toWrite.next.name}
                  </span>
                  <span className="block truncate text-caption text-muted-foreground">
                    {meetingTypeLabel(guessMeetingType(toWrite.next.name))}
                    {" · "}
                    {meetingWhenLabel(toWrite.next.start_time)}
                  </span>
                </span>
                <span className="shrink-0 text-caption text-muted-foreground">
                  {MEETING_LIST_COPY.openEvent}
                </span>
              </Link>
            </section>
          ) : null}
          {(takingQuery.data ?? []).length > 0 ? (
            <section aria-labelledby="meetings-taking" className="space-y-2">
              <SectionLabel
                id="meetings-taking"
                count={takingQuery.data?.length ?? 0}
              >
                {MEETING_NOTE_TAKERS_COPY.listHeading}
              </SectionLabel>
              <ul role="list" className="divide-y divide-border">
                {(takingQuery.data ?? []).map((row) => (
                  <li key={row.meeting_id}>
                    <Link
                      href={`/meetings/${row.meeting_id}/notes`}
                      className={cn(
                        "flex min-h-14 items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-card-hover",
                        FOCUS_RING_OFFSET,
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {row.event_name}
                        </span>
                        <span className="block truncate text-caption text-muted-foreground">
                          {meetingDayLabel(row.event_start_time)}
                          {" · "}
                          {MEETING_NOTE_TAKERS_COPY.listItem(row.author_name)}
                        </span>
                      </span>
                      <span className="shrink-0 text-caption text-muted-foreground">
                        {row.joined
                          ? MEETING_NOTE_TAKERS_COPY.takingNotes
                          : MEETING_NOTE_TAKERS_COPY.takeNotes}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {groups.length === 0 ? (
            <InlineNote>{MEETING_LIST_COPY.none}</InlineNote>
          ) : (
            groups.map((group) => (
              <section
                key={group.key}
                aria-labelledby={`meetings-${group.key}`}
                className="space-y-2"
              >
                <SectionLabel id={`meetings-${group.key}`}>
                  {group.label}
                </SectionLabel>
                <ul role="list" className="divide-y divide-border">
                  {group.items.map((item) =>
                    item.kind === "minutes" ? (
                      <MinutesRow
                        key={item.key}
                        row={item.minutes}
                        author={authorOf(item.minutes)}
                      />
                    ) : (
                      <CalendarMeetingRow
                        key={item.key}
                        event={item.event}
                        skipped={item.kind === "skipped"}
                        starting={startingId === item.event.id}
                        onStart={() => void startFor(item.event)}
                        onNoMinutes={(noMinutes) =>
                          markNoMinutes(item.event, noMinutes)
                        }
                      />
                    ),
                  )}
                </ul>
              </section>
            ))
          )}
        </>
      )}

      <StartMinutesPanel open={starting} onOpenChange={setStarting} />
    </div>
  );
}

/**
 * A meeting on the calendar that ended with no minutes: its name, type and
 * day, Write minutes, and in its menu "No minutes for this meeting". Once
 * marked, it reads "No minutes", and its menu offers Write minutes.
 */
function CalendarMeetingRow({
  event,
  skipped,
  starting,
  onStart,
  onNoMinutes,
}: {
  event: CalendarMeeting;
  skipped: boolean;
  starting: boolean;
  onStart: () => void;
  onNoMinutes: (noMinutes: boolean) => void;
}) {
  const entries: RowMenuEntry[] = skipped
    ? [
        {
          type: "item",
          key: "write",
          label: MEETING_LIST_COPY.writeMinutes,
          disabled: starting,
          // Starting minutes drops the mark (`meeting_no_minutes`).
          onSelect: onStart,
        },
        {
          type: "item",
          key: "undo",
          label: MEETING_LIST_COPY.undoNoMinutes,
          onSelect: () => onNoMinutes(false),
        },
      ]
    : [
        {
          type: "item",
          key: "no-minutes",
          label: MEETING_LIST_COPY.markNoMinutes,
          onSelect: () => onNoMinutes(true),
        },
      ];
  return (
    <RowMenu entries={entries} label={MEETING_LIST_COPY.rowActions(event.name)}>
      {(menuButton) => (
        <li className="group flex min-h-14 items-center gap-3 px-2 py-2">
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate text-sm font-semibold",
                skipped && "text-muted-foreground",
              )}
            >
              {event.name}
            </span>
            <span className="block truncate text-caption text-muted-foreground">
              {meetingTypeLabel(guessMeetingType(event.name))}
              {" · "}
              {meetingWhenLabel(event.start_time)}
            </span>
            {skipped ? (
              <span className="mt-1.5 flex">
                <Badge variant="outline">{MEETING_LIST_COPY.noMinutes}</Badge>
              </span>
            ) : null}
          </span>
          {skipped ? null : (
            <Button
              size="sm"
              variant="secondary"
              disabled={starting}
              aria-busy={starting || undefined}
              aria-label={`${MEETING_LIST_COPY.writeMinutes}: ${event.name}`}
              onClick={onStart}
            >
              {MEETING_LIST_COPY.writeMinutes}
            </Button>
          )}
          {menuButton}
        </li>
      )}
    </RowMenu>
  );
}

/** Minutes, posted or a draft, with what they hold. */
function MinutesRow({
  row,
  author,
}: {
  row: MeetingSummary;
  /** Whose draft it is, named only when it isn't the viewer's own. */
  author: string | null;
}) {
  // What the minutes hold, worked out from them, as the phone's row says it
  // (`minutesRowTags`).
  const tags = minutesRowTags(row, author);
  return (
    <li>
      <Link
        href={meetingHref(row.id)}
        className={cn(
          "flex min-h-14 items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-card-hover",
          FOCUS_RING_OFFSET,
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {row.event_name}
          </span>
          <span className="block truncate text-caption text-muted-foreground">
            {meetingTypeLabel(row.meeting_type as MeetingType, row.other_label)}
            {" · "}
            {meetingDayLabel(row.event_start_time)}
          </span>
          {tags.length > 0 ? (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Badge
                  key={tag.key}
                  variant={
                    tag.key === "draft"
                      ? "warning"
                      : tag.key === "recorded"
                        ? "destructive"
                        : "outline"
                  }
                >
                  {tag.label}
                </Badge>
              ))}
            </span>
          ) : null}
          {row.gist ? (
            <span className="mt-1.5 line-clamp-2 block text-caption text-muted-foreground">
              {row.gist}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}
