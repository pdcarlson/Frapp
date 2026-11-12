import { useMemo } from "react";
import { Redirect, useRouter } from "expo-router";
import {
  useMeetings,
  useMemberDisplayNames,
  useViewerUserId,
  type MeetingSummary,
} from "@repo/hooks";
import { MEETING_LIST_COPY, meetingTitleLine , isBetaOffModule } from "@repo/validation";
import { BACK_TO_YOU } from "@/components/back-row";
import { InlineNote } from "@/components/inline-note";
import {
  ListRow,
  ListRowSkeleton,
  ListSection,
  SectionHeader,
} from "@/components/list-section";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { ScreenShell } from "@/components/screen-shell";
import { ErrorState, SkeletonRegion } from "@/components/state-block";

/**
 * The chapter's minutes a member may read (`spec/behavior/meetings.md`;
 * #4312), reached from More. Drafts the member may open sit first, then
 * posted minutes, newest first, as web's Meetings page lists them.
 *
 * A compact list: the event's name, and under it what kind of meeting and
 * the day, written out. No preview of the minutes themselves.
 */
export default function MinutesScreen() {
  // More, the event row and the push all hide while `meetings` is off for the
  // beta; this catches a way in that skips them (a typed link), where the
  // server would only refuse. A chapter's own switch doesn't close the
  // screen, so minutes already posted stay readable from a notification.
  if (isBetaOffModule("meetings")) return <Redirect href="/you" />;
  return <MinutesScreenBody />;
}

function MinutesScreenBody() {
  const router = useRouter();
  const meetingsQuery = useMeetings();
  const viewerId = useViewerUserId();
  const names = useMemberDisplayNames();
  const refresh = useRefetchAll([meetingsQuery]);
  const { drafts, posted } = useMemo(() => {
    const rows = meetingsQuery.data ?? [];
    return {
      drafts: rows.filter((row) => row.status === "draft"),
      posted: rows.filter((row) => row.status === "posted"),
    };
  }, [meetingsQuery.data]);

  const row = (meeting: MeetingSummary) => {
    const author =
      meeting.status === "draft" &&
      meeting.created_by &&
      meeting.created_by !== viewerId
        ? names.nameFor(meeting.created_by)
        : null;
    return (
      <ListRow
        key={meeting.id}
        label={meeting.event_name}
        description={[
          meetingTitleLine(meeting),
          author ? MEETING_LIST_COPY.draftOf(author) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        onPress={() =>
          router.push({
            pathname: "/minutes-details",
            params: { id: meeting.id },
          })
        }
      />
    );
  };

  return (
    <ScreenShell
      back={BACK_TO_YOU}
      title={MEETING_LIST_COPY.title}
      refresh={refresh}
    >
      {meetingsQuery.isPending ? (
        <SkeletonRegion label="Loading minutes">
          <ListSection>
            {[0, 1, 2, 3].map((index) => (
              <ListRowSkeleton key={index} index={index} description />
            ))}
          </ListSection>
        </SkeletonRegion>
      ) : meetingsQuery.isError && !meetingsQuery.data ? (
        <ErrorState
          title={MEETING_LIST_COPY.loadFailedTitle}
          body={MEETING_LIST_COPY.loadFailedBody}
          onRetry={() => void meetingsQuery.refetch()}
          isRetrying={meetingsQuery.isFetching}
        />
      ) : (
        <>
          {drafts.length > 0 ? (
            <>
              <SectionHeader>{MEETING_LIST_COPY.drafts}</SectionHeader>
              <ListSection>{drafts.map(row)}</ListSection>
            </>
          ) : null}
          {posted.length > 0 ? (
            <>
              {drafts.length > 0 ? (
                <SectionHeader>{MEETING_LIST_COPY.posted}</SectionHeader>
              ) : null}
              <ListSection>{posted.map(row)}</ListSection>
            </>
          ) : (
            <InlineNote>{MEETING_LIST_COPY.none}</InlineNote>
          )}
        </>
      )}
    </ScreenShell>
  );
}
