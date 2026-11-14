"use client";

import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { describeLoadFailure } from "@repo/hooks/error-copy";
import { useQueryClient } from "@tanstack/react-query";
import {
  ErrorState,
  OfflineState,
  anyReadUncached,
} from "@/components/shared/async-states";
import { InlineNote, InlineNoteAction } from "@/components/shared/inline-note";
import {
  useSubscriptionGate,
  type SubscriptionGate,
} from "@/components/shared/subscription-gate";
import { SectionLabel } from "@/components/shared/section-label";
import { denseListClassName } from "@/components/shared/table-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { useNetwork } from "@/lib/providers/network-provider";
import { chatDeepLink } from "@/lib/chat/chat-links";
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
import { ReviewCard } from "./review-card";
import {
  useActivitySnoozeActions,
  type ActivitySnoozeActions,
} from "./activity-snooze-menu";
import { RowMenu } from "@/components/shared/row-menu";
import { SemesterStrip, SemesterStripSkeleton } from "./semester-strip";
import { WeekCard } from "./week-card";
import {
  ACTIVITY_SHOW_EVERYTHING,
  ACTIVITY_TO_DO_EMPTY,
  activityAgenda,
  activityAwake,
  activityCouldNotLoad,
  activityNarrowedNote,
  activityBadgeIsAsk,
  activityGroups,
  activityReview,
  activityReviewQueue,
  activitySnoozedRows,
  activityWeekSummary,
  findActivityTaskRow,
  activityRowAction,
  activityKeys,
  activityStandingKeys,
  useActiveChapterId,
  useActivity,
  useActivityStanding,
  useActivityUnread,
  useActivityFaces,
  useNowDate,
  useMyPermissions,
  type ActivityAgendaDay,
  type ActivityAgendaFilter,
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

/**
 * A row drawn on a card (the week card's next thing, the To review card's
 * queue): it lightens under the pointer as the card's own controls do. The
 * page's hover is a step up from the page, which is below a card's fill.
 */
const ROW_ON_CARD_CLASS = cn(ROW_CLASS, "hover:bg-card-hover");

/** What a row needs to act on its ask in place (#4402). */
interface RowActions {
  /** `null` when the chapter's plan refuses the writes: rows open their panel. */
  gate: SubscriptionGate | null;
  /** Records the read and re-reads; resolves when the read settles. */
  onActed: (row: ActivityRow) => Promise<unknown>;
}

/**
 * A row that opens its record in the panel. One whose ask is a single press
 * (Confirm, Approve; `activityRowAction`) carries it as a button
 * where the ask was drawn, so the common case takes one click and the rest
 * of the row still opens the panel, as GitHub's notification rows carry
 * their quick actions.
 */
function PanelRow({
  row,
  rowActions,
  onOpen,
  className,
  snooze,
}: {
  row: ActivityRow;
  rowActions: RowActions;
  onOpen: (row: ActivityRow) => void;
  className: string;
  snooze: ActivitySnoozeActions;
}) {
  const action = rowActions.gate ? activityRowAction(row) : null;
  const entries = snooze.entriesFor(row);
  if (entries.length === 0) {
    return (
      <li>
        <PanelRowBody
          row={row}
          action={action}
          rowActions={rowActions}
          onOpen={onOpen}
          className={className}
        />
      </li>
    );
  }
  return (
    <RowMenu entries={entries} label={`More for ${row.title}`}>
      {(menuButton) => (
        <li className="group flex items-center gap-1">
          <PanelRowBody
            row={row}
            action={action}
            rowActions={rowActions}
            onOpen={onOpen}
            className={className}
          />
          {menuButton}
        </li>
      )}
    </RowMenu>
  );
}

/** The row's button and the ask laid over it, measured from its own edge. */
function PanelRowBody({
  row,
  action,
  rowActions,
  onOpen,
  className,
}: {
  row: ActivityRow;
  action: ReturnType<typeof activityRowAction>;
  rowActions: RowActions;
  onOpen: (row: ActivityRow) => void;
  className: string;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <button type="button" className={className} onClick={() => onOpen(row)}>
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
    </div>
  );
}

/**
 * A sign-up sheet, headcount or form the member hasn't answered (#3926 step
 * 4). It is answered on the card itself, so the row goes to the message in
 * chat rather than a panel, as a link row goes to its link; opening it reads
 * it.
 */
function CardRow({
  row,
  onOpen,
  className,
  entries,
}: {
  row: Extract<ActivityRow, { kind: "card" }>;
  onOpen: (row: ActivityRow) => void;
  className: string;
  /** The row's menu: snooze, or on a snoozed row, Unsnooze. */
  entries: RowMenuEntries;
}) {
  return (
    <RowMenu entries={entries} label={`More for ${row.title}`}>
      {(menuButton) => (
        <li className="group flex items-center gap-1">
          <Link
            href={chatDeepLink({
              channelId: row.card.channel_id,
              messageId: row.card.message_id,
            })}
            className={cn(className, "min-w-0 flex-1")}
            onClick={() => onOpen(row)}
          >
            <RowContent row={row} />
          </Link>
          {menuButton}
        </li>
      )}
    </RowMenu>
  );
}

type RowMenuEntries = Parameters<typeof RowMenu>[0]["entries"];

/** What every list on the page needs to draw one of its rows. */
interface RowKit {
  canRemoveLinks: boolean;
  snooze: ActivitySnoozeActions;
  linkActions: ActivityLinkActions;
  rowActions: RowActions;
  onOpen: (row: ActivityRow) => void;
}

/** A row as its kind draws it: a link, a card that opens in chat, or a panel. */
function Row({
  row,
  kit,
  onCard = false,
}: {
  row: ActivityRow;
  kit: RowKit;
  /** Drawn on a card rather than on the page (`ROW_ON_CARD_CLASS`). */
  onCard?: boolean;
}) {
  const className = onCard ? ROW_ON_CARD_CLASS : ROW_CLASS;
  return row.kind === "link" ? (
    <ActivityLinkRow
      row={row}
      rowClassName={className}
      canRemove={kit.canRemoveLinks}
      actions={kit.linkActions}
      onOpen={kit.onOpen}
      leadEntries={kit.snooze.entriesFor(row)}
    />
  ) : row.kind === "card" ? (
    <CardRow
      row={row}
      onOpen={kit.onOpen}
      className={className}
      entries={kit.snooze.entriesFor(row)}
    />
  ) : (
    <PanelRow
      row={row}
      rowActions={kit.rowActions}
      onOpen={kit.onOpen}
      className={className}
      snooze={kit.snooze}
    />
  );
}

/** "Couldn't load tasks and polls. Try again in a moment." */
function CouldNotLoad({
  sections,
}: {
  sections: ActivityGroup["unavailable"];
}) {
  // A section the read could not load is said, never shown as empty:
  // "nothing to do" must not be a failed read.
  return (
    <InlineNote className="text-warning">
      {activityCouldNotLoad(sections)} Try again in a moment.
    </InlineNote>
  );
}

/**
 * "To do": the member's own list by day (#4766), as Things' Today and
 * Todoist's Upcoming draw one. Overdue leads in the warning hue, then what
 * is open for check-in now, then each day. What waits on the member's review
 * is never here (`ReviewCard`).
 */
function ToDoSection({
  days,
  unavailable,
  filter,
  onCard,
  onShowAll,
  kit,
}: {
  days: ActivityAgendaDay[];
  unavailable: ActivityGroup["unavailable"];
  filter: ActivityAgendaFilter;
  /** The week card holds the next thing, so an empty list isn't "nothing". */
  onCard: boolean;
  onShowAll: () => void;
  kit: RowKit;
}) {
  const count = days.reduce((sum, day) => sum + day.rows.length, 0);
  // Its one thing is on the week card: a heading over nothing says nothing.
  if (count === 0 && onCard && filter === "all" && unavailable.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="activity-to-do" className="space-y-3">
      <SectionLabel id="activity-to-do" count={count || null}>
        To do
      </SectionLabel>
      {filter !== "all" ? (
        <InlineNote>
          {activityNarrowedNote(filter, count, unavailable.length > 0)}{" "}
          <InlineNoteAction onClick={onShowAll}>
            {ACTIVITY_SHOW_EVERYTHING}
          </InlineNoteAction>
        </InlineNote>
      ) : null}
      {unavailable.length > 0 ? <CouldNotLoad sections={unavailable} /> : null}
      {count === 0 && filter === "all" && unavailable.length === 0 ? (
        <InlineNote>{ACTIVITY_TO_DO_EMPTY}</InlineNote>
      ) : null}
      {days.map((day) => (
        <DaySection key={day.id} day={day} kit={kit} />
      ))}
    </section>
  );
}

/** A day's heading tone: Overdue warns, Now is the accent, a day is plain. */
const DAY_TONE: Record<ActivityAgendaDay["tone"], string> = {
  warning: "text-warning",
  accent: "text-accent-text",
  // A day is the content's own label, in the foreground tone, as the
  // Events page's day headings are.
  plain: "text-foreground",
};

/**
 * One day of the To do list: its heading and count, its first few rows, and
 * "Show N more" for the rest, so the president's Saturday doesn't bury
 * Sunday. Overdue and Now are never cut (`day.limit` is `null`).
 */
function DaySection({ day, kit }: { day: ActivityAgendaDay; kit: RowKit }) {
  const [expanded, setExpanded] = useState(false);
  const cappable = day.limit !== null && day.rows.length > day.limit;
  const rows =
    cappable && !expanded
      ? day.rows.slice(0, day.limit ?? undefined)
      : day.rows;
  const labelId = `activity-day-${day.id.replace(":", "-")}`;
  return (
    <div
      className="space-y-1"
      role="group"
      aria-labelledby={labelId}
      data-testid={labelId}
    >
      {/* The count beside the heading, not in it: the heading names the
          group, and "Tomorrow5" is not a name. */}
      <div className="flex items-baseline gap-2 px-2">
        <h3
          id={labelId}
          className={cn("text-caption font-semibold", DAY_TONE[day.tone])}
        >
          {day.label}
        </h3>
        <span className="text-caption text-muted tabular-nums">
          {day.rows.length}
        </span>
      </div>
      <ul className={denseListClassName}>
        {rows.map((row) => (
          <Row key={row.key} row={row} kit={kit} />
        ))}
      </ul>
      {cappable ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="px-2"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded
            ? "Show fewer"
            : `Show ${day.rows.length - rows.length} more`}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A group under the To do list: Waiting on others (the polls the member
 * posted, the events they made, the tasks they assigned), or Links. The page
 * leaves a group with nothing in it out, so there is no empty line.
 */
function GroupSection({ group, kit }: { group: ActivityGroup; kit: RowKit }) {
  const labelId = `activity-${group.id}`;
  return (
    <section aria-labelledby={labelId} className="space-y-3">
      <SectionLabel id={labelId} count={group.rows.length || null}>
        {group.label}
      </SectionLabel>
      {group.unavailable.length > 0 ? (
        <CouldNotLoad sections={group.unavailable} />
      ) : null}
      {group.parts.map((part) => (
        <GroupPart key={part.id} groupId={group.id} part={part} kit={kit} />
      ))}
      {group.archive ? (
        <ArchivePart
          groupId={group.id}
          part={group.archive}
          onOpen={kit.onOpen}
        />
      ) : null}
    </section>
  );
}

/**
 * The rows a group keeps behind one control (#4258): the member's closed
 * polls, under Waiting on others. Closed until pressed, the way Slack keeps
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
 * One run of a group's rows (#4173): one kind under Waiting on others, or
 * the whole group. A long part draws its first few rows and a "Show all" for
 * the rest, so one busy kind doesn't bury the page.
 */
function GroupPart({
  groupId,
  part,
  kit,
}: {
  groupId: ActivityGroup["id"];
  part: ActivityPart;
  kit: RowKit;
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
        <div className="flex items-baseline gap-2 px-2">
          <h3
            id={labelId}
            className="text-caption font-semibold text-muted-foreground"
          >
            {part.label}
          </h3>
          <span className="text-caption text-muted tabular-nums">
            {part.rows.length}
          </span>
        </div>
      ) : null}
      <ul className={denseListClassName}>
        {rows.map((row) => (
          <Row key={row.key} row={row} kit={kit} />
        ))}
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
 * Snoozed (#4982, `spec/behavior/activity.md` § Snooze): the rows the member
 * put off, soonest back first, each saying when. Closed until pressed, as
 * Gmail keeps Snoozed in its own folder and Slack's Later keeps reminders
 * apart, so a snoozed thing is out of sight but one press from found. Each
 * row still opens its record, and its menu brings it back now.
 */
function SnoozedSection({ rows, kit }: { rows: ActivityRow[]; kit: RowKit }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="Snoozed" className="space-y-1">
      <Button
        type="button"
        variant="link"
        size="sm"
        className="px-2"
        aria-expanded={open}
        aria-controls={open ? "activity-snoozed" : undefined}
        onClick={() => setOpen((shown) => !shown)}
      >
        {open ? "Hide snoozed" : `Snoozed (${rows.length})`}
      </Button>
      {open ? (
        <ul id="activity-snoozed" className={denseListClassName}>
          {rows.map((row) =>
            row.kind === "link" ? (
              // A snoozed link opens the link, and its menu wakes it.
              <RowMenu
                key={row.key}
                entries={[kit.snooze.wakeEntry(row)]}
                label={`More for ${row.title}`}
              >
                {(menuButton) => (
                  <li className="group flex items-center gap-1">
                    <a
                      href={row.link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(ROW_CLASS, "min-w-0 flex-1")}
                    >
                      <RowContent row={row} />
                    </a>
                    {menuButton}
                  </li>
                )}
              </RowMenu>
            ) : row.kind === "card" ? (
              <CardRow
                key={row.key}
                row={row}
                onOpen={kit.onOpen}
                className={ROW_CLASS}
                entries={[kit.snooze.wakeEntry(row)]}
              />
            ) : (
              <RowMenu
                key={row.key}
                entries={[kit.snooze.wakeEntry(row)]}
                label={`More for ${row.title}`}
              >
                {(menuButton) => (
                  <li className="group flex items-center gap-1">
                    <PanelRowBody
                      row={row}
                      action={null}
                      rowActions={kit.rowActions}
                      onOpen={kit.onOpen}
                      className={ROW_CLASS}
                    />
                    {menuButton}
                  </li>
                )}
              </RowMenu>
            ),
          )}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Reads `?review=<taskId>` (a "submitted a task" notification, `deepLinkFor`
 * in the bell) and hands it to the page once per link, then drops it from the
 * address so a refresh doesn't reopen the panel. Clicking the same link again
 * later opens it again. Its own component because `useSearchParams` needs a
 * Suspense boundary of its own (as in `chat-page.tsx`), and the page around
 * it must not wait on one.
 */
function ReviewParam({ open }: { open: (taskId: string) => Promise<void> }) {
  const searchParams = useSearchParams();
  const taskId = searchParams.get("review");
  const handled = useRef<string | null>(null);
  // The page hands a new `open` each render; the link is acted on once.
  const latestOpen = useRef(open);
  useEffect(() => {
    latestOpen.current = open;
  });
  useEffect(() => {
    if (!taskId) {
      handled.current = null;
      return;
    }
    if (handled.current === taskId) return;
    handled.current = taskId;
    void latestOpen.current(taskId);
  }, [taskId]);
  return null;
}

/**
 * `/activity`: the member's week, what they still have to do, and what waits
 * on others (#3897, `spec/behavior/activity.md`). An inbox beside chat, not a
 * home.
 *
 * Rebuilt around one ring on 2026-11-13 (#4766; Paul: "too many little cards
 * that, with the scale that we have right now, tell me no information"), the
 * phone's Activity tab on web, from the same model. Top to bottom:
 *
 * 1. The week card (`WeekCard`): done of total this week, a line per kind,
 *    and the one thing to do next.
 * 2. This semester (`SemesterStrip`): up to four gauges.
 * 3. To review (`ReviewCard`): for an officer with something to sign off.
 * 4. To do: the member's own events, tasks, polls and sign-ups by day
 *    (`activityAgenda`), three to a day before "Show more". A line of the
 *    week card narrows it to one kind.
 * 5. Waiting on others, then Links: what the member made and what was posted
 *    for them, each left out when it has nothing.
 *
 * The page is usually a pane beside chat about a phone wide, and the whole
 * window when chat is closed, so it lays out by its own width (`@container`),
 * never the window's. It is drawn and checked for four people
 * (`principles.md` § Three people): a member with nothing due, an average
 * member, a committee chair and the president. The headline, the count
 * tiles, the filter chips (and the chip remembered per browser) and the Now
 * and Later split are gone.
 *
 * A row opens the record in a panel drawn with chat's own card, where the
 * member acts on it; a sign-up link row opens the link (`ActivityLinkRow`),
 * and a sign-up or form its message in chat. When the read refreshes after
 * an action, the panel shows the fresh row; a row that has left the list (a
 * vote cast, a completion confirmed) stays open as it was, so the member
 * sees the result of what they just did rather than having the panel vanish
 * under them.
 */
export function ActivityPage() {
  const activity = useActivity();
  // How the member is doing this semester, under the week. Its own read:
  // when it fails the rest of the page is as it was.
  const standing = useActivityStanding();
  // The shared 30s clock the poll cards read: a poll whose time runs out
  // leaves the list within a tick, without a re-read (#4258), and the days
  // and Next stay current while the page is open.
  const now = useNowDate();
  const { isOffline } = useNetwork();
  const { userId, isLoading: userLoading } = useFrappUser();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  const isModuleEnabled = useChapterModuleGate();
  const summary = useMemo(
    () => (activity.data ? activityWeekSummary(activity.data, now) : null),
    [activity.data, now],
  );
  // The week line picked on this visit. Never stored: the page opens on
  // everything. A line that has left the card (its module turned off, or
  // nothing of its kind in the week's count any more, as on a new week)
  // takes its narrowing with it for good, so the list doesn't narrow itself
  // again when the line comes back. Finishing the last item keeps the line,
  // at "3 of 3", and the list says nothing of that kind is left.
  const [picked, setPicked] = useState<ActivityAgendaFilter>("all");
  const pickedLineGone =
    picked !== "all" &&
    summary !== null &&
    !summary.lines.some((line) => line.id === picked);
  // Adjusted while rendering, as React documents for state that follows a
  // prop: no frame is drawn with the stale pick.
  if (pickedLineGone) setPicked("all");
  const filter: ActivityAgendaFilter =
    picked !== "all" && summary?.lines.some((line) => line.id === picked)
      ? picked
      : "all";
  // What the lists show: the read less what the member snoozed, on the
  // page's own clock, so a snoozed row comes back within a tick of its time
  // (#4982). The week card counts from the whole read: snoozing something
  // doesn't finish it.
  const visible = useMemo(
    () => (activity.data ? activityAwake(activity.data, now) : undefined),
    [activity.data, now],
  );
  const snoozedRows = useMemo(
    () => (activity.data ? activitySnoozedRows(activity.data, now) : []),
    [activity.data, now],
  );
  const snoozeActions = useActivitySnoozeActions();
  const [opened, setOpened] = useState<ActivityRow | null>(null);
  // Dots (#4405): opening a row from here is what reads it; scrolling past
  // doesn't, and neither does acting on the item elsewhere in Frapp.
  const { markRead } = useActivityUnread(activity.data);
  const openFromList = (row: ActivityRow) => {
    if (row.unread) markRead([row.readRef]);
    // A link opens in a new tab, and a sign-up or form in chat: no panel.
    if (row.kind !== "link" && row.kind !== "card") setOpened(row);
  };
  // `/activity?review=<taskId>`: a "submitted a task" notification
  // (`deepLinkFor` in the bell). Opens that task's panel once the read has
  // it, however the list is narrowed; a task no longer in the feed opens
  // nothing. The read is taken again first: the one in hand can predate the
  // submission (the page was open, or its read cached). A task the fresh
  // read doesn't hold (confirmed elsewhere, or past the read's cap) goes to
  // the board, whose waiting column lists every completion.
  const router = useRouter();
  const pathname = usePathname();
  const openReview = async (taskId: string) => {
    const result = await activity.refetch();
    const row = result.data
      ? findActivityTaskRow(result.data, taskId, new Date())
      : null;
    if (row) {
      openFromList(row);
      router.replace(pathname, { scroll: false });
    } else {
      router.replace("/tasks");
    }
  };
  // Remove (off everyone's Activity) is `channels:manage`'s, as in chat.
  const permissions = useMyPermissions();
  const canRemoveLinks = can("channels:manage", permissions.data?.permissions);
  const linkActions = useActivityLinkActions();
  const actionGate = activityRowActionGate(useSubscriptionGate());
  // Faces on the rows (#4402, item 4), from the roster chat already reads.
  const faceFor = useActivityFaces();

  const agenda = useMemo(
    () => (visible ? activityAgenda(visible, filter, now) : null),
    [visible, filter, now],
  );
  // Only for the roles that review: a member is never shown the card.
  const canConfirmTasks =
    (isModuleEnabled?.("tasks") ?? true) &&
    can("tasks:manage", permissions.data?.permissions);
  const review = useMemo(
    () => (visible ? activityReview(visible, { canConfirmTasks }, now) : null),
    [visible, canConfirmTasks, now],
  );
  // What the member made, and the links posted for them, in order.
  const groups = useMemo(
    () => (visible ? activityGroups(visible, now) : []),
    [visible, now],
  );
  // Narrowed to a kind, the page is the To do list alone.
  const below =
    filter === "all"
      ? groups.filter(
          (group) =>
            group.rows.length > 0 ||
            group.archive !== null ||
            group.unavailable.length > 0,
        )
      : [];
  // The waiting reviews a review steps through (#4693), however the list is
  // narrowed.
  const reviewQueue = useMemo(
    () => (visible ? activityReviewQueue(visible, now) : []),
    [visible, now],
  );
  const openRow = useMemo(
    () =>
      opened === null
        ? null
        : ([
            ...(agenda?.rows ?? []),
            ...(review?.rows ?? []),
            ...groups.flatMap((group) => [
              ...group.rows,
              ...(group.archive?.rows ?? []),
            ]),
            ...snoozedRows,
          ].find((row) => row.key === opened.key) ?? opened),
    [agenda, review, groups, snoozedRows, opened],
  );

  if (isOffline && anyReadUncached(activity)) {
    return (
      <OfflineState
        title="Activity unavailable offline"
        description="Reconnect to see your week and what's left to do."
        onRetry={() => void activity.refetch()}
      />
    );
  }
  // Held until the viewer is known (as the Events page holds its view): the
  // panel a row opens draws for the viewer.
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
  const kit: RowKit = {
    canRemoveLinks,
    snooze: snoozeActions,
    linkActions,
    rowActions: { gate: actionGate, onActed: actedOnRow },
    onOpen: openFromList,
  };
  // The week card's next thing and the To review card's queue.
  const rowOnCard = (item: ActivityRow): ReactNode => (
    <Row key={item.key} row={item} kit={kit} onCard />
  );

  return (
    <ActivityFaces.Provider value={faceFor}>
      <div className="@container">
        <div className="space-y-8">
          {summary && agenda ? (
            <WeekCard
              summary={summary}
              next={agenda.next ? rowOnCard(agenda.next) : null}
              nextLabel={agenda.nextLabel}
              filter={filter}
              onFilter={setPicked}
            />
          ) : null}
          {standing.isPending ? (
            <SemesterStripSkeleton />
          ) : standing.data ? (
            <SemesterStrip standing={standing.data} />
          ) : null}
          {review ? <ReviewCard review={review} renderRow={rowOnCard} /> : null}
          {agenda ? (
            <ToDoSection
              days={agenda.days}
              unavailable={agenda.unavailable}
              filter={filter}
              // The one thing left is already on the week card.
              onCard={agenda.next !== null}
              onShowAll={() => {
                // The note and its button leave with the narrowing, so the
                // week line that set it takes the focus they held.
                document
                  .getElementById(`activity-week-line-${filter}`)
                  ?.focus();
                setPicked("all");
              }}
              kit={kit}
            />
          ) : null}
          {below.map((group) => (
            <GroupSection key={group.id} group={group} kit={kit} />
          ))}
          {filter === "all" && snoozedRows.length > 0 ? (
            <SnoozedSection rows={snoozedRows} kit={kit} />
          ) : null}
        </div>

        <Suspense fallback={null}>
          <ReviewParam open={openReview} />
        </Suspense>
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
          reviewQueue={{
            after: (key) => {
              const at = reviewQueue.findIndex((item) => item.key === key);
              return at === -1
                ? reviewQueue.filter((item) => item.key !== key)
                : // Only those after it: one before it was confirmed or
                  // skipped already, and the list still holds the skipped.
                  reviewQueue.slice(at + 1);
            },
            open: openFromList,
          }}
        />
      </div>
    </ActivityFaces.Provider>
  );
}
