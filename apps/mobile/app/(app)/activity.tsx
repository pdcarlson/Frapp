import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ACTIVITY_FILTERS,
  ACTIVITY_SECTION_NAMES,
  activityGroups,
  activityKeys,
  useActiveChapterId,
  useActivity,
  useViewerUserId,
  type ActivityFilter,
  type ActivityGroup,
  type ActivityRow,
} from "@repo/hooks";
import { describeLoadFailure } from "@repo/hooks/error-copy";
import {
  ActivitySheet,
  type ActivitySheetRow,
} from "@/components/activity/activity-sheet";
import { BACK_TO_MORE } from "@/components/back-row";
import { FilterChips } from "@/components/filter-chips";
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
import { StatusChip } from "@/components/status-chip";
import { activityBadgeHue } from "@/lib/activity/badge-hue";
import { useFrappTheme } from "@/lib/theme";

/** The chips: `null` is "All", as `FilterChips` spells it. */
const CHIPS = ACTIVITY_FILTERS.map((option) => ({
  value: option.value === "all" ? null : option.value,
  label: option.label,
}));

/**
 * Activity: what is waiting on the member and what they made, in one place
 * (#3897, `spec/behavior/activity.md`). An inbox beside chat, not a home; it
 * is reached from the More hub, whose row carries the "needs you" count.
 *
 * The phone's twin of web's `/activity`
 * (`spec/ui/web-dashboard/README.md` § Activity), on the same row model
 * (`activityGroups` in `@repo/hooks`): three groups, "Needs you" first, with
 * chips that narrow every group to one kind of thing. A row opens the record
 * in a sheet drawn with chat's own card, where the member acts on it
 * (`components/activity/activity-sheet.tsx`). A document row opens Documents;
 * a backwork row is a record only, since the phone has no Backwork screen.
 *
 * The read is never served fresh from cache (`useActivity`), and it is read
 * again when the sheet closes, because the cards write through their own
 * hooks, which this read does not hear about.
 */
export default function ActivityScreen() {
  const router = useRouter();
  const activity = useActivity();
  const viewerId = useViewerUserId();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [openedKey, setOpenedKey] = useState<string | null>(null);
  const refresh = useRefetchAll([activity]);

  const groups = useMemo(
    () => (activity.data ? activityGroups(activity.data, filter) : []),
    [activity.data, filter],
  );
  // The open row as the latest read has it. A row that has left the list (a
  // vote cast, a completion confirmed) is `null` here and the sheet keeps
  // drawing the one it was opened with, so the member sees the result of
  // what they just did.
  const openRow = useMemo(() => {
    if (openedKey === null) return null;
    const row = groups
      .flatMap((group) => group.rows)
      .find((candidate) => candidate.key === openedKey);
    return row && row.kind !== "file" ? row : null;
  }, [groups, openedKey]);
  const [opened, setOpened] = useState<ActivitySheetRow | null>(null);
  const sheetRow = openedKey === null ? null : (openRow ?? opened);

  const reread = useCallback(() => {
    if (!chapterId) return;
    void queryClient.invalidateQueries({
      queryKey: activityKeys.chapter(chapterId),
      exact: true,
    });
  }, [chapterId, queryClient]);

  const open = (row: ActivityRow) => {
    if (row.kind === "file") {
      if (row.file.source === "document") router.push("/documents");
      return;
    }
    setOpened(row);
    setOpenedKey(row.key);
  };

  function renderBody() {
    if (activity.isPending) {
      return (
        <SkeletonRegion label="Loading activity">
          <ListSection>
            {Array.from({ length: 4 }, (_, index) => (
              <ListRowSkeleton key={index} index={index} description />
            ))}
          </ListSection>
        </SkeletonRegion>
      );
    }
    // Only with nothing to show: a re-read that fails (this screen re-reads
    // after every action) keeps the list it already has.
    if (activity.isError && !activity.data) {
      return (
        <ErrorState
          title="Couldn't load your activity"
          body={describeLoadFailure(activity.error)}
          onRetry={() => void activity.refetch()}
          isRetrying={activity.isFetching}
        />
      );
    }
    return groups.map((group) =>
      // Under a chip, a group with nothing of that kind is left out rather
      // than drawn as three "nothing here" lines; "Needs you" always stays.
      filter !== "all" &&
      group.id !== "needs-you" &&
      group.rows.length === 0 &&
      group.unavailable.length === 0 ? null : (
        <GroupSection
          key={group.id}
          group={group}
          filtered={filter !== "all"}
          onOpen={open}
        />
      ),
    );
  }

  return (
    <ScreenShell back={BACK_TO_MORE} title="Activity" refresh={refresh}>
      <FilterChips
        chips={CHIPS}
        selected={filter === "all" ? null : filter}
        onSelect={(value) => setFilter((value ?? "all") as ActivityFilter)}
        accessibilityLabel="Show"
        scroll
      />
      {renderBody()}
      <ActivitySheet
        row={sheetRow}
        viewerId={viewerId}
        onActed={reread}
        onClosed={() => {
          setOpenedKey(null);
          reread();
        }}
      />
    </ScreenShell>
  );
}

function GroupSection({
  group,
  filtered,
  onOpen,
}: {
  group: ActivityGroup;
  filtered: boolean;
  onOpen: (row: ActivityRow) => void;
}) {
  const { tokens } = useFrappTheme();
  return (
    <View>
      <SectionHeader>
        {group.rows.length > 0
          ? `${group.label} · ${group.rows.length}`
          : group.label}
      </SectionHeader>
      {group.unavailable.length > 0 ? (
        // A section the read could not load is said, never shown as empty:
        // "nothing is waiting on you" must not be a failed read.
        <InlineNote>
          {`Couldn't load ${group.unavailable
            .map((section) => ACTIVITY_SECTION_NAMES[section])
            .join(", ")}. Pull down to try again.`}
        </InlineNote>
      ) : null}
      {group.rows.length === 0 ? (
        group.unavailable.length === 0 ? (
          <InlineNote>
            {filtered ? "Nothing of this kind here." : group.empty}
          </InlineNote>
        ) : null
      ) : (
        <ListSection>
          {group.rows.map((row) => {
            // A backwork file has no screen on the phone to open.
            const opens = row.kind !== "file" || row.file.source === "document";
            return (
              <ListRow
                key={row.key}
                label={row.title}
                description={row.detail || null}
                accessibilityValue={row.badge?.label}
                trailing={
                  row.badge ? (
                    <StatusChip
                      label={row.badge.label}
                      hue={activityBadgeHue(row.badge.variant, tokens)}
                    />
                  ) : undefined
                }
                onPress={opens ? () => onOpen(row) : undefined}
              />
            );
          })}
        </ListSection>
      )}
    </View>
  );
}
