"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { describeLoadFailure } from "@repo/hooks/error-copy";
import { useQueryClient } from "@tanstack/react-query";
import {
  ErrorState,
  OfflineState,
  anyReadUncached,
} from "@/components/shared/async-states";
import { FILTER_CHIP_CLASS } from "@/components/shared/filter-chip";
import { InlineNote } from "@/components/shared/inline-note";
import {
  useSubscriptionGate,
  type SubscriptionGate,
} from "@/components/shared/subscription-gate";
import { SectionLabel } from "@/components/shared/section-label";
import { denseListClassName } from "@/components/shared/table-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import {
  readActivityFilter,
  writeActivityFilter,
} from "@/lib/activity/activity-filter";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { useNetwork } from "@/lib/providers/network-provider";
import { cn } from "@/lib/utils";
import { can } from "@repo/validation";
import { useChapterModuleGate } from "@/lib/hooks/use-chapter-module-gate";
import {
  ActivityLinkRow,
  useActivityLinkActions,
  type ActivityLinkActions,
} from "./activity-link-row";
import { ActivityPanel } from "./activity-panel";
import { ActivityRowActionButton } from "./activity-row-action";
import { activityRowActionGate } from "./activity-row-action-gate";
import {
  ActivityAsk,
  ActivityFaces,
  ActivityRowDetail,
  ActivityRowLead,
  ActivityUnreadDot,
} from "./activity-row-lead";
import {
  ActivityStanding,
  ActivityStandingSkeleton,
} from "./activity-standing";
import { ActivitySummary } from "./activity-summary";
import {
  ACTIVITY_FILTERS,
  ACTIVITY_SECTION_NAMES,
  activityBadgeIsAsk,
  activityFilterAvailable,
  activityGroups,
  activityRowAction,
  activityKeys,
  activityStandingKeys,
  activitySummary,
  useActiveChapterId,
  useActivity,
  useActivityStanding,
  useActivityUnread,
  useActivityFaces,
  useNowDate,
  useMyPermissions,
  type ActivityFilter,
  type ActivityGroup,
  type ActivityPart,
  type ActivityRow,
} from "@repo/hooks";
import { ActivityPageSkeleton } from "./activity-skeleton";

/**
 * The row's lead (the face of who it's from, its kind's glyph, or an event's
 * date: `ActivityRowLead`), its two lines, and
 * its badge, shared by the button and the link form. A badge that asks the
 * member to act draws as the action (`ActivityAsk`); any other is a status.
 */
function RowContent({
  row,
  askOnRow = false,
}: {
  row: ActivityRow;
  /** The ask is a button beside the row (`ActivityRowActionButton`). */
  askOnRow?: boolean;
}) {
  return (
    <>
      <ActivityUnreadDot unread={row.unread} />
      <ActivityRowLead row={row} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">
          {row.title}
        </span>
        <ActivityRowDetail row={row} />
      </span>
      {row.badge ? (
        askOnRow ? (
          // Holds the ask's place, so the button laid over it lines up with
          // every other row's badge and the chevron stays in its column.
          <span aria-hidden="true" className="invisible">
            <ActivityAsk label={row.badge.label} />
          </span>
        ) : activityBadgeIsAsk(row) ? (
          <ActivityAsk label={row.badge.label} />
        ) : (
          <Badge variant={row.badge.variant} className="shrink-0">
            {row.badge.label}
          </Badge>
        )
      ) : null}
      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </>
  );
}

/** A row is one hit target: the whole line opens the record. */
const ROW_CLASS = cn(
  "flex min-h-14 w-full items-center gap-3 rounded-md px-2 py-2 text-left",
  "transition-colors hover:bg-surface-1",
  FOCUS_RING,
);

/** What a row needs to act on its ask in place (#4402). */
interface RowActions {
  /** `null` when the chapter's plan refuses the writes: rows open their panel. */
  gate: SubscriptionGate | null;
  /** Records the read and re-reads; resolves when the read settles. */
  onActed: (row: ActivityRow) => Promise<unknown>;
}

/**
 * A row that opens its record in the panel. One whose ask is a single press
 * (Confirm, Approve, Check in; `activityRowAction`) carries it as a button
 * where the ask was drawn, so the common case takes one click and the rest
 * of the row still opens the panel, as GitHub's notification rows carry
 * their quick actions.
 */
