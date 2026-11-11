import type { components } from "@repo/api-sdk";
import { TASK_CONFIRMED_LABEL, TASK_STATUS_LABELS } from "./task-card";
import {
  dayDelta,
  formatDueLabel,
  formatMinutesRounded,
  formatRelativeDayTime,
  formatTimeOfDay,
  parseInstant,
  parseInstantOrBareLocalNoon,
} from "@repo/formatting";

export type Activity = components["schemas"]["ActivityDto"];
export type ActivityTask = components["schemas"]["ActivityTaskDto"];
export type ActivityPoll = components["schemas"]["ActivityPollDto"];
export type ActivityEvent = components["schemas"]["ActivityEventDto"];
export type ActivityHours = components["schemas"]["ActivityHoursEntryDto"];
export type ActivityFile = components["schemas"]["ActivityFileDto"];
export type ActivityLink = components["schemas"]["ActivityLinkDto"];
export type ActivitySection = Activity["unavailable"][number];

/** The filter chips: everything, or one kind of thing. */
export const ACTIVITY_FILTERS = [
  { value: "all", label: "All" },
  { value: "task", label: "Tasks" },
  { value: "poll", label: "Polls" },
  { value: "event", label: "Events" },
  { value: "hours", label: "Hours" },
  { value: "file", label: "Files" },
  { value: "link", label: "Links" },
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

/**
 * The kind of thing a row is, drawn as the row's leading glyph so a member
 * tells a task from a poll at a glance (#4173, the way Teams' Activity marks
 * each row). `confirm` is a task waiting on the member's confirm, apart from
 * their own tasks; an event row draws its date instead of a glyph.
 */
export type ActivityGlyph =
  | "task"
  | "confirm"
  | "hours"
  | "poll"
  | "event"
  | "document"
  | "backwork"
  | "link";

/**
 * An event row's date, for a calendar-style block beside the row (#4173):
 * `weekday` "THU", `day` "12", `month` "NOV", and `detail`, the row's detail
 * without the day, since the block says it.
 */
export interface ActivityDateBlock {
  weekday: string;
  day: string;
  month: string;
  detail: string;
}

interface RowBase {
  /** Unique on the page: the same task can sit under two groups. */
  key: string;
  title: string;
  detail: string;
  /**
   * `warning` is an ask (`Vote`, `Confirm`, `Approve`, `Check in`): what the
   * member has to do, which a client may draw as an action rather than a
   * status (`activityBadgeIsAsk`).
   */
  badge: { label: string; variant: ActivityBadgeVariant } | null;
  glyph: ActivityGlyph;
  /** Set on an event row only. */
  dateBlock: ActivityDateBlock | null;
}

/** Whether a row's badge asks the member to act, rather than naming a state. */
export function activityBadgeIsAsk(row: Pick<ActivityRow, "badge">): boolean {
  return row.badge?.variant === "warning";
}

/** One row of the page: what it shows, and the record it opens. */
export type ActivityRow = RowBase &
  (
    | { kind: "task"; task: ActivityTask }
    | { kind: "poll"; poll: ActivityPoll }
    | { kind: "event"; event: ActivityEvent }
    | { kind: "hours"; entry: ActivityHours }
    | { kind: "file"; file: ActivityFile }
    | { kind: "link"; link: ActivityLink }
  );

/**
 * A run of rows inside a group, under its own small heading: "Now" and
 * "Later" under Needs you, one per kind under Made by you (#4173). A group
 * with one part draws it with no heading.
 */
export interface ActivityPart {
  id: string;
  /** `null` when the part is the whole group, so the group label says it. */
  label: string | null;
  rows: ActivityRow[];
  /**
   * How many rows to draw before a "Show all" (`null`: all of them). Lifted
   * under a chip, where the member asked for that kind.
   */
  limit: number | null;
}

export interface ActivityGroup {
  id: "needs-you" | "coming-up" | "links" | "made-by-you";
  label: string;
  /** Said in place of the rows when the group has none. */
  empty: string;
  /** Every row of the group, in order: the parts' rows end to end. */
  rows: ActivityRow[];
  /** The rows split for drawing. Empty parts are left out. */
  parts: ActivityPart[];
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
  links: "links",
};

function channelLabel(
  row: Pick<ActivityPoll, "channel_type" | "channel_name">,
): string {
  // A direct message's channel name is server-generated (`dm-<id>-<id>`).
  if (row.channel_type === "DM") return "Direct message";
  if (row.channel_type === "GROUP_DM") return "Group message";
  return `#${row.channel_name}`;
}

/**
 * What kind of sign-up a link is, from the hosts Activity gathers
 * (`activity_action_links`, `spec/behavior/activity.md` § Links). A host the
 * list later widens to falls back to the host itself, never a wrong name.
 */
export function activityLinkKind(
  link: Pick<ActivityLink, "host" | "url">,
): string {
  const host = link.host;
  if (host === "forms.gle") return "Google Form";
  if (host === "docs.google.com") {
    let path = "";
    try {
      path = new URL(link.url).pathname;
    } catch {
      return host;
    }
    // A Workspace account's links carry `/a/<domain>` first.
    const rest = path.replace(/^\/a\/[^/]+/, "");
    if (rest.startsWith("/forms/")) return "Google Form";
    if (rest.startsWith("/spreadsheets/")) return "Google Sheet";
    if (rest.startsWith("/document/")) return "Google Doc";
    return host;
  }
  if (
    host === "forms.office.com" ||
    host === "forms.microsoft.com" ||
    host === "forms.cloud.microsoft"
  ) {
    return "Microsoft Form";
  }
  if (host === "typeform.com" || host.endsWith(".typeform.com")) {
    return "Typeform";
  }
  if (host === "signupgenius.com" || host.endsWith(".signupgenius.com")) {
    return "SignUpGenius";
  }
  if (host === "calendly.com" || host.endsWith(".calendly.com")) {
    return "Calendly";
  }
  return host;
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
    glyph: "poll",
    dateBlock: null,
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
    glyph: role === "confirm" ? "confirm" : "task",
    dateBlock: null,
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
    glyph: "hours",
    dateBlock: null,
  };
}

