"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Circle, CircleCheck } from "lucide-react";
import { CALENDAR_KIND_HUE } from "@repo/hooks/activity-agenda";
import {
  calendarTaskAccessibleLabel,
  type CalendarItem,
  type CalendarTask,
  type CalendarTaskState,
} from "@repo/hooks/calendar-tasks";
import {
  calendarBirthdayLabel,
  type CalendarBirthday,
} from "@repo/hooks/calendar-birthdays";
import { parseInstantOrBareLocalNoon } from "@repo/formatting";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Tasks and birthdays on Events (#4144, #4959): the agenda's rows (#5560)
 * and the hour grid's all-day chips. On the agenda a task leads with a ring
 * in the Tasks hue, filled once it is done, and a birthday with a square in
 * the Birthdays hue (`CALENDAR_KIND_HUE`), the marks the navigator's dots and
 * the colour key draw. Rules and words: `@repo/hooks` `calendar-tasks.ts`.
 */

/**
 * A chip's text on the month grid: the event chips' 11px (ledgered in
 * `type-scale-call-sites.spec.ts`, #3075 decides), shared by the task and
 * birthday chips that sit in the same day cell.
 */
const CHIP_TEXT = "text-[11px] font-medium";

function TaskMark({
  state,
  className,
}: {
  state: CalendarTaskState;
  className?: string;
}) {
  const shared = cn("shrink-0", className);
  if (state === "confirmed") {
    return (
      <CircleCheck aria-hidden="true" className={cn(shared, "text-success")} />
    );
  }
  if (state === "waiting") {
    return (
      <CircleCheck
        aria-hidden="true"
        className={cn(shared, "text-muted-foreground")}
      />
    );
  }
  return (
    <Circle
      aria-hidden="true"
      className={cn(
        shared,
        state === "overdue" ? "text-destructive-text" : "text-muted-foreground",
      )}
    />
  );
}

/** A finished task's title steps back, so what is still open stands out. */
function taskTitleClassName(state: CalendarTaskState): string {
  if (state === "confirmed") return "text-muted-foreground line-through";
  if (state === "waiting") return "text-muted-foreground";
  return "text-foreground";
}

/**
 * What an assigned task adds on the grid, so it reads apart from the
 * viewer's own: who it went to ("Julian"), or for a task handed to many,
 * how many are done ("8/20").
 */
function assignedTrailing(
  item: CalendarTask,
  nameOf: (userId: string) => string,
): string | null {
  if (item.kind !== "assigned") return null;
  if (item.assignees.length === 1) {
    const name = nameOf(item.assignees[0]!.userId);
    return name.split(/\s+/)[0] ?? name;
  }
  return `${item.doneCount}/${item.assignees.length}`;
}

function badgeVariant(state: CalendarTaskState) {
  if (state === "overdue") return "destructive" as const;
  if (state === "confirmed") return "success" as const;
  return "outline" as const;
}

/** "Thursday, November 20", and " at 5 PM" for a task due at a time. */
function dueLabel(item: CalendarTask): string {
  const at = parseInstantOrBareLocalNoon(item.day);
  const day = at
    ? at.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : item.day;
  return item.timeLabel ? `${day} at ${item.timeLabel}` : day;
}

/**
 * A task's card, opened from its chip or row: where it stands and, for a
 * task the viewer assigned, where each assignee stands. The Tasks page is
 * where it is worked, so the card ends with the way there.
 */
function CalendarTaskPopover({
  item,
  nameOf,
  children,
}: {
  item: CalendarTask;
  nameOf: (userId: string) => string;
  /** The trigger: an agenda row, or a chip or marker on the hour grid. */
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3 p-4">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{item.title}</p>
          <p className="text-caption text-muted-foreground">
            Due {dueLabel(item)}
          </p>
        </div>
        {item.kind === "mine" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={badgeVariant(item.state)}>{item.label}</Badge>
            {item.createdBy ? (
              <span className="text-caption text-muted-foreground">
                Assigned by {nameOf(item.createdBy)}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-caption font-semibold text-foreground">
              {item.assignees.length === 1
                ? `Assigned to ${nameOf(item.assignees[0]!.userId)}`
                : `${item.doneCount} of ${item.assignees.length} done`}
            </p>
            {item.assignees.length > 1 ? (
              <ul
                role="list"
                className="max-h-56 space-y-1 overflow-y-auto pr-1"
              >
                {item.assignees.map((assignee) => (
                  <li
                    key={assignee.taskId}
                    className="flex items-center gap-2 text-sm"
                  >
                    <TaskMark state={assignee.state} className="h-3.5 w-3.5" />
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {nameOf(assignee.userId)}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-caption",
                        assignee.state === "overdue"
                          ? "text-destructive-text"
                          : "text-muted-foreground",
                      )}
                    >
                      {assignee.label}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Badge variant={badgeVariant(item.state)}>{item.progress}</Badge>
            )}
          </div>
        )}
        <Button asChild variant="secondary" size="toolbar">
          <Link href="/tasks">Open Tasks</Link>
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A member's birthday on the hour grid's all-day strip (#4959): its rose
 * square and their name, no fill and nothing to open. The name reads "Dana Lowe's
 * birthday" to a screen reader.
 */
function BirthdayChip({ item }: { item: CalendarBirthday }) {
  const label = calendarBirthdayLabel(item);
  return (
    <div
      title={label}
      className={cn("flex items-center gap-1 px-1.5 py-1 text-left", CHIP_TEXT)}
    >
      <KindMark kind="birthdays" size="small" />
      <span className="min-w-0 flex-1 truncate text-foreground">
        <span className="sr-only">{label}</span>
        <span aria-hidden="true">{item.title}</span>
      </span>
    </div>
  );
}

/**
 * A kind's mark (#5560): a task's ring in the Tasks hue, filled once done,
 * or a birthday's square in the Birthdays hue. The agenda's rows draw it at
 * 16px and the hour grid's chips at 12px, so both read as the dots do.
 */
export function KindMark({
  kind,
  done = false,
  size = "row",
}: {
  kind: "tasks" | "birthdays";
  done?: boolean;
  size?: "row" | "small";
}) {
  const hue = CALENDAR_KIND_HUE[kind];
  return (
    <span
      aria-hidden="true"
      data-testid="agenda-mark"
      data-hue={hue}
      data-done={done || undefined}
      className={cn(
        "shrink-0",
        size === "row" ? "h-4 w-4" : "h-3 w-3",
        kind === "tasks"
          ? cn("rounded-full", size === "row" ? "border-2" : "border-[1.5px]")
          : size === "row"
            ? "rounded-[4px]"
            : "rounded-[3px]",
      )}
      style={
        kind === "tasks"
          ? { borderColor: hue, backgroundColor: done ? hue : undefined }
          : { backgroundColor: hue }
      }
    />
  );
}

/** A task is done for its mark once it is marked, signed off or not. */
function isDone(state: CalendarTaskState): boolean {
  return state === "waiting" || state === "confirmed";
}

/** The hour grid's chip for a task (its green ring, the title), or a birthday's. */
export function CalendarTaskChip({
  item,
  nameOf,
}: {
  item: CalendarItem;
  nameOf: (userId: string) => string;
}) {
  if (item.kind === "birthdays") return <BirthdayChip item={item} />;
  return <TaskChip item={item} nameOf={nameOf} />;
}

function TaskChip({
  item,
  nameOf,
}: {
  item: CalendarTask;
  nameOf: (userId: string) => string;
}) {
  const trailing = assignedTrailing(item, nameOf);
  return (
    <CalendarTaskPopover item={item} nameOf={nameOf}>
      <button
        type="button"
        title={item.title}
        aria-label={calendarTaskAccessibleLabel(item)}
        className={cn(
          "flex items-center gap-1 rounded-xs px-1.5 py-1 text-left transition-colors",
          CHIP_TEXT,
          FOCUS_RING,
          "hover:bg-card-hover",
        )}
      >
        <KindMark kind="tasks" done={isDone(item.state)} size="small" />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            taskTitleClassName(item.state),
          )}
        >
          {item.title}
        </span>
        {trailing ? (
          <span className="max-w-[40%] shrink-0 truncate tabular-nums text-muted-foreground">
            {trailing}
          </span>
        ) : null}
      </button>
    </CalendarTaskPopover>
  );
}

/**
 * A task due at a time on the hour grid (#5116): a slim marker at that
 * time, the way Google Calendar draws a timed task: its ring, then its time,
 * then as much of its title as fits (a narrow lane beside an event keeps the
 * time), and for one the viewer assigned, who it went to or how many are
 * done, as the strip's chip says. Where it sits is the grid's (`timeGridColumns`);
 * `style` places it. It opens the task's card, as the strip's chip does.
 */
export function CalendarTaskBlock({
  item,
  nameOf,
  style,
}: {
  item: CalendarTask;
  nameOf: (userId: string) => string;
  style: CSSProperties;
}) {
  const trailing = assignedTrailing(item, nameOf);
  return (
    <CalendarTaskPopover item={item} nameOf={nameOf}>
      <button
        type="button"
        title={item.title}
        aria-label={calendarTaskAccessibleLabel(item)}
        data-kind="tasks"
        data-testid={`time-grid-task-${item.key}`}
        className={cn(
          "absolute z-10 flex items-center gap-1 overflow-hidden rounded-xs border border-border bg-card px-1.5 text-left leading-tight ring-1 ring-background transition-colors hover:bg-card-hover",
          CHIP_TEXT,
          FOCUS_RING,
        )}
        style={style}
      >
        <KindMark kind="tasks" done={isDone(item.state)} size="small" />
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {item.timeLabel}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            taskTitleClassName(item.state),
          )}
        >
          {item.title}
        </span>
        {trailing ? (
          <span className="max-w-[40%] shrink-0 truncate tabular-nums text-muted-foreground">
            {trailing}
          </span>
        ) : null}
      </button>
    </CalendarTaskPopover>
  );
}

/** The agenda row's frame, shared by every kind so their text lines up. */
export const AGENDA_ROW_CLASS =
  "flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-1.5 text-left";

/** The 16px column every agenda row leads with: its kind's mark. */
export function AgendaMarkSlot({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex w-4 shrink-0 items-center justify-center self-stretch"
    >
      {children}
    </span>
  );
}

/**
 * A task on the agenda (#5560): a ring in the Tasks hue, filled once the
 * task is done (waiting on an officer or confirmed), when its title steps
 * back. Its line under the title starts with its time when it has one. One row per task the viewer assigned to many (`selectCalendarTasks`
 * groups them), naming its progress at the right. It opens the task's card.
 */
export function AgendaTaskRow({
  item,
  nameOf,
}: {
  item: CalendarTask;
  nameOf: (userId: string) => string;
}) {
  const done = isDone(item.state);
  const status =
    item.kind === "mine"
      ? item.label
      : item.assignees.length === 1
        ? item.assignees[0]!.label
        : "Assigned by you";
  // A task due at a time leads with it, as an event's row does (#5116).
  const meta = item.timeLabel ? `${item.timeLabel} · ${status}` : status;
  const trailing =
    item.kind === "mine"
      ? null
      : item.assignees.length === 1
        ? nameOf(item.assignees[0]!.userId)
        : item.progress;
  return (
    <CalendarTaskPopover item={item} nameOf={nameOf}>
      <button
        type="button"
        aria-label={calendarTaskAccessibleLabel(item)}
        data-kind="tasks"
        className={cn(
          AGENDA_ROW_CLASS,
          "transition-colors hover:bg-card-hover",
          FOCUS_RING,
        )}
      >
        <AgendaMarkSlot>
          <KindMark kind="tasks" done={done} />
        </AgendaMarkSlot>
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              "truncate text-sm font-semibold",
              done ? "text-muted-foreground line-through" : "text-foreground",
            )}
          >
            {item.title}
          </span>
          <span
            className={cn(
              "truncate text-caption",
              item.state === "overdue"
                ? "text-destructive-text"
                : "text-muted-foreground",
            )}
          >
            {meta}
          </span>
        </span>
        {trailing ? (
          <span className="max-w-[40%] shrink-0 truncate text-caption tabular-nums text-muted-foreground">
            {trailing}
          </span>
        ) : null}
      </button>
    </CalendarTaskPopover>
  );
}

/**
 * A member's birthday on the agenda (#4959, #5560): a square in the
 * Birthdays hue and their name. Nothing to open.
 */
export function AgendaBirthdayRow({ item }: { item: CalendarBirthday }) {
  return (
    <div data-kind="birthdays" className={AGENDA_ROW_CLASS}>
      <AgendaMarkSlot>
        <KindMark kind="birthdays" />
      </AgendaMarkSlot>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold text-foreground">
          <span className="sr-only">{calendarBirthdayLabel(item)}</span>
          <span aria-hidden="true">{item.title}</span>
        </span>
        <span aria-hidden="true" className="text-caption text-muted-foreground">
          Birthday
        </span>
      </span>
    </div>
  );
}
