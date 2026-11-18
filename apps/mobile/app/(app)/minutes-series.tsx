import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import {
  seriesCadenceLabel,
  useMeeting,
  useMeetingActionItemTasks,
  useMeetings,
  useMemberDisplayNames,
} from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import { SignetTokens } from "@repo/theme/signet";
import {
  MEETING_COPY,
  MEETING_LIST_COPY,
  isBetaOffModule,
  meetingDueLabel,
  readMeetingContent,
} from "@repo/validation";
import type { BackTarget } from "@/components/back-row";
import { InlineNote } from "@/components/inline-note";
import {
  ListRowSkeleton,
  ListSection,
  SectionHeader,
} from "@/components/list-section";
import { MinutesRow } from "@/components/minutes/minutes-row";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { ScreenShell } from "@/components/screen-shell";
import { ErrorState, SkeletonRegion } from "@/components/state-block";
import {
  minutesRowTime,
  openActionItems,
  seriesRows,
  type MinutesListRow,
} from "@/lib/minutes/minutes-list";
import { typeRole, useFrappTheme } from "@/lib/theme";

const BACK_TO_MINUTES: BackTarget = { label: "Minutes", href: "/minutes" };

/**
 * One repeating meeting's minutes (#5290), opened from the Minutes list's
 * Series row: the action items still open across all its posted minutes,
 * newest meeting first, then its meetings by date. That is the question a
 * weekly meeting asks ("what did we say we'd do?"); Granola keeps a recurring
 * meeting's earlier notes beside the new one in the same spirit.
 *
 * Open is Tasks' answer (#5482; Paul's pick, 2026-11-18): an item is open
 * until the suggested task it became is done, and an item nobody made a task
 * of stays open (`openActionItems`). Only minutes the list says hold action
 * items are read.
 */
export default function MinutesSeriesScreen() {
  if (isBetaOffModule("meetings")) return <Redirect href="/you" />;
  return <MinutesSeriesBody />;
}

function MinutesSeriesBody() {
  const router = useRouter();
  const params = useLocalSearchParams<{ key?: string | string[] }>();
  const key = Array.isArray(params.key) ? params.key[0] : (params.key ?? "");
  const meetingsQuery = useMeetings();
  const refresh = useRefetchAll([meetingsQuery]);
  // The clock as the screen opened: groups and times stay put while it is open.
  const [now] = useState(Date.now);
  const rows: MinutesListRow[] = seriesRows(meetingsQuery.data ?? [], key);
  const newest = rows[0];

  if (meetingsQuery.isPending) {
    return (
      <ScreenShell back={BACK_TO_MINUTES} title={MEETING_LIST_COPY.series}>
        <SkeletonRegion label="Loading minutes">
          <ListSection>
            {[0, 1, 2].map((index) => (
              <ListRowSkeleton key={index} index={index} description />
            ))}
          </ListSection>
        </SkeletonRegion>
      </ScreenShell>
    );
  }
  if (meetingsQuery.isError && !meetingsQuery.data) {
    return (
      <ScreenShell back={BACK_TO_MINUTES} title={MEETING_LIST_COPY.series}>
        <ErrorState
          title={MEETING_LIST_COPY.loadFailedTitle}
          body={MEETING_LIST_COPY.loadFailedBody}
          onRetry={() => void meetingsQuery.refetch()}
          isRetrying={meetingsQuery.isFetching}
        />
      </ScreenShell>
    );
  }
  if (!newest) {
    return (
      <ScreenShell back={BACK_TO_MINUTES} title={MEETING_LIST_COPY.series}>
        <InlineNote>{MEETING_COPY.missingBody}</InlineNote>
      </ScreenShell>
    );
  }

  const cadence = seriesCadenceLabel(
    newest.series_rule,
    newest.event_start_time,
    rows.map((row) => row.event_start_time),
  );
  const sources = rows.filter(
    (row) => row.status === "posted" && row.action_item_count > 0,
  );
  const years = new Map<number, MinutesListRow[]>();
  for (const row of rows) {
    const year = new Date(row.event_start_time).getFullYear();
    years.set(year, [...(years.get(year) ?? []), row]);
  }

  return (
    <ScreenShell
      back={BACK_TO_MINUTES}
      title={newest.event_name}
      subtitle={[cadence, MEETING_LIST_COPY.minutesCount(rows.length)]
        .filter(Boolean)
        .join(" · ")}
      refresh={refresh}
    >
      {sources.length > 0 ? (
        <OpenActionItems sources={sources} now={now} />
      ) : null}
      {[...years.entries()].map(([year, members]) => (
        <View key={year}>
          <SectionHeader>{String(year)}</SectionHeader>
          <ListSection>
            {members.map((row) => (
              <MinutesRow
                key={row.id}
                title={minutesRowTime(row.event_start_time, now)}
                type={row.meeting_type}
                otherLabel={row.other_label}
                time=""
                draft={row.status === "draft"}
                recorded={row.recorded}
                decisions={row.decision_count}
                actionItems={row.action_item_count}
                onPress={() =>
                  router.push({
                    pathname: "/minutes-details",
                    params: { id: row.id },
                  })
                }
              />
            ))}
          </ListSection>
        </View>
      ))}
    </ScreenShell>
  );
}

