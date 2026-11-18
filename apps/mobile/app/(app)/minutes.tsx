import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import {
  seriesCadenceLabel,
  useMeetings,
  useMemberDisplayNames,
  usePermissionList,
  useViewerUserId,
} from "@repo/hooks";
import {
  MEETING_LIST_COPY,
  can,
  isBetaOffModule,
  meetingTypeLabel,
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
import { ScreenShell } from "@/components/screen-shell";
import { ErrorState, SkeletonRegion } from "@/components/state-block";
import { useMeetingsOn } from "@/lib/minutes/meetings-on";
import {
  minutesListView,
  minutesRowTime,
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
  const refresh = useRefetchAll([meetingsQuery]);
  const on = useMeetingsOn();
  const canRecord = can("meetings:record", usePermissionList());
  const [notice, setNotice] = useState<string | null>(null);
  const meetingActions = useMeetingQuickActions({ confirm: setNotice });
  const [type, setType] = useState<MeetingType | null>(null);
  const [query, setQuery] = useState("");
  // The clock as the screen opened: groups and times stay put while it is open.
  const [now] = useState(Date.now);
  const rows: MinutesListRow[] = useMemo(
    () => meetingsQuery.data ?? [],
    [meetingsQuery.data],
  );
  const view = minutesListView(rows, { now, type, query });

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
        ) : rows.length === 0 ? (
          <InlineNote>{MEETING_LIST_COPY.none}</InlineNote>
        ) : (
          <>
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
          </>
        )}
      </ScreenShell>
      {meetingActions.sheets}
    </>
  );
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