function dateBlock(event: ActivityEvent): ActivityDateBlock | null {
  const at = parseInstant(event.start_time);
  if (!at) return null;
  return {
    weekday: at
      .toLocaleDateString(undefined, { weekday: "short" })
      .toUpperCase(),
    day: String(at.getDate()),
    month: at.toLocaleDateString(undefined, { month: "short" }).toUpperCase(),
    detail: [formatTimeOfDay(event.start_time), event.location]
      .filter(Boolean)
      .join(" · "),
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
    glyph: "event",
    dateBlock: dateBlock(event),
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
    glyph: file.source === "document" ? "document" : "backwork",
    dateBlock: null,
  };
}

function linkRow(link: ActivityLink): ActivityRow {
  return {
    kind: "link",
    key: `link:${link.id}`,
    link,
    title: activityLinkKind(link),
    detail: [
      link.posted_by_name || null,
      channelLabel(link),
      formatRelativeDayTime(link.posted_at),
    ]
      .filter(Boolean)
      .join(" · "),
    badge: null,
    glyph: "link",
    dateBlock: null,
  };
}

/** How many rows a part of Needs you draws before "Show all". */
export const ACTIVITY_NEEDS_YOU_LIMIT = 5;
/** How many of each kind Made by you draws before "Show all". */
export const ACTIVITY_MADE_BY_YOU_LIMIT = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a "Needs you" row is for now rather than later (#4173): an event
 * the member can check in to, anything waiting on their confirm or approval,
 * a task overdue or due today or tomorrow, and a poll closing within a day.
 * A poll with no closing time, and a task due later, is later.
 */
export function activityRowIsNow(row: ActivityRow, now: Date): boolean {
  switch (row.kind) {
    case "event":
    case "hours":
      return true;
    case "task": {
      if (row.glyph === "confirm" || row.task.status === "OVERDUE") {
        return true;
      }
      const due = parseInstantOrBareLocalNoon(row.task.due_date);
      return due === null || dayDelta(now, due) <= 1;
    }
    case "poll": {
      const closes = row.poll.closes_at
        ? parseInstant(row.poll.closes_at)
        : null;
      return closes !== null && closes.getTime() - now.getTime() <= DAY_MS;
    }
    default:
      return false;
  }
}

function part(
  id: string,
  label: string | null,
  rows: ActivityRow[],
  limit: number | null,
): ActivityPart[] {
  return rows.length === 0 ? [] : [{ id, label, rows, limit }];
}

/**
 * The page's four groups, in the order it draws them, already narrowed to
 * one kind when a chip is set.
 *
 * "Needs you" leads with what is most pressing: an event the member can check
 * in to right now, then tasks, confirmations, approvals and polls, each in the
 * order the read serves it. It splits into Now and Later
 * (`activityRowIsNow`). An event that needs a check-in is listed under
 * "Needs you" and not again under "Coming up". "Made by you" draws one part
 * per kind, a few rows each, so one busy kind doesn't bury the others.
 */
export function activityGroups(
  activity: Activity,
  filter: ActivityFilter,
  now: Date = new Date(),
): ActivityGroup[] {
  const down = new Set(activity.unavailable);
  const filtered = filter !== "all";
  const keep = (rows: ActivityRow[]) =>
    filtered ? rows.filter((row) => row.kind === filter) : rows;
  const downFor = (sections: ActivitySection[], kinds: ActivityKind[]) =>
    sections.filter(
      (section, index) =>
        down.has(section) && (!filtered || filter === kinds[index]),
    );
  // Under a chip the member asked for that kind, so nothing is held back.
  const cap = (limit: number) => (filtered ? null : limit);

  const checkInNow = activity.coming_up.filter(
    (event) => event.check_in_open && !event.checked_in,
  );
  const later = activity.coming_up.filter(
    (event) => !(event.check_in_open && !event.checked_in),
  );

  const needs = keep([
    ...checkInNow.map((event) => eventRow(event, "needs")),
    ...activity.needs_you.tasks.map((task) => taskRow(task, "needs", "mine")),
    ...activity.needs_you.task_confirmations.map((task) =>
      taskRow(task, "needs-confirm", "confirm"),
    ),
    ...activity.needs_you.hours_approvals.map(hoursRow),
    ...activity.needs_you.polls.map((poll) => pollRow(poll, "needs")),
  ]);
  const needsNow = needs.filter((row) => activityRowIsNow(row, now));
  const needsLater = needs.filter((row) => !activityRowIsNow(row, now));

  const coming = keep(later.map((event) => eventRow(event, "coming")));
  const links = keep(activity.links.map(linkRow));

  const madePolls = keep(
    activity.made_by_you.polls.map((poll) => pollRow(poll, "made")),
  );
  const madeEvents = keep(
    activity.made_by_you.events.map((event) => eventRow(event, "made")),
  );
  const madeTasks = keep(
    activity.made_by_you.tasks.map((task) => taskRow(task, "made", "assigned")),
  );
  const madeFiles = keep(activity.made_by_you.files.map(fileRow));

  return [
    {
      id: "needs-you",
      label: "Needs you",
      empty: "Nothing is waiting on you.",
      rows: [...needsNow, ...needsLater],
      // One part draws with no heading: "Now" over every row says nothing.
      parts:
        needsNow.length > 0 && needsLater.length > 0
          ? [
              ...part("now", "Now", needsNow, cap(ACTIVITY_NEEDS_YOU_LIMIT)),
              ...part(
                "later",
                "Later",
                needsLater,
                cap(ACTIVITY_NEEDS_YOU_LIMIT),
              ),
            ]
          : part(
              "all",
              null,
              [...needsNow, ...needsLater],
              cap(ACTIVITY_NEEDS_YOU_LIMIT),
            ),
      unavailable: downFor(
        ["tasks", "hours_approvals", "polls", "coming_up"],
        ["task", "hours", "poll", "event"],
      ),
    },
    {
      id: "coming-up",
      label: "Coming up",
      empty: "No events in the next two weeks.",
      rows: coming,
      parts: part("all", null, coming, null),
      unavailable: downFor(["coming_up"], ["event"]),
    },
    {
      // Their own group, not "Needs you": a link may or may not be for this
      // member, and Frapp can't see one filled in (spec § Links).
      id: "links",
      label: "Links",
      empty:
        "Sign-up forms, sheets and booking links posted in your channels show up here.",
      rows: links,
      parts: part("all", null, links, null),
      unavailable: downFor(["links"], ["link"]),
    },
    {
      id: "made-by-you",
      label: "Made by you",
      empty:
        "Polls you post, events you make, tasks you assign and files you upload show up here.",
      rows: [...madePolls, ...madeEvents, ...madeTasks, ...madeFiles],
      parts: [
        ...part(
          "polls",
          "Polls you posted",
          madePolls,
          cap(ACTIVITY_MADE_BY_YOU_LIMIT),
        ),
        ...part(
          "events",
          "Events you made",
          madeEvents,
          cap(ACTIVITY_MADE_BY_YOU_LIMIT),
        ),
        ...part(
          "tasks",
          "Tasks you assigned",
          madeTasks,
          cap(ACTIVITY_MADE_BY_YOU_LIMIT),
        ),
        ...part(
          "files",
          "Files you uploaded",
          madeFiles,
          cap(ACTIVITY_MADE_BY_YOU_LIMIT),
        ),
      ],
      unavailable: downFor(
        ["polls", "made_events", "tasks", "files"],
        ["poll", "event", "task", "file"],
      ),
    },
  ];
}

/** One count tile at the top of the page (#4173). */
export interface ActivityTile {
  id: "check-in" | "tasks" | "confirm" | "approve" | "polls";
  label: string;
  count: number;
  /** The chip a tap on the tile sets. */
  filter: ActivityKind;
}

export interface ActivitySummary {
  /** Everything waiting on the member, counted before the list cap. */
  needsYou: number;
  tiles: ActivityTile[];
  /** The soonest event still ahead, for "Next up". */
  nextEvent: ActivityEvent | null;
}

/**
 * The top of the page: how much is waiting, a tile per kind of ask, and the
 * next event (#4173; Apple Reminders' count tiles, Linear's inbox zero).
 *
 * The confirm and approve tiles show only to a member who can confirm tasks
 * or approve hours, since nobody else is ever asked to; a module the chapter
 * has off shows no tile. The check-in tile shows only while an event is open
 * for check-in, since it is rare and time-bound.
 */
export function activitySummary(
  activity: Activity,
  options: {
    canConfirmTasks: boolean;
    canApproveHours: boolean;
    /** The chapter's module switch; omit while it is unknown to show all. */
    isModuleEnabled?: (module: string) => boolean;
  },
  now: Date = new Date(),
): ActivitySummary {
  const on = (module: string) => options.isModuleEnabled?.(module) ?? true;
  const checkIn = activity.coming_up.filter(
    (event) => event.check_in_open && !event.checked_in,
  ).length;
  const tiles: ActivityTile[] = [];
  if (checkIn > 0) {
    tiles.push({
      id: "check-in",
      label: "Check in now",
      count: checkIn,
      filter: "event",
    });
  }
  if (on("tasks")) {
    tiles.push({
      id: "tasks",
      label: "Your tasks",
      count: activity.needs_you.tasks.length,
      filter: "task",
    });
    if (options.canConfirmTasks) {
      tiles.push({
        id: "confirm",
        label: "To confirm",
        count: activity.needs_you.task_confirmations.length,
        filter: "task",
      });
    }
  }
  if (on("hours") && options.canApproveHours) {
    tiles.push({
      id: "approve",
      label: "Hours to approve",
      count: activity.needs_you.hours_approvals.length,
      filter: "hours",
    });
  }
  if (on("polls")) {
    tiles.push({
      id: "polls",
      label: "Polls to vote on",
      count: activity.needs_you.polls.length,
      filter: "poll",
    });
  }
  const nextEvent =
    activity.coming_up.find((event) => {
      const start = parseInstant(event.start_time);
      return start !== null && start.getTime() > now.getTime();
    }) ?? null;
  return { needsYou: activity.needs_you_count, tiles, nextEvent };
}

/** "8 things need you", "1 thing needs you". */
export function activityNeedsYouHeadline(count: number): string {
  return count === 1 ? "1 thing needs you" : `${count} things need you`;
}
