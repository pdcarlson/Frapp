/**
 * The s08 task board: narrow `GET /v1/tasks`, keep the viewer's own rows, and
 * split them into the two drawn sections.
 *
 * `GET /v1/tasks` is declared in `openapi.json` with no response schema, so
 * `openapi-typescript` infers its body as `never`. Narrowed at the boundary
 * with the shared readers in `lib/more/narrow.ts`, exactly as the events and
 * More-hub selectors do — a row that cannot be drawn honestly is dropped here
 * rather than rendering "Invalid Date" downstream.
 */

import { num, records, str } from "@/lib/more/narrow";
import { dayDelta, daysSinceCompletion, parseTaskDate } from "./format";
import { isOpenTask } from "./transitions";

/**
 * Days after **completion** that a finished task keeps its place on the board.
 *
 * Deliberately measured from `completed_at`, not from the due date. Keying it on
 * the deadline retires a task by how old its *deadline* is, so completing a
 * three-week-late task would drop the row in the same render as the tap that
 * closed it — the checkbox never filling, the row simply vanishing under the
 * member's finger, which reads as a delete rather than a completion.
 */
const COMPLETED_RETENTION_DAYS = 7;

/** Days ahead that still counts as "this week" — a rolling window, not a calendar one. */
const THIS_WEEK_DAYS = 7;

export interface TaskRowModel {
  id: string;
  title: string;
  /** The persisted status. What `nextTapSequence` keys off. May be `null`. */
  storedStatus: string | null;
  /** What the server wants rendered — may be the synthesized `OVERDUE`. */
  displayStatus: string | null;
  dueDate: string | null;
  completedAt: string | null;
  pointReward: number | null;
  pointsAwarded: boolean;
  isDone: boolean;
  isOverdue: boolean;
}

export interface TaskBoard {
  dueThisWeek: TaskRowModel[];
  later: TaskRowModel[];
  /** Rows kept after filtering — what distinguishes an empty board from a full one. */
  total: number;
}

const EMPTY_BOARD: TaskBoard = { dueThisWeek: [], later: [], total: 0 };

function toRow(row: Record<string, unknown>): TaskRowModel | null {
  const id = str(row, "id");
  const title = str(row, "title");
  if (!id || !title) return null;

  const storedStatus = str(row, "stored_status");
  const displayStatus = str(row, "status");

  return {
    id,
    title,
    storedStatus,
    displayStatus,
    dueDate: str(row, "due_date"),
    completedAt: str(row, "completed_at"),
    pointReward: num(row, "point_reward"),
    pointsAwarded: row.points_awarded === true,
    // Read off the row, never recomputed. `toDisplayStatus` derives it in UTC
    // against the *server's* today; a local recomputation would disagree with it
    // every evening west of Greenwich — which is exactly when someone finishes
    // a task due today.
    isDone: !isOpenTask(storedStatus ?? displayStatus),
    isOverdue: displayStatus === "OVERDUE",
  };
}

/**
 * Days until this row is due, or `null` when the date is missing or unreadable.
 *
 * `due_date` is `NOT NULL` in `task.entity.ts`, so `null` here is defensive
 * only — but the row is still kept and sorted last rather than dropped, because
 * hiding a task the member owes is the worse failure.
 */
function dueInDays(row: TaskRowModel, now: Date): number | null {
  if (!row.dueDate) return null;
  const due = parseTaskDate(row.dueDate);
  return due ? dayDelta(now, due) : null;
}

/** A row paired with its due-day offset, computed once rather than per comparison. */
interface RankedRow {
  row: TaskRowModel;
  days: number | null;
}

/**
 * Rank inside a section: overdue first (most overdue leading), then open rows by
 * due date, then finished rows, then anything undateable.
 */
function compareRows(a: RankedRow, b: RankedRow): number {
  if (a.row.isDone !== b.row.isDone) return a.row.isDone ? 1 : -1;

  if (a.days === null || b.days === null) {
    if (a.days !== b.days) return a.days === null ? 1 : -1;
  } else if (a.days !== b.days) {
    return a.days - b.days;
  }

  // Ties break on title so the board does not reshuffle between renders of the
  // same data — two tasks due the same day is the ordinary case, not an edge.
  return a.row.title.localeCompare(b.row.title);
}

/**
 * The viewer's board.
 *
 * ## Why this filters by assignee
 *
 * `TaskService.list` returns the chapter's *whole* task set to a `tasks:manage`
 * holder and only the caller's own rows to everyone else, and `useTasks()`
 * deliberately takes no assignee argument (`GET /v1/tasks` accepts no query
 * parameters). s08 is drawn as a personal board, so an officer would otherwise
 * see every brother's tasks under "Semester points" and a checkbox they cannot
 * legally tap. The hook's own doc comment names this as the caller's job.
 *
 * ## `viewerUserId === null` is not "no tasks"
 *
 * It means `/v1/users/me` has not resolved yet. Returning an empty board is
 * correct here — there is no identity to filter against — but the *screen* must
 * treat it as still-loading, or every cold start flashes "No tasks assigned"
 * before the real rows arrive.
 */
export function selectTaskRows(
  data: unknown,
  viewerUserId: string | null,
  now: Date,
): TaskBoard {
  if (!viewerUserId) return EMPTY_BOARD;

  const dueThisWeek: RankedRow[] = [];
  const later: RankedRow[] = [];

  for (const raw of records(data)) {
    if (str(raw, "assignee_id") !== viewerUserId) continue;
    const row = toRow(raw);
    if (!row) continue;

    const days = dueInDays(row, now);

    // A finished task stops being news. Without a retention rule the board
    // accumulates every task the member has ever closed, and no other surface
    // holds that history — the ledger in `spec/behavior/points.md` records the
    // award, not the task. Canvas draws one done row and specifies no policy;
    // this window is the PR's proposal.
    //
    // Age is measured from completion, and a row whose `completed_at` cannot be
    // read is **kept**: the alternative is retiring a task on a timestamp this
    // module never saw. The optimistic path always supplies one —
    // `useUpdateTaskStatus` stamps `completed_at` alongside the status — so the
    // just-completed row stays put and draws "Done today" as drawn.
    if (row.isDone) {
      const sinceDone = daysSinceCompletion(row.completedAt, now);
      if (sinceDone !== null && sinceDone > COMPLETED_RETENTION_DAYS) continue;
    }

    // Overdue rows land in DUE THIS WEEK rather than a section of their own:
    // Canvas draws no OVERDUE section, and an overdue task is the most urgent
    // thing the board can say — burying it below "this week" would invert that.
    // The 7-day boundary is not arbitrary either: `formatDueSubtitle` switches
    // from a weekday name to an absolute date at exactly `days < 7`, and the
    // drawing agrees (its LATER row reads "Due Aug 22").
    if (days !== null && days < THIS_WEEK_DAYS) {
      dueThisWeek.push({ row, days });
    } else {
      later.push({ row, days });
    }
  }

  dueThisWeek.sort(compareRows);
  later.sort(compareRows);

  return {
    dueThisWeek: dueThisWeek.map((entry) => entry.row),
    later: later.map((entry) => entry.row),
    total: dueThisWeek.length + later.length,
  };
}