function PanelRow({
  row,
  rowActions,
  onOpen,
}: {
  row: ActivityRow;
  rowActions: RowActions;
  onOpen: (row: ActivityRow) => void;
}) {
  const action = rowActions.gate ? activityRowAction(row) : null;
  return (
    <li className={action ? "relative" : undefined}>
      <button type="button" className={ROW_CLASS} onClick={() => onOpen(row)}>
        <RowContent row={row} askOnRow={action !== null} />
      </button>
      {action && rowActions.gate ? (
        // Laid over the place the row keeps for its ask (a sibling, not
        // nested: a button can't hold a button), right of it only the
        // row's chevron: its 8px padding, 12px gap and 16px glyph.
        // The wrapper lets a click through, so a disabled button (offline)
        // leaves the row under it opening the panel, as the ask did.
        <span className="pointer-events-none absolute right-9 top-1/2 z-10 -translate-y-1/2">
          <ActivityRowActionButton
            row={row}
            action={action}
            gate={rowActions.gate}
            onActed={rowActions.onActed}
          />
        </span>
      ) : null}
    </li>
  );
}

function GroupSection({
  group,
  filtered,
  canRemoveLinks,
  linkActions,
  rowActions,
  onOpen,
}: {
  group: ActivityGroup;
  filtered: boolean;
  canRemoveLinks: boolean;
  linkActions: ActivityLinkActions;
  rowActions: RowActions;
  onOpen: (row: ActivityRow) => void;
}) {
  const labelId = `activity-${group.id}`;
  return (
    <section aria-labelledby={labelId} className="space-y-3">
      <SectionLabel id={labelId} count={group.rows.length || null}>
        {group.label}
      </SectionLabel>
      {group.unavailable.length > 0 ? (
        // A section the read could not load is said, never shown as empty:
        // "nothing is waiting on you" must not be a failed read.
        <InlineNote className="text-warning">
          Couldn&apos;t load{" "}
          {group.unavailable
            .map((section) => ACTIVITY_SECTION_NAMES[section])
            .join(", ")}
          . Try again in a moment.
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
            groupId={group.id}
            part={part}
            canRemoveLinks={canRemoveLinks}
            linkActions={linkActions}
            rowActions={rowActions}
            onOpen={onOpen}
          />
        ))
      )}
      {group.archive ? (
        <ArchivePart groupId={group.id} part={group.archive} onOpen={onOpen} />
      ) : null}
    </section>
  );
}

/**
 * The rows a group keeps behind one control (#4258): the member's closed
 * polls, under Made by you. Closed until pressed, the way Slack keeps
 * archived channels behind "Show archived" and Google Forms puts closed
 * forms apart from open ones; each row opens the poll's card with its
 * final result.
 */
