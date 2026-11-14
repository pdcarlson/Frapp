"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Cake, Circle, CircleCheck, UsersRound } from "lucide-react";
import {
  CALENDAR_LAYERS,
  calendarTaskAccessibleLabel,
  type CalendarItem,
  type CalendarLayer,
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
 * Tasks on the Events calendar (#4144). An event is a filled chip with an
 * edge; a task has no fill and leads with a round check mark, the way Google
 * Calendar sets its tasks apart from its events. The mark says where the
 * task stands: an empty ring is still to do (red when overdue), a ring with a
 * check is done and waiting on an officer, a green check is confirmed.
 * Rules and words: `@repo/hooks` `calendar-tasks.ts`.
 */

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

function dueLabel(day: string): string {
  const at = parseInstantOrBareLocalNoon(day);
  return at
    ? at.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : day;
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
  /** The trigger: a chip on the wide month, a row under the compact one. */
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3 p-4">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{item.title}</p>
          <p className="text-caption text-muted-foreground">
            Due {dueLabel(item.day)}
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
 * A member's birthday on the grid (#4959): a cake and their name, no fill and
 * nothing to open, the way Google Calendar draws its birthdays calendar apart
 * from events. The name reads "Dana Lowe's birthday" to a screen reader.
 */
function BirthdayItem({
  item,
  row,
}: {
  item: CalendarBirthday;
  /** The compact month's row under the picked day, rather than a chip. */
  row: boolean;
}) {
  const label = calendarBirthdayLabel(item);
  return (
    <div
      title={label}
      className={cn(
        "flex items-center text-left",
        row
          ? "min-h-11 w-full gap-3 px-2 py-1.5"
          : "gap-1 px-1.5 py-1 text-[11px] font-medium",
      )}
    >
      <span className={cn("flex shrink-0 items-center", row ? "w-16" : null)}>
        <Cake
          aria-hidden="true"
          className={cn("text-muted-foreground", row ? "h-4 w-4" : "h-3 w-3")}
        />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-foreground",
          row ? "text-sm font-semibold" : null,
        )}
      >
        <span className="sr-only">{label}</span>
        <span aria-hidden="true">{item.title}</span>
      </span>
      {row ? (
        <span className="shrink-0 text-caption text-muted-foreground">
          Birthday
        </span>
      ) : null}
    </div>
  );
}

/**
 * The wide month's chip for a task (no fill, a check mark, the title), or a
 * birthday's.
 */
export function CalendarTaskChip({
  item,
  nameOf,
}: {
  item: CalendarItem;
  nameOf: (userId: string) => string;
}) {
  if (item.kind === "birthdays")
    return <BirthdayItem item={item} row={false} />;
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
          "flex items-center gap-1 rounded-xs px-1.5 py-1 text-left text-[11px] font-medium transition-colors",
          FOCUS_RING,
          "hover:bg-card-hover",
        )}
      >
        <TaskMark state={item.state} className="h-3 w-3" />
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

/** The compact month's row for a task or a birthday, under the picked day. */
export function CalendarTaskRow({
  item,
  nameOf,
}: {
  item: CalendarItem;
  nameOf: (userId: string) => string;
}) {
  if (item.kind === "birthdays") return <BirthdayItem item={item} row />;
  return <TaskRow item={item} nameOf={nameOf} />;
}

function TaskRow({
  item,
  nameOf,
}: {
  item: CalendarTask;
  nameOf: (userId: string) => string;
}) {
  const trailing = item.kind === "mine" ? item.label : item.progress;
  return (
    <CalendarTaskPopover item={item} nameOf={nameOf}>
      <button
        type="button"
        title={item.title}
        aria-label={calendarTaskAccessibleLabel(item)}
        className={cn(
          "flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors",
          FOCUS_RING,
          "hover:bg-card-hover",
        )}
      >
        <span className="flex w-16 shrink-0 items-center gap-1.5">
          <TaskMark state={item.state} className="h-4 w-4" />
          {item.kind === "assigned" ? (
            <UsersRound
              aria-hidden="true"
              className="h-3.5 w-3.5 text-muted-foreground"
            />
          ) : null}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm font-semibold",
            taskTitleClassName(item.state),
          )}
        >
          {item.title}
        </span>
        <span
          className={cn(
            "shrink-0 text-caption",
            item.state === "overdue"
              ? "text-destructive-text"
              : "text-muted-foreground",
          )}
        >
          {trailing}
        </span>
      </button>
    </CalendarTaskPopover>
  );
}

/**
 * What the calendar shows, as toggles that double as its key: each carries
 * the mark its kind is drawn with, the way Google Calendar's list of
 * calendars both explains and switches its colours. Only kinds the viewer
 * has are offered; a member with no tasks sees no row at all.
 */
export function CalendarLayerToggles({
  offered,
  shown,
  onToggle,
}: {
  offered: ReadonlySet<CalendarLayer>;
  shown: ReadonlySet<CalendarLayer>;
  onToggle: (layer: CalendarLayer) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Show on calendar"
      className="flex flex-wrap items-center gap-1.5"
    >
      {CALENDAR_LAYERS.filter((layer) => offered.has(layer.value)).map(
        (layer) => {
          const on = shown.has(layer.value);
          return (
            <button
              key={layer.value}
              type="button"
              aria-pressed={on}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-caption font-semibold transition-colors",
                FOCUS_RING,
                on
                  ? "border-input bg-surface-1 text-foreground hover:bg-card-hover"
                  : "border-dashed border-input text-muted-foreground hover:text-foreground",
              )}
              onClick={() => onToggle(layer.value)}
            >
              <span aria-hidden="true" className={cn(on ? null : "opacity-40")}>
                {layer.value === "events" ? (
                  <span className="block h-3 w-1 rounded-full bg-primary" />
                ) : layer.value === "mine" ? (
                  <Circle className="h-3 w-3 text-muted-foreground" />
                ) : layer.value === "birthdays" ? (
                  <Cake className="h-3 w-3 text-muted-foreground" />
                ) : (
                  <UsersRound className="h-3 w-3 text-muted-foreground" />
                )}
              </span>
              {layer.label}
            </button>
          );
        },
      )}
    </div>
  );
}
