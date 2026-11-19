import { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import {
  seriesCadenceLabel,
  useEvents,
  useMeetingNoteTaking,
  useMeetings,
  useMemberDisplayNames,
  usePermissionList,
  useViewerUserId,
} from "@repo/hooks";
import {
  MEETING_COPY,
  MEETING_LIST_COPY,
  can,
  guessMeetingType,
  isBetaOffModule,
  meetingTypeLabel,
  meetingWhenLabel,
  minutesToWrite,
  startedEventIds,
  type CalendarMeeting,
  type MeetingType,
} from "@repo/validation";
import { BACK_TO_YOU } from "@/components/back-row";
import { FilterChips, SearchField } from "@/components/filter-chips";
import { InlineNote } from "@/components/inline-note";
import {
  ListRow,
  ListRowSkeleton,
  ListSection,
  SectionHeader,
} from "@/components/list-section";
import {
  MeetingTypeTile,
  MinutesRow,
  useMeetingTypeHue,
} from "@/components/minutes/minutes-row";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { useMeetingQuickActions } from "@/components/quick-actions/meeting-actions";
import { NOTICE_MS } from "@/components/quick-actions/quick-actions-host";
import { ScreenShell } from "@/components/screen-shell";
import { ErrorState, SkeletonRegion } from "@/components/state-block";
import { useMeetingsOn } from "@/lib/minutes/meetings-on";
import {
  MinutesStartError,
  useStartMinutesFor,
} from "@/lib/minutes/start-minutes";
import {
  minutesListView,
  minutesRowTime,
  showsTypeTag,
  type MinutesListRow,
} from "@/lib/minutes/minutes-list";
import { useFrappTheme } from "@/lib/theme";

/**
 * The chapter's minutes a member may read (`spec/behavior/meetings.md`;
 * `spec/ui/mobile/screens.md` § Minutes), reached from You.
 *
 * Rebuilt for #5290 (Paul, 2026-11-17: "better grouping ... by like type of
 * event ... group it by recurring event ... maybe some more tags ... It just
 * seems like a very dull interface"). Granola's notes list, Fireflies'
 * channels for recurring meetings and Voice Memos' bottom record button are
 * the models:
 * - every row leads with a tile in its meeting type's hue, keeps the time
 *   on the right, and carries tags worked out from the minutes (Draft,
 *   Recorded, decisions and action items);
 * - a few minutes read as drafts, then This week, Last week and Earlier;
 * - past eight, a search field, the types as chips with their counts (tap
 *   one to show only that type, tap again for all), a Series section where
 *   a repeating event with two or more minutes is one row opening its own
 *   list, then month groups.
 * An officer who records minutes gets the floating "+", which opens the
 * same New minutes the tab bar's + does, Record first.
 *
 * Tied to the calendar (Paul, 2026-11-19), as web's Meetings is: for an
 * officer who records minutes the list opens on Needs minutes, the
 * meetings that ended in the last 30 days with none, each started in one tap, and
 * ends on Next up, the coming meeting (`minutesToWrite`).
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
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens.spacing.sm);
  const meetingsQuery = useMeetings();
  const viewerId = useViewerUserId();
  const names = useMemberDisplayNames();
  const on = useMeetingsOn();
  const canRecord = can("meetings:record", usePermissionList());
  // The calendar and notes the viewer was added to, read only by someone
  // who can start minutes from them.
  const eventsQuery = useEvents({ enabled: on && canRecord });
  const takingQuery = useMeetingNoteTaking({ enabled: on && canRecord });
  const refresh = useRefetchAll([meetingsQuery, eventsQuery, takingQuery]);
  const starter = useStartMinutesFor();
  const [startingId, setStartingId] = useState<string | null>(null);
  // Events whose start answered "already started": someone else's draft
  // this viewer can't read, so the list can't see it and Start can't win.
  const [taken, setTaken] = useState<ReadonlySet<string>>(() => new Set());
  // What New minutes has to say (a read that failed, a recording already
  // held): shown a few seconds and read out, as the tab bar's + does.
  const [notice, setNotice] = useState<string | null>(null);
  const meetingActions = useMeetingQuickActions({
    confirm: (text) => {
      setNotice(text);
      AccessibilityInfo.announceForAccessibility(text);
    },
  });
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  const [type, setType] = useState<MeetingType | null>(null);
  const [query, setQuery] = useState("");
  // The clock as the screen opened: groups and times stay put while it is open.
  const [now] = useState(Date.now);
  const rows: MinutesListRow[] = useMemo(
    () => meetingsQuery.data ?? [],
    [meetingsQuery.data],
  );
  const view = minutesListView(rows, { now, type, query });
  const toWrite = useMemo(() => {
    const started = startedEventIds(rows, takingQuery.data);
    for (const id of taken) started.add(id);
    const events = Array.isArray(eventsQuery.data)
      ? (eventsQuery.data as CalendarMeeting[])
      : [];
    return minutesToWrite(events, started, now);
  }, [rows, takingQuery.data, eventsQuery.data, taken, now]);
  // Unknown is not "none written": every read answers before any is listed,
  // and a search or a type chip narrows to minutes, not the calendar.
  const showToWrite =
    on &&
    canRecord &&
    eventsQuery.isSuccess &&
    meetingsQuery.isSuccess &&
    takingQuery.isSuccess &&
    !query.trim() &&
    type === null;

  async function startFor(event: CalendarMeeting) {
    // One at a time: the row that is starting says so, the rest wait.
    if (startingId) return;
    setStartingId(event.id);
    try {
      const meeting = await starter.start({
        kind: "event",
        event: { id: event.id, name: event.name },
      });
      open(meeting.id);
    } catch (error) {
      if (error instanceof MinutesStartError && error.alreadyStarted) {
        setTaken((current) => new Set(current).add(event.id));
        void meetingsQuery.refetch();
        void takingQuery.refetch();
      }
      const text =
        error instanceof Error ? error.message : MEETING_COPY.tryAgain;
      setNotice(text);
      AccessibilityInfo.announceForAccessibility(text);
    } finally {
      setStartingId(null);
    }
  }

  const open = (id: string) =>
    router.push({ pathname: "/minutes-details", params: { id } });

  const row = (meeting: MinutesListRow) => {
    const author =
      meeting.status === "draft" &&
      meeting.created_by &&
      meeting.created_by !== viewerId
        ? names.nameFor(meeting.created_by)
        : null;
    return (
      <MinutesRow
        key={meeting.id}
        title={meeting.event_name}
        type={meeting.meeting_type}
        otherLabel={meeting.other_label}
        time={minutesRowTime(meeting.event_start_time, now)}
        draft={meeting.status === "draft"}
        recorded={meeting.recorded}
        decisions={meeting.decision_count}
        actionItems={meeting.action_item_count}
        byline={author ? MEETING_LIST_COPY.draftOf(author) : null}
        showType={showsTypeTag(meeting, type)}
        onPress={() => open(meeting.id)}
      />
    );
  };

  const shownCount =
    view.drafts.length +
    view.groups.reduce((sum, group) => sum + group.rows.length, 0);

  return (
    <>
      <ScreenShell
        back={BACK_TO_YOU}
        title={MEETING_LIST_COPY.title}
        refresh={refresh}
        keyboardShouldPersistTaps="handled"
        createAction={
          on && canRecord
            ? {
                label: MEETING_LIST_COPY.newMinutes,
                hint: MEETING_LIST_COPY.newMinutesHint,
                onPress: meetingActions.newMinutes,
              }
            : undefined
        }
      >
        {notice ? <InlineNote>{notice}</InlineNote> : null}
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
            {showToWrite && toWrite.needs.length > 0 ? (
              <>
                <SectionHeader count={toWrite.needs.length}>
                  {MEETING_LIST_COPY.needsMinutes}
                </SectionHeader>
                <ListSection>
                  {toWrite.needs.map((event) => (
                    <ListRow
                      key={event.id}
                      leading={
                        <MeetingTypeTile type={guessMeetingType(event.name)} />
                      }
                      label={event.name}
                      description={calendarLine(event)}
                      value={MEETING_LIST_COPY.startMinutes}
                      accessibilityHint={MEETING_LIST_COPY.startMinutes}
                      busy={startingId === event.id}
                      onPress={() => void startFor(event)}
                    />
                  ))}
                </ListSection>
              </>
            ) : null}

            {rows.length === 0 ? (
              <InlineNote>{MEETING_LIST_COPY.none}</InlineNote>
            ) : null}

            {view.many ? (
              <View style={styles.finders}>
                <SearchField
                  value={query}
                  onChangeText={setQuery}
                  placeholder={MEETING_LIST_COPY.search}
                  accessibilityLabel={MEETING_LIST_COPY.search}
                  searchGlyph
                />
                {view.types.length > 1 ? (
                  <FilterChips
                    scroll
                    accessibilityLabel={MEETING_LIST_COPY.types}
                    selected={type}
                    onSelect={(next) =>
                      // A second tap on the lit type shows them all again.
                      setType(
                        next === type ? null : (next as MeetingType | null),
                      )
                    }
                    chips={[
                      {
                        value: null,
                        label: MEETING_LIST_COPY.allTypes,
                        count: rows.length,
                      },
                      ...view.types.map(({ type: key, count }) => ({
                        value: key,
                        label: meetingTypeLabel(key),
                        count,
                        mark: <TypeDot type={key} />,
                      })),
                    ]}
                  />
                ) : null}
              </View>
            ) : null}

            {view.drafts.length > 0 ? (
              <>
                <SectionHeader>{MEETING_LIST_COPY.drafts}</SectionHeader>
                <ListSection>{view.drafts.map(row)}</ListSection>
              </>
            ) : null}

            {view.series.length > 0 ? (
              <>
                <SectionHeader>{MEETING_LIST_COPY.series}</SectionHeader>
                <ListSection>
                  {view.series.map((series) => (
                    <ListRow
                      key={series.key}
                      leading={<MeetingTypeTile type={series.type} />}
                      label={series.name}
                      description={[
                        seriesCadenceLabel(
                          series.rule,
                          series.last,
                          series.starts,
                        ),
                        MEETING_LIST_COPY.minutesCount(series.count),
                        MEETING_LIST_COPY.lastOn(
                          minutesRowTime(series.last, now),
                        ),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      onPress={() =>
                        router.push({
                          pathname: "/minutes-series",
                          params: { key: series.key },
                        })
                      }
                    />
                  ))}
                </ListSection>
              </>
            ) : null}

            {view.groups.map((group) => (
              <View key={group.key}>
                <SectionHeader>{group.label}</SectionHeader>
                <ListSection>{group.rows.map(row)}</ListSection>
              </View>
            ))}

            {view.narrowed && shownCount === 0 ? (
              <InlineNote>{MEETING_LIST_COPY.nothingMatches}</InlineNote>
            ) : null}

            {showToWrite && toWrite.next ? (
              <>
                <SectionHeader>{MEETING_LIST_COPY.nextUp}</SectionHeader>
                <ListSection>
                  <ListRow
                    leading={
                      <MeetingTypeTile
                        type={guessMeetingType(toWrite.next.name)}
                      />
                    }
                    label={toWrite.next.name}
                    description={calendarLine(toWrite.next)}
                    value={MEETING_LIST_COPY.openEvent}
                    accessibilityHint={MEETING_LIST_COPY.openEvent}
                    onPress={() =>
                      router.push({
                        pathname: "/event-details",
                        params: { id: toWrite.next!.id },
                      })
                    }
                  />
                </ListSection>
              </>
            ) : null}
          </>
        )}
      </ScreenShell>
      {meetingActions.sheets}
    </>
  );
}

/** A calendar meeting's line, as web's: the type its name suggests, and when. */
function calendarLine(event: CalendarMeeting): string {
  return `${meetingTypeLabel(guessMeetingType(event.name))} · ${meetingWhenLabel(event.start_time)}`;
}

/** A type chip's mark: a dot in the type's hue. */
function TypeDot({ type }: { type: MeetingType }) {
  const { tokens } = useFrappTheme();
  const hue = useMeetingTypeHue()(type) ?? tokens.color.text.mutedForeground;
  return <View style={[dotStyles.dot, { backgroundColor: hue }]} />;
}

const dotStyles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4 },
});

function createStyles(gap: number) {
  return StyleSheet.create({
    finders: {
      gap,
    },
  });
}
