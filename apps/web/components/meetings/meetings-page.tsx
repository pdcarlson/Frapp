"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  useMeetings,
  useMemberDisplayNames,
  useMyPermissions,
  useViewerUserId,
  type MeetingSummary,
} from "@repo/hooks";
import {
  MEETING_LIST_COPY,
  can,
  meetingTypeLabel,
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
} from "@/components/meetings/meeting-copy";

/** Keyed by chapter, so a switch never shows one chapter's minutes in another. */
export function MeetingsPage() {
  const chapterId = useChapterStore((state) => state.activeChapterId);
  return <ChapterMeetingsPage key={chapterId ?? "none"} />;
}

/**
 * `/meetings` (`spec/behavior/meetings.md`): the minutes this member may
 * read, newest meeting first. Unposted drafts sit above the rest, the way a
 * mail client keeps Drafts apart from what was sent: the viewer's own, and
 * for an officer who can edit any minutes, other officers' too, each named.
 */
function ChapterMeetingsPage() {
  const meetingsQuery = useMeetings();
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
          <section aria-labelledby="meetings-posted" className="space-y-2">
            <SectionLabel id="meetings-posted" count={posted.length}>
              {MEETING_LIST_COPY.posted}
            </SectionLabel>
            {posted.length === 0 ? (
              <InlineNote>
                {MEETING_LIST_COPY.none}
              </InlineNote>
            ) : (
              <MeetingList rows={posted} />
            )}
          </section>
        </>
      )}

      <StartMinutesPanel open={starting} onOpenChange={setStarting} />
    </div>
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
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
