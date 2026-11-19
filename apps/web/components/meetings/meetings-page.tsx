"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { codeOf } from "@repo/api-sdk";
import {
  useEvents,
  useMeetingNoteTaking,
  useMeetings,
  useMemberDisplayNames,
  useMyPermissions,
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
  minutesToWrite,
  type CalendarMeeting,
  type MeetingType,
} from "@repo/validation";
import { Can } from "@/components/shared/can";
import { PageActions } from "@/components/layout/page-actions";
import { ErrorState } from "@/components/shared/async-states";
import { InlineNote } from "@/components/shared/inline-note";
import { SectionLabel } from "@/components/shared/section-label";
import { Button } from "@/components/ui/button";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { cn } from "@/lib/utils";
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
import { getErrorMessage } from "@/lib/utils";

/** Keyed by chapter, so a switch never shows one chapter's minutes in another. */
export function MeetingsPage() {
  const chapterId = useChapterStore((state) => state.activeChapterId);
  return <ChapterMeetingsPage key={chapterId ?? "none"} />;
}

/**
 * `/meetings` (`spec/behavior/meetings.md`): the minutes this member may
 * read, newest meeting first, tied to the calendar (Paul, 2026-11-19). For
 * someone who records minutes it opens on Needs minutes: the meetings that
 * ended this month with none, each started in one press, as Granola lists
 * the calendar's meetings with no notes. Then In progress, the unposted
 * drafts, the way a mail client keeps Drafts apart from what was sent: the
 * viewer's own, and for an officer who can edit any minutes, other
 * officers' too, each named. Other officers' drafts the viewer may take
 * notes on sit under Taking notes (#4935), opening the viewer's own notes on
 * them. Then the posted minutes, and Next up, the coming meeting.
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
  // The calendar, read only by someone who can start minutes from it.
  const eventsQuery = useEvents({ enabled: canRecord });
  const [now] = useState(() => Date.now());
  const toWrite = useMemo(() => {
    const started = new Set<string>();
    for (const row of meetingsQuery.data ?? []) {
      if (row.event_id) started.add(row.event_id);
    }
    for (const row of takingQuery.data ?? []) {
      if (row.event_id) started.add(row.event_id);
    }
    const events = Array.isArray(eventsQuery.data)
      ? (eventsQuery.data as CalendarMeeting[])
      : [];
    return minutesToWrite(events, started, now);
  }, [eventsQuery.data, meetingsQuery.data, takingQuery.data, now]);
  // Unknown is not "none written": wait for both reads before listing any.
  const showToWrite =
    canRecord && eventsQuery.isSuccess && meetingsQuery.isSuccess;
  const { drafts, posted } = useMemo(() => {
    const rows = meetingsQuery.data ?? [];
    return {
      drafts: rows.filter((row) => row.status === "draft"),
      posted: rows.filter((row) => row.status === "posted"),
    };
  }, [meetingsQuery.data]);

  return (
    <div className="space-y-6">
      <Can permission="meetings:record">
        <PageActions>
          <Button onClick={() => setStarting(true)}>New minutes</Button>
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
          {showToWrite && toWrite.needs.length > 0 ? (
            <section aria-labelledby="meetings-needs" className="space-y-2">
              <SectionLabel id="meetings-needs" count={toWrite.needs.length}>
                {MEETING_LIST_COPY.needsMinutes}
              </SectionLabel>
              <ul role="list" className="divide-y divide-border">
                {toWrite.needs.map((event) => (
                  <NeedsMinutesRow key={event.id} event={event} />
                ))}
              </ul>
            </section>
          ) : null}
          {drafts.length > 0 ? (
            <section aria-labelledby="meetings-drafts" className="space-y-2">
              <SectionLabel id="meetings-drafts" count={drafts.length}>
                {MEETING_LIST_COPY.drafts}
              </SectionLabel>
              <MeetingList
                rows={drafts}
                authorOf={(row) =>
                  row.created_by && row.created_by !== viewerId
                    ? names.nameFor(row.created_by)
                    : null
                }
              />
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
          <section aria-labelledby="meetings-posted" className="space-y-2">
            <SectionLabel id="meetings-posted" count={posted.length}>
              {MEETING_LIST_COPY.posted}
            </SectionLabel>
            {posted.length === 0 ? (
              <InlineNote>{MEETING_LIST_COPY.none}</InlineNote>
            ) : (
              <MeetingList rows={posted} />
            )}
          </section>
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
        </>
      )}

      <StartMinutesPanel open={starting} onOpenChange={setStarting} />
    </div>
  );
}

/**
 * A meeting on the calendar that ended with no minutes: its name, type and
 * day, and Start minutes, which starts them on that event in one press with
 * the type its name suggests, as the event's own Minutes row does.
 */
function NeedsMinutesRow({ event }: { event: CalendarMeeting }) {
  const router = useRouter();
  const { toast } = useToast();
  const start = useStartMeeting();
  const type = guessMeetingType(event.name);

  async function begin() {
    try {
      const meeting = await start.mutateAsync({
        event_id: event.id,
        meeting_type: type,
      });
      router.push(meetingHref(meeting.id));
    } catch (error) {
      if (codeOf(error) === "meeting.already_started") {
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
    }
  }

  return (
    <li className="flex min-h-14 items-center gap-3 px-2 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {event.name}
        </span>
        <span className="block truncate text-caption text-muted-foreground">
          {meetingTypeLabel(type)}
          {" · "}
          {meetingWhenLabel(event.start_time)}
        </span>
      </span>
      <Button
        size="sm"
        variant="secondary"
        disabled={start.isPending}
        aria-label={`${MEETING_LIST_COPY.startMinutes}: ${event.name}`}
        onClick={() => void begin()}
      >
        {MEETING_LIST_COPY.startMinutes}
      </Button>
    </li>
  );
}

function MeetingList({
  rows,
  authorOf,
}: {
  rows: MeetingSummary[];
  /** Whose draft it is, named only when it isn't the viewer's own. */
  authorOf?: (row: MeetingSummary) => string | null;
}) {
  return (
    <ul role="list" className="divide-y divide-border">
      {rows.map((row) => {
        const author = authorOf?.(row);
        return (
          <li key={row.id}>
            <Link
              href={meetingHref(row.id)}
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
                  {meetingTypeLabel(
                    row.meeting_type as MeetingType,
                    row.other_label,
                  )}
                  {" · "}
                  {meetingDayLabel(row.event_start_time)}
                  {author ? ` · ${MEETING_LIST_COPY.draftOf(author)}` : null}
                  {row.status === "posted" && row.action_item_count
                    ? ` · ${MEETING_LIST_COPY.actionItems(row.action_item_count)}`
                    : null}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
