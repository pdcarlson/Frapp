import type { components } from "@repo/api-sdk";
import { TASK_CONFIRMED_LABEL, TASK_STATUS_LABELS } from "./task-card";
import {
  formatDueLabel,
  formatMinutesRounded,
  formatRelativeDayTime,
} from "@repo/formatting";

export type Activity = components["schemas"]["ActivityDto"];
export type ActivityTask = components["schemas"]["ActivityTaskDto"];
export type ActivityPoll = components["schemas"]["ActivityPollDto"];
export type ActivityEvent = components["schemas"]["ActivityEventDto"];
export type ActivityHours = components["schemas"]["ActivityHoursEntryDto"];
export type ActivityFile = components["schemas"]["ActivityFileDto"];
export type ActivitySection = Activity["unavailable"][number];

/** The filter chips: everything, or one kind of thing. */
export const ACTIVITY_FILTERS = [
  { value: "all", label: "All" },
  { value: "task", label: "Tasks" },
  { value: "poll", label: "Polls" },
  { value: "event", label: "Events" },
  { value: "hours", label: "Hours" },
  { value: "file", label: "Files" },
] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number]["value"];
export type ActivityKind = Exclude<ActivityFilter, "all">;

/**
 * A row badge's tone. `outline` is quiet metadata that must not read as a
 * status; the others are the semantic status colours. Web hands it to
 * `Badge` as its variant; the phone maps it to a status hue.
 */
export type ActivityBadgeVariant =
  "outline" | "success" | "warning" | "destructive";

interface RowBase {
  /** Unique on the page: the same task can sit under two groups. */
  key: string;
  title: string;
  detail: string;
  badge: { label: string; variant: ActivityBadgeVariant } | null;
}

/** One row of the page: what it shows, and the record it opens. */
export type ActivityRow = RowBase &
  (
    | { kind: "task"; task: ActivityTask }
    | { kind: "poll"; poll: ActivityPoll }
    | { kind: "event"; event: ActivityEvent }
    | { kind: "hours"; entry: ActivityHours }
    | { kind: "file"; file: ActivityFile }
  );

export interface ActivityGroup {
  id: "needs-you" | "coming-up" | "made-by-you";
  label: string;
  /** Said in place of the rows when the group has none. */
  empty: string;
  rows: ActivityRow[];
  /** Sections behind this group that could not be read this time. */
  unavailable: ActivitySection[];
}

/** A name for a section the read could not load, for "Couldn't load …". */
export const ACTIVITY_SECTION_NAMES: Record<ActivitySection, string> = {
  tasks: "tasks",
  hours_approvals: "hours waiting for approval",
  polls: "polls",
  coming_up: "events",
  files: "files",
  made_events: "events you made",
};

function channelLabel(poll: ActivityPoll): string {
  // A direct message's channel name is server-generated (`dm-<id>-<id>`).
  if (poll.channel_type === "DM") return "Direct message";
  if (poll.channel_type === "GROUP_DM") return "Group message";
  return `#${poll.channel_name}`;
}

function pollRow(poll: ActivityPoll, group: string): ActivityRow {
  const closes = poll.closes_at ? formatRelativeDayTime(poll.closes_at) : null;
  return {
    kind: "poll",
    key: `${group}:poll:${poll.message_id}`,
    poll,
    title: poll.question,
    detail: [
      channelLabel(poll),
      poll.is_closed ? null : closes ? `closes ${closes}` : "no closing time",
    ]
      .filter(Boolean)
      .join(" · "),
    badge: poll.is_closed
      ? { label: "Closed", variant: "outline" }
      : poll.has_voted
        ? { label: "Voted", variant: "success" }
        : { label: "Vote", variant: "warning" },
  };
}

function taskRow(
  task: ActivityTask,
  group: string,
  role: "mine" | "confirm" | "assigned",
): ActivityRow {
  // A finished task has no countdown: "Overdue by 2 days" under a task that is
  // done would be wrong.
  const due =
    task.stored_status === "COMPLETED" ? null : formatDueLabel(task.due_date);
  const who =
    role === "mine"
      ? task.created_by_name
        ? `from ${task.created_by_name}`
        : null
      : task.assignee_name || null;
  const badge: RowBase["badge"] =
    role === "confirm"
      ? { label: "Confirm", variant: "warning" }
      : {
          // The shared words every task surface uses (`@repo/hooks`).
          label:
            task.status === "COMPLETED" && task.confirmed_at
              ? TASK_CONFIRMED_LABEL
              : TASK_STATUS_LABELS[task.status],
          variant:
            task.status === "OVERDUE"
              ? "destructive"
              : task.status === "COMPLETED" && task.confirmed_at
                ? "success"
                : "outline",
        };
  return {
    kind: "task",
    key: `${group}:task:${task.id}`,
    task,
    title: task.title,
    detail: [who, due].filter(Boolean).join(" · "),
    badge,
  };
}