/**
 * The series' open action items: each source minutes' own card, and a line
 * once every one of them has answered with nothing open.
 */
function OpenActionItems({
  sources,
  now,
}: {
  sources: MinutesListRow[];
  now: number;
}) {
  // How many each source has open, once it has answered.
  const [open, setOpen] = useState<Record<string, number>>({});
  const report = useCallback((id: string, count: number) => {
    setOpen((before) =>
      before[id] === count ? before : { ...before, [id]: count },
    );
  }, []);
  const answered = sources.every((source) => open[source.id] !== undefined);
  const none = answered && sources.every((source) => open[source.id] === 0);
  return (
    <>
      <SectionHeader>{MEETING_LIST_COPY.seriesActions}</SectionHeader>
      {sources.map((source) => (
        <SourceOpenItems
          key={source.id}
          id={source.id}
          day={minutesRowTime(source.event_start_time, now)}
          onCount={report}
        />
      ))}
      {none ? (
        <InlineNote>{MEETING_LIST_COPY.seriesActionsNone}</InlineNote>
      ) : null}
    </>
  );
}

/**
 * One posted minutes' open action items, as their own card: what, who, when
 * it's due, how a task for everyone is going, and from when. A row's shape
 * while they load; a line if they can't; nothing once none is open.
 */
function SourceOpenItems({
  id,
  day,
  onCount,
}: {
  id: string;
  day: string;
  onCount: (id: string, count: number) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const names = useMemberDisplayNames();
  const meetingQuery = useMeeting(id);
  const tasksQuery = useMeetingActionItemTasks(id);
  const meeting = meetingQuery.data;
  const tasks = tasksQuery.data;
  const open =
    meeting && tasks
      ? openActionItems(readMeetingContent(meeting.content).action_items, tasks)
      : null;
  const count = open?.length ?? null;
  useEffect(() => {
    if (count !== null) onCount(id, count);
  }, [count, id, onCount]);

  if (!open) {
    return meetingQuery.isPending || tasksQuery.isPending ? (
      <ListSection>
        <ListRowSkeleton index={0} description />
      </ListSection>
    ) : (
      <InlineNote tone="warning">
        {MEETING_LIST_COPY.loadFailedTitle}
      </InlineNote>
    );
  }
  if (open.length === 0) return null;
  return (
    <ListSection>
      {open.map(({ item, index, group }) => (
        <View key={`${id}-${index}`} style={styles.item}>
          <Text style={styles.text}>{item.text}</Text>
          <Text style={styles.meta}>
            {[
              item.owner_user_id
                ? memberLabel(
                    names.nameFor(item.owner_user_id),
                    item.owner_user_id,
                  )
                : MEETING_LIST_COPY.noOwner,
              item.due_date ? meetingDueLabel(item.due_date) : null,
              group
                ? MEETING_LIST_COPY.seriesActionsGroup(group.done, group.total)
                : null,
              MEETING_LIST_COPY.seriesActionsFrom(day),
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
      ))}
    </ListSection>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    item: {
      gap: tokens.spacing.xs,
      paddingVertical: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
    },
    text: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