function ArchivePart({
  groupId,
  part,
  onOpen,
}: {
  groupId: ActivityGroup["id"];
  part: ActivityPart;
  onOpen: (row: ActivityRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = `activity-${groupId}-${part.id}`;
  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="link"
        size="sm"
        className="px-2"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((shown) => !shown)}
      >
        {open
          ? `Hide ${part.label?.toLowerCase() ?? "archive"}`
          : `${part.label ?? "Archive"} (${part.rows.length})`}
      </Button>
      {open ? (
        <ul
          id={listId}
          aria-label={part.label ?? undefined}
          className={denseListClassName}
        >
          {part.rows.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                className={ROW_CLASS}
                onClick={() => onOpen(row)}
              >
                <RowContent row={row} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * One run of a group's rows (#4173): "Now" or "Later" under Needs you, one
 * kind under Made by you, or the whole group. A long part draws its first few
 * rows and a "Show all" for the rest, so one busy kind doesn't bury the page.
 */
function GroupPart({
  groupId,
  part,
  canRemoveLinks,
  linkActions,
  rowActions,
  onOpen,
}: {
  groupId: ActivityGroup["id"];
  part: ActivityPart;
  canRemoveLinks: boolean;
  linkActions: ActivityLinkActions;
  rowActions: RowActions;
  onOpen: (row: ActivityRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const capped =
    !expanded && part.limit !== null && part.rows.length > part.limit;
  const rows = capped ? part.rows.slice(0, part.limit ?? undefined) : part.rows;
  const labelId = `activity-${groupId}-${part.id}`;
  return (
    <div
      className="space-y-1"
      role={part.label ? "group" : undefined}
      aria-labelledby={part.label ? labelId : undefined}
    >
      {part.label ? (
        <h3
          id={labelId}
          className="px-2 text-caption font-semibold text-muted-foreground"
        >
          {part.label}
          <span className="ml-2 font-normal text-muted tabular-nums">
            {part.rows.length}
          </span>
        </h3>
      ) : null}
      <ul className={denseListClassName}>
        {rows.map((row) =>
          row.kind === "link" ? (
            <ActivityLinkRow
              key={row.key}
              row={row}
              rowClassName={ROW_CLASS}
              canRemove={canRemoveLinks}
              actions={linkActions}
              onOpen={onOpen}
            />
          ) : (
            <PanelRow
              key={row.key}
              row={row}
              rowActions={rowActions}
              onOpen={onOpen}
            />
          ),
        )}
      </ul>
      {part.limit !== null && part.rows.length > part.limit ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="px-2"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "Show fewer" : `Show all ${part.rows.length}`}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * `/activity`: what is waiting on the member and what they made, in one place
 * (#3897, `spec/behavior/activity.md`). An inbox beside chat, not a home.
 *
 * Four groups, "Needs you" first, with chips that narrow every group to one
 * kind of thing. A row opens the record in a panel drawn with chat's own card,
 * where the member acts on it; a sign-up link row opens the link
 * (`ActivityLinkRow`). A closed poll leaves its list for Archived polls under
 * Made by you (#4258). When the read refreshes after an action, the panel shows the fresh
 * row; a row that has left the list (a vote cast, a completion confirmed)
 * stays open as it was, so the member sees the result of what they just did
 * rather than having the panel vanish under them.
 */
export function ActivityPage() {
  const activity = useActivity();
  // How the member is doing this semester, on top. Its own read: when it
  // fails the rest of the page is as it was.
  const standing = useActivityStanding();
  // The shared 30s clock the poll cards read: a poll whose time runs out
  // leaves its section within a tick, without a re-read (#4258), and Now and
  // Later and Next up stay current while the page is open.
  const now = useNowDate();
  const { isOffline } = useNetwork();
  const { userId, isLoading: userLoading } = useFrappUser();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  // The chip picked on this visit wins; until then, the one this person
  // last left the page on in this browser (#4402), else All.
  const [picked, setPicked] = useState<ActivityFilter | null>(null);
  const stored = useMemo(() => readActivityFilter(userId), [userId]);
  const isModuleEnabled = useChapterModuleGate();
  // A stored chip whose module the chapter has since turned off opens on All.
  const filter: ActivityFilter =
    picked ??
    (stored && activityFilterAvailable(stored, isModuleEnabled)
      ? stored
      : "all");
  const setFilter = (next: ActivityFilter) => {
    setPicked(next);
    // Clearing the To confirm tile isn't a pick: the stored chip stays.
    if (!(filter === "confirm" && next === "all")) {
      writeActivityFilter(userId, next);
    }
  };
  const [opened, setOpened] = useState<ActivityRow | null>(null);
  // Dots (#4405): opening a row from here is what reads it; scrolling past
  // doesn't, and neither does acting on the item elsewhere in Frapp.
  const { markRead } = useActivityUnread(activity.data);
  const openFromList = (row: ActivityRow) => {
    if (row.unread) markRead([row.readRef]);
    // A link opens in a new tab and has no panel.
    if (row.kind !== "link") setOpened(row);
  };
  // Remove (off everyone's Activity) is `channels:manage`'s, as in chat.
  const permissions = useMyPermissions();
  const canRemoveLinks = can("channels:manage", permissions.data?.permissions);
  const linkActions = useActivityLinkActions();
  const actionGate = activityRowActionGate(useSubscriptionGate());
  // Faces on the rows (#4402, item 4), from the roster chat already reads.
  const faceFor = useActivityFaces();

  const groups = useMemo(
    () => (activity.data ? activityGroups(activity.data, filter, now) : []),
    [activity.data, filter, now],
  );
  const summary = useMemo(
    () =>
      activity.data
        ? activitySummary(
            activity.data,
            {
              canConfirmTasks: can(
                "tasks:manage",
                permissions.data?.permissions,
              ),
              canApproveHours: can(
                "service:approve",
                permissions.data?.permissions,
              ),
              isModuleEnabled,
            },
            now,
          )
        : null,
    [activity.data, permissions.data?.permissions, isModuleEnabled, now],
  );
  const openRow = useMemo(
    () =>
      opened === null
        ? null
        : (groups
            .flatMap((group) => [...group.rows, ...(group.archive?.rows ?? [])])
            .find((row) => row.key === opened.key) ?? opened),
    [groups, opened],
  );

  if (isOffline && anyReadUncached(activity)) {
    return (
      <OfflineState
        title="Activity unavailable offline"
        description="Reconnect to see what's waiting on you."
        onRetry={() => void activity.refetch()}
      />
    );
  }
  // Held until the viewer is known (as the Events page holds its view), so
  // the page opens on the member's stored chip rather than jumping to it,
  // and a chip picked straight away is stored under them.
  if (activity.isPending || (userLoading && !isOffline)) {
    return <ActivityPageSkeleton />;
  }
  // Only with nothing to show: a refetch that fails (this page refetches after
  // every action) keeps the list it already has rather than replacing it, and
  // the open panel with it, by an error page. The same guard as the task board.
  if (activity.isError && !activity.data) {
    return (
      <ErrorState
        title="Couldn't load your activity"
        description={describeLoadFailure(activity.error)}
        onRetry={() => void activity.refetch()}
      />
    );
  }

  // The standing too: a check-in or approval from a row here moves it.
  const reread = (): Promise<unknown> =>
    chapterId
      ? Promise.all([
          queryClient.invalidateQueries({
            queryKey: activityKeys.chapter(chapterId),
            exact: true,
          }),
          queryClient.invalidateQueries({
            queryKey: activityStandingKeys.chapter(chapterId),
            exact: true,
          }),
        ])
      : Promise.resolve();
  const refresh = () => void reread();
  // Acting on an item from Activity reads it, as opening it does (#4402).
  const actedOnRow = (row: ActivityRow) => {
    if (row.unread) markRead([row.readRef]);
    return reread();
  };

  return (
    <ActivityFaces.Provider value={faceFor}>
      <div className="space-y-8">
        {standing.isPending ? (
          <ActivityStandingSkeleton />
        ) : standing.data ? (
          <ActivityStanding standing={standing.data} />
        ) : null}
        {summary ? (
          <ActivitySummary
            summary={summary}
            filter={filter}
            onFilter={setFilter}
          />
        ) : null}
        <div
          role="group"
          aria-label="Show"
          className="flex flex-wrap items-center gap-2"
        >
          {ACTIVITY_FILTERS.filter((option) =>
            activityFilterAvailable(option.value, isModuleEnabled),
          ).map((option) => {
            // The To confirm tile narrows within Tasks, so the Tasks chip
            // stays lit under it.
            const on =
              filter === option.value ||
              (filter === "confirm" && option.value === "task");
            return (
              <Button
                key={option.value}
                type="button"
                size="toolbar"
                variant={on ? "tinted" : "secondary"}
                className={FILTER_CHIP_CLASS}
                aria-pressed={on}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
              </Button>
            );
          })}
        </div>

        {groups.map((group) =>
          // Under a chip, a group with nothing of that kind is left out rather
          // than drawn as three "nothing here" lines; "Needs you" always stays.
          filter !== "all" &&
          group.id !== "needs-you" &&
          group.rows.length === 0 &&
          group.archive === null &&
          group.unavailable.length === 0 ? null : (
            <GroupSection
              key={group.id}
              group={group}
              filtered={filter !== "all" && filter !== "waiting"}
              canRemoveLinks={canRemoveLinks}
              linkActions={linkActions}
              rowActions={{ gate: actionGate, onActed: actedOnRow }}
              onOpen={openFromList}
            />
          ),
        )}

        <ActivityPanel
          row={openRow}
          viewerId={userId}
          onClose={(key) => {
            // A late answer from one row's action must not close another row
            // the member has since opened.
            setOpened((current) =>
              key === undefined || current?.key === key ? null : current,
            );
            // The cards write through their own hooks (a task's status, a
            // check-in), which this page's read does not hear about, so it is
            // re-read when the panel closes by hand. An action's own close
            // (`key` given) has already re-read through `onActed`.
            if (key === undefined) refresh();
          }}
          onActed={refresh}
        />
      </div>
    </ActivityFaces.Provider>
  );
}