function hoursRow(entry: ActivityHours): ActivityRow {
  return {
    kind: "hours",
    key: `needs:hours:${entry.id}`,
    entry,
    title: entry.description || "Service hours",
    detail: [
      entry.member_name || null,
      formatMinutesRounded(entry.duration_minutes),
    ]
      .filter(Boolean)
      .join(" · "),
    badge: { label: "Approve", variant: "warning" },
  };
}

function eventRow(event: ActivityEvent, group: string): ActivityRow {
  const needsCheckIn = event.check_in_open && !event.checked_in;
  return {
    kind: "event",
    key: `${group}:event:${event.id}`,
    event,
    title: event.name,
    detail: [formatRelativeDayTime(event.start_time), event.location]
      .filter(Boolean)
      .join(" · "),
    badge: needsCheckIn
      ? { label: "Check in", variant: "warning" }
      : event.checked_in
        ? { label: "Checked in", variant: "success" }
        : event.attendance === "required"
          ? { label: "Required", variant: "outline" }
          : null,
  };
}

function fileRow(file: ActivityFile): ActivityRow {
  return {
    kind: "file",
    key: `file:${file.source}:${file.id}`,
    file,
    title: file.title || "Untitled file",
    detail: [
      file.source === "document" ? "Documents" : "Backwork",
      formatRelativeDayTime(file.created_at),
    ].join(" · "),
    badge: null,
  };
}

/**
 * The page's three groups, in the order it draws them, already narrowed to
 * one kind when a chip is set.
 *
 * "Needs you" leads with what is most pressing: an event the member can check
 * in to right now, then tasks, confirmations, approvals and polls, each in the
 * order the read serves it. An event that needs a check-in is listed under
 * "Needs you" and not again under "Coming up".
 */
export function activityGroups(
  activity: Activity,
  filter: ActivityFilter,
): ActivityGroup[] {
  const down = new Set(activity.unavailable);
  const keep = (rows: ActivityRow[]) =>
    filter === "all" ? rows : rows.filter((row) => row.kind === filter);
  const downFor = (sections: ActivitySection[], kinds: ActivityKind[]) =>
    sections.filter(
      (section, index) =>
        down.has(section) && (filter === "all" || filter === kinds[index]),
    );

  const checkInNow = activity.coming_up.filter(
    (event) => event.check_in_open && !event.checked_in,
  );
  const later = activity.coming_up.filter(
    (event) => !(event.check_in_open && !event.checked_in),
  );

  return [
    {
      id: "needs-you",
      label: "Needs you",
      empty: "Nothing is waiting on you.",
      rows: keep([
        ...checkInNow.map((event) => eventRow(event, "needs")),
        ...activity.needs_you.tasks.map((task) =>
          taskRow(task, "needs", "mine"),
        ),
        ...activity.needs_you.task_confirmations.map((task) =>
          taskRow(task, "needs-confirm", "confirm"),
        ),
        ...activity.needs_you.hours_approvals.map(hoursRow),
        ...activity.needs_you.polls.map((poll) => pollRow(poll, "needs")),
      ]),
      unavailable: downFor(
        ["tasks", "hours_approvals", "polls", "coming_up"],
        ["task", "hours", "poll", "event"],
      ),
    },
    {
      id: "coming-up",
      label: "Coming up",
      empty: "No events in the next two weeks.",
      rows: keep(later.map((event) => eventRow(event, "coming"))),
      unavailable: downFor(["coming_up"], ["event"]),
    },
    {
      id: "made-by-you",
      label: "Made by you",
      empty:
        "Polls you post, events you make, tasks you assign and files you upload show up here.",
      rows: keep([
        ...activity.made_by_you.polls.map((poll) => pollRow(poll, "made")),
        ...activity.made_by_you.events.map((event) => eventRow(event, "made")),
        ...activity.made_by_you.tasks.map((task) =>
          taskRow(task, "made", "assigned"),
        ),
        ...activity.made_by_you.files.map(fileRow),
      ]),
      unavailable: downFor(
        ["polls", "made_events", "tasks", "files"],
        ["poll", "event", "task", "file"],
      ),
    },
  ];
}
