import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useRouter } from "expo-router";
import {
  ACTIVITY_FILTERS,
  ACTIVITY_SECTION_NAMES,
  activityGroups,
  useActivity,
  useClearActivityLinkState,
  useMyPermissions,
  useRemoveActivityLink,
  useRestoreActivityLink,
  useSetActivityLinkState,
  useViewerUserId,
  type ActivityFilter,
  type ActivityGroup,
  type ActivityRow,
} from "@repo/hooks";
import { describeLoadFailure, errorCopy } from "@repo/hooks/error-copy";
import { can } from "@repo/validation";
import {
  ActivitySheet,
  type ActivitySheetRow,
  type LinkSheetActions,
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
import { UNDO_WINDOW_MS, UndoBar } from "@/components/tasks/undo-bar";
import { activityBadgeHue } from "@/lib/activity/badge-hue";
import { useActivityReread } from "@/lib/activity/use-activity-reread";
import { openMessageLink } from "@/lib/chat/open-link";
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
 * (`activityGroups` in `@repo/hooks`): four groups, "Needs you" first, with
 * chips that narrow every group to one kind of thing. A row opens the record
 * in a sheet drawn with chat's own card, where the member acts on it
 * (`components/activity/activity-sheet.tsx`). A document row opens Documents;
 * a backwork row is a record only, since the phone has no Backwork screen.
 *
 * The read is never served fresh from cache (`useActivity`). It is read
 * again when the sheet closes, because the cards write through their own
 * hooks, which this read does not hear about, and whenever the member comes
 * back to this screen (`useActivityReread`).
 */
export default function ActivityScreen() {
  const router = useRouter();
  const activity = useActivity();
  const viewerId = useViewerUserId();
  // Also on every return to this screen: it stays mounted under the thread
  // or Documents it pushes, and a vote cast there is not heard here.
  const reread = useActivityReread();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [openedKey, setOpenedKey] = useState<string | null>(null);
  const refresh = useRefetchAll([activity]);
  const { linkActions, undo, rereadOnClose } = useLinkActions();

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
    <>
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
            if (rereadOnClose()) reread();
          }}
          linkActions={linkActions}
        />
      </ScreenShell>
      {undo ? (
        <UndoBar key={undo.key} message={undo.message} onUndo={undo.run} />
      ) : null}
    </>
  );
}

/**
 * The sign-up link writes (`spec/behavior/activity.md` § Links), owned by the
 * screen: each takes the row off the list at once, which closes its sheet,
 * and the "Undo" bar that follows (the tasks board's, for the same few
 * seconds) has to outlive the sheet. Remove is `channels:manage`'s, as in
 * chat. A write that fails puts the row back and says so.
 */
function useLinkActions() {
  const router = useRouter();
  const permissions = useMyPermissions();
  const markDone = useSetActivityLinkState("done");
  const hide = useSetActivityLinkState("hidden");
  const clearState = useClearActivityLinkState();
  const remove = useRemoveActivityLink();
  const restore = useRestoreActivityLink();
  const [undo, setUndo] = useState<{
    message: string;
    run: () => void;
    key: number;
  } | null>(null);
  const skipCloseReread = useRef(false);
  useEffect(() => {
    if (!undo) return undefined;
    const timer = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  type LinkRow = Extract<ActivityRow, { kind: "link" }>;
  // Each write's own promise, not `mutate`'s per-call callbacks, which a
  // second Done before the first answers would cancel (`useLinkWrite`).
  type Write = { mutateAsync: (id: string) => Promise<unknown> };
  const failed = (title: string) => (error: unknown) =>
    Alert.alert(title, errorCopy(error));
  const act =
    (write: Write, message: string, takeBack: Write, failure: string) =>
    (row: LinkRow) => {
      // The sheet closes as this starts; the write re-reads Activity itself
      // when it settles, and a re-read on close would race it.
      skipCloseReread.current = true;
      write.mutateAsync(row.link.id).then(
        () =>
          setUndo((open) => ({
            message,
            // A new key per action, so the bar is announced again.
            key: (open?.key ?? 0) + 1,
            run: () => {
              setUndo(null);
              takeBack.mutateAsync(row.link.id).catch(failed("Couldn't undo"));
            },
          })),
        failed(failure),
      );
    };

  const linkActions: LinkSheetActions = {
    canRemove: can("channels:manage", permissions.data?.permissions ?? []),
    open: (row) => void openMessageLink(row.link.url),
    done: act(markDone, "Marked done", clearState, "Couldn't mark it done"),
    hide: act(hide, "Hidden", clearState, "Couldn't hide it"),
    remove: act(
      remove,
      "Removed from everyone's Activity",
      restore,
      "Couldn't remove it",
    ),
    openInChat: (row) =>
      // A thread reply isn't on the channel's timeline: open its thread.
      router.push({
        pathname: "/chat-thread",
        params: row.link.thread_root_id
          ? {
              channelId: row.link.channel_id,
              threadRootId: row.link.thread_root_id,
            }
          : { channelId: row.link.channel_id },
      }),
  };
  /** Whether the sheet's close should re-read; false once after a link write. */
  const rereadOnClose = () => {
    const skip = skipCloseReread.current;
    skipCloseReread.current = false;
    return !skip;
  };
  return { linkActions, undo, rereadOnClose };
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
