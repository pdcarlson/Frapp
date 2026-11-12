import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { SignetTokens } from "@repo/theme/signet";
import { useRouter } from "expo-router";
import {
  ACTIVITY_FILTERS,
  ACTIVITY_SECTION_NAMES,
  activityFilterAvailable,
  activityGroups,
  activitySummary,
  useActivity,
  useActivityUnread,
  useNowDate,
  useCurrentChapter,
  useClearActivityLinkState,
  useMyPermissions,
  useRemoveActivityLink,
  useRestoreActivityLink,
  useSetActivityLinkState,
  useViewerUserId,
  useActivityFaces,
  type ActivityFilter,
  type ActivityGroup,
  type ActivityPart,
  type ActivityRow,
} from "@repo/hooks";
import { describeLoadFailure, errorCopy } from "@repo/hooks/error-copy";
import { can, isModuleEnabled } from "@repo/validation";
import {
  ActivityFaces,
  ActivityListRow,
  ActivityRowSkeleton,
} from "@/components/activity/activity-row";
import {
  ActivityRowItem,
  useActivityRowActions,
  type ActivityRowActions,
} from "@/components/activity/activity-row-action";
import {
  ActivitySheet,
  type LinkSheetActions,
} from "@/components/activity/activity-sheet";
import {
  ActivitySummary,
  ActivitySummarySkeleton,
} from "@/components/activity/activity-summary";
import { BACK_TO_MORE } from "@/components/back-row";
import { FilterChips } from "@/components/filter-chips";
import { InlineNote } from "@/components/inline-note";
import { SectionCount, SectionHeader } from "@/components/list-section";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { ScreenShell } from "@/components/screen-shell";
import { ErrorState, SkeletonRegion } from "@/components/state-block";
import { UNDO_WINDOW_MS, UndoBar } from "@/components/tasks/undo-bar";
import { activityRowActionsAllowed } from "@/lib/activity/row-action";
import { useActivityReread } from "@/lib/activity/use-activity-reread";
import { useChapterBranding } from "@/lib/chapter-branding";
import { openMessageLink } from "@/lib/chat/open-link";
import {
  storeActivityFilter,
  useStoredActivityFilter,
} from "@/lib/activity/activity-filter";
import { typeRole, useFrappTheme } from "@/lib/theme";

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
 * (`activityGroups` and `activitySummary` in `@repo/hooks`): a summary
 * ("8 things need you") with a count tile per kind of ask, then four groups,
 * "Needs you" first and split into Now and Later, with chips that narrow
 * every group to one kind of thing (#4173). A row opens the record
 * in a sheet drawn with chat's own card, where the member acts on it
 * (`components/activity/activity-sheet.tsx`). A closed poll leaves its list
 * for Archived polls under Made by you (#4258).
 *
 * The read is never served fresh from cache (`useActivity`). It is read
 * again when the sheet closes, because the cards write through their own
 * hooks, which this read does not hear about, and whenever the member comes
 * back to this screen (`useActivityReread`).
 */
export default function ActivityScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const activity = useActivity();
  // The shared 30s clock the poll cards read: a poll whose time runs out
  // leaves its section within a tick, without a re-read (#4258), and Now and
  // Later and Next up stay current while the page is open.
  const now = useNowDate();
  const viewerId = useViewerUserId();
  // Faces on the rows (#4402, item 4), from the roster chat already reads.
  const faceFor = useActivityFaces();
  // Also on every return to this screen: it stays mounted under the thread
  // or event details it pushes, and a vote cast there is not heard here.
  const reread = useActivityReread();
  // The chip picked on this visit wins; until then, the one the member
  // last left the screen on, on this phone (#4402).
  const stored = useStoredActivityFilter();
  const [picked, setPicked] = useState<ActivityFilter | null>(null);
  const chapterModules = useCurrentChapter().data?.enabled_modules;
  const moduleOn = useCallback(
    (key: string) => isModuleEnabled(chapterModules, key),
    [chapterModules],
  );
  // A stored chip whose module the chapter has since turned off opens on All.
  const filter: ActivityFilter =
    picked ?? (activityFilterAvailable(stored, moduleOn) ? stored : "all");
  const setFilter = (next: ActivityFilter) => {
    setPicked(next);
    // Clearing the To confirm tile isn't a pick: the stored chip stays.
    if (!(filter === "confirm" && next === "all")) storeActivityFilter(next);
  };
  const chips = useMemo(
    () =>
      CHIPS.filter((chip) =>
        activityFilterAvailable(
          (chip.value ?? "all") as ActivityFilter,
          moduleOn,
        ),
      ),
    [moduleOn],
  );
  const [openedKey, setOpenedKey] = useState<string | null>(null);
  const refresh = useRefetchAll([activity]);
  const { linkActions, undo, rereadOnClose } = useLinkActions();

  const permissions = useMyPermissions().data?.permissions;
  const chapterRead = useCurrentChapter();
  const chapter = chapterRead.data;
  const groups = useMemo(
    () => (activity.data ? activityGroups(activity.data, filter, now) : []),
    [activity.data, filter, now],
  );
  // The tiles a member is never asked about (To confirm, Hours to approve)
  // show only to the roles that are; a module the chapter has off shows none.
  const summary = useMemo(
    () =>
      activity.data
        ? activitySummary(
            activity.data,
            {
              canConfirmTasks: can("tasks:manage", permissions ?? []),
              canApproveHours: can("service:approve", permissions ?? []),
              isModuleEnabled: chapter
                ? (key) => isModuleEnabled(chapter.enabled_modules, key)
                : undefined,
            },
            now,
          )
        : null,
    [activity.data, permissions, chapter, now],
  );
  // The open row as the latest read has it. A row that has left the list (a
  // vote cast, a completion confirmed) is `null` here and the sheet keeps
  // drawing the one it was opened with, so the member sees the result of
  // what they just did.
  const openRow = useMemo(() => {
    if (openedKey === null) return null;
    const row = groups
      .flatMap((group) => [...group.rows, ...(group.archive?.rows ?? [])])
      .find((candidate) => candidate.key === openedKey);
    return row ?? null;
  }, [groups, openedKey]);
  const [opened, setOpened] = useState<ActivityRow | null>(null);
  const sheetRow = openedKey === null ? null : (openRow ?? opened);

  // Dots (#4405): opening a row from here is what reads it; scrolling past
  // doesn't, and neither does acting on the item elsewhere in Frapp.
  const { markRead } = useActivityUnread(activity.data);
  const open = (row: ActivityRow) => {
    if (row.unread) markRead([row.readRef]);
    setOpened(row);
    setOpenedKey(row.key);
  };
  // Confirm and Approve on the row (#4437), while the chapter's plan allows
  // them; acting there reads the item, as opening it does, and re-reads so
  // the row leaves Needs you.
  const { actions: rowActions, stateOf: rowActionStateOf } =
    useActivityRowActions({
      allowed: activityRowActionsAllowed(chapter),
      chapterPending: chapterRead.isPending === true,
      onActed: (row) => {
        if (row.unread) markRead([row.readRef]);
        reread();
      },
    });

  function renderBody() {
    if (activity.isPending) {
      return (
        <SkeletonRegion label="Loading activity">
          <View style={styles.body}>
            <ActivitySummarySkeleton />
            <View>
              <SectionHeader>Needs you</SectionHeader>
              {Array.from({ length: 4 }, (_, index) => (
                <ActivityRowSkeleton
                  key={index}
                  index={index}
                  isFirst={index === 0}
                />
              ))}
            </View>
          </View>
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
    return (
      <View style={styles.body}>
        {summary ? (
          <ActivitySummary
            summary={summary}
            filter={filter}
            onFilter={setFilter}
          />
        ) : null}
        <FilterChips
          chips={chips}
          // The To confirm tile narrows within Tasks, so the Tasks chip stays
          // lit under it, as on web.
          selected={
            filter === "all" ? null : filter === "confirm" ? "task" : filter
          }
          onSelect={(value) => setFilter((value ?? "all") as ActivityFilter)}
          accessibilityLabel="Show"
          scroll
        />
        {groups.map((group) =>
          // Under a chip, a group with nothing of that kind is left out
          // rather than drawn as three "nothing here" lines; "Needs you"
          // always stays.
          filter !== "all" &&
          group.id !== "needs-you" &&
          group.rows.length === 0 &&
          group.archive === null &&
          group.unavailable.length === 0 ? null : (
            <GroupSection
              key={group.id}
              group={group}
              filtered={filter !== "all" && filter !== "waiting"}
              rowActions={rowActions}
              onOpen={open}
            />
          ),
        )}
      </View>
    );
  }

  return (
    <ActivityFaces.Provider value={faceFor}>
      <ScreenShell back={BACK_TO_MORE} title="Activity" refresh={refresh}>
        {renderBody()}
        <ActivitySheet
          row={sheetRow}
          viewerId={viewerId}
          rowActionState={sheetRow ? rowActionStateOf(sheetRow.key) : "idle"}
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
    </ActivityFaces.Provider>
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
  rowActions,
  onOpen,
}: {
  group: ActivityGroup;
  filtered: boolean;
  rowActions: ActivityRowActions | null;
  onOpen: (row: ActivityRow) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.group}>
      <SectionHeader count={group.rows.length || null}>
        {group.label}
      </SectionHeader>
      {group.unavailable.length > 0 ? (
        // A section the read could not load is said, never shown as empty:
        // "nothing is waiting on you" must not be a failed read.
        <InlineNote tone="warning">
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
        group.parts.map((part) => (
          <GroupPart
            key={part.id}
            part={part}
            rowActions={rowActions}
            onOpen={onOpen}
          />
        ))
      )}
      {group.archive ? (
        <ArchivePart part={group.archive} onOpen={onOpen} />
      ) : null}
    </View>
  );
}

/**
 * The rows a group keeps behind one control (#4258): the member's closed
 * polls, under Made by you, closed until pressed, as web draws them. Each
 * row opens the poll's card with its final result.
 */
function ArchivePart({
  part,
  onOpen,
}: {
  part: ActivityPart;
  onOpen: (row: ActivityRow) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const [open, setOpen] = useState(false);
  const label = part.label ?? "Archive";
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((shown) => !shown)}
        style={styles.showAll}
      >
        <Text style={[styles.showAllText, { color: accent }]}>
          {open
            ? `Hide ${label.toLowerCase()}`
            : `${label} (${part.rows.length})`}
        </Text>
      </Pressable>
      {open
        ? part.rows.map((row, index) => (
            <ActivityListRow
              key={row.key}
              row={row}
              isFirst={index === 0}
              onPress={() => onOpen(row)}
            />
          ))
        : null}
    </View>
  );
}

/**
 * One run of a group's rows (#4173): "Now" or "Later" under Needs you, one
 * kind under Made by you, or the whole group. A long part draws its first few
 * rows and a "Show all" for the rest, so one busy kind doesn't bury the
 * screen. Drawn from `group.parts`, never `group.rows`: the parts carry the
 * Now/Later split and the caps, and the headings that explain the order.
 */
function GroupPart({
  part,
  rowActions,
  onOpen,
}: {
  part: ActivityPart;
  rowActions: ActivityRowActions | null;
  onOpen: (row: ActivityRow) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const [expanded, setExpanded] = useState(false);
  const cappable = part.limit !== null && part.rows.length > part.limit;
  const rows =
    cappable && !expanded
      ? part.rows.slice(0, part.limit ?? undefined)
      : part.rows;
  return (
    <View>
      {part.label ? (
        <View
          accessible
          accessibilityRole="header"
          accessibilityLabel={`${part.label}, ${part.rows.length}`}
          style={styles.partHeading}
        >
          <Text style={styles.partLabel}>{part.label}</Text>
          <SectionCount count={part.rows.length} />
        </View>
      ) : null}
      {rows.map((row, index) => (
        <ActivityRowItem
          key={row.key}
          row={row}
          isFirst={index === 0}
          actions={rowActions}
          onPress={() => onOpen(row)}
        />
      ))}
      {cappable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((open) => !open)}
          style={styles.showAll}
        >
          <Text style={[styles.showAllText, { color: accent }]}>
            {expanded ? "Show fewer" : `Show all ${part.rows.length}`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // The summary, the chips and each group, a step further apart than the
    // shell's own gap, as web spaces its sections.
    body: {
      gap: tokens.spacing.lg,
    },
    group: {
      gap: tokens.spacing.sm,
    },
    partHeading: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: tokens.spacing.sm,
      paddingTop: tokens.spacing.sm,
      paddingBottom: tokens.spacing.xs,
    },
    partLabel: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.text.mutedForeground,
    },
    // The touch floor, with the text on the gutter line.
    showAll: {
      alignSelf: "flex-start",
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
    },
    showAllText: {
      ...typeRole({
        ...tokens.typography.role.label,
        weight: tokens.typography.weight.semibold,
      }),
    },
  });
}
