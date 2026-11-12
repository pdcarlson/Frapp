import type { components } from "@repo/api-sdk";
import type { NavGlyphName } from "@repo/theme/nav-glyphs";
import { TASK_CONFIRMED_LABEL, TASK_STATUS_LABELS } from "./task-card";
import {
  dayDelta,
  formatDueLabel,
  formatMinutesRounded,
  formatRelativeDayTime,
  parseInstant,
  parseInstantOrBareLocalNoon,
} from "@repo/formatting";

export type Activity = components["schemas"]["ActivityDto"];
export type ActivityTask = components["schemas"]["ActivityTaskDto"];
export type ActivityPoll = components["schemas"]["ActivityPollDto"];
export type ActivityEvent = components["schemas"]["ActivityEventDto"];
export type ActivityHours = components["schemas"]["ActivityHoursEntryDto"];
export type ActivityLink = components["schemas"]["ActivityLinkDto"];
export type ActivitySection = Activity["unavailable"][number];
/** What `POST /v1/activity/reads` names: an item's kind and id. */
export type ActivityItemRef = components["schemas"]["ActivityItemRefDto"];

/**
 * The filter chips: everything, only what is waiting on the member (the
 * Needs you group, #4402), or one kind of thing.
 */
export const ACTIVITY_FILTERS = [
  { value: "all", label: "All" },
  { value: "waiting", label: "Needs you" },
  { value: "task", label: "Tasks" },
  { value: "poll", label: "Polls" },
  { value: "event", label: "Events" },
  { value: "hours", label: "Hours" },
  { value: "link", label: "Links" },
] as const;
export type ActivityKind = Exclude<
  (typeof ACTIVITY_FILTERS)[number]["value"],
  "all" | "waiting"
>;
/**
 * A chip's value, or `confirm`: what the To confirm tile narrows to (the
 * tasks waiting on the member's confirm), which has no chip of its own
 * since the Tasks chip already covers it (#4173).
 */
export type ActivityFilter = "all" | "waiting" | ActivityKind | "confirm";

/** The chapter module each kind belongs to; Links and Needs you belong to none. */
const FILTER_MODULE: Partial<Record<ActivityFilter, string>> = {
  task: "tasks",
  confirm: "tasks",
  poll: "polls",
  event: "events",
  hours: "hours",
};

/**
 * Whether a filter can show anything in this chapter: not a kind whose
 * module the chapter has off (#4402). A client leaves that chip out, as the
 * summary leaves out its tile, and opens on All rather than on a stored
 * chip for it. With the module switch unknown, everything is available.
 */
export function activityFilterAvailable(
  filter: ActivityFilter,
  isModuleEnabled?: (module: string) => boolean,
): boolean {
  const module = FILTER_MODULE[filter];
  return !module || (isModuleEnabled?.(module) ?? true);
}

/**
 * The chip a member last picked, as stored on their device (#4402), or
 * `null` for anything that isn't one. The To confirm tile's narrowing is a
 * moment's shortcut and isn't remembered.
 */
export function parseActivityFilter(raw: unknown): ActivityFilter | null {
  return ACTIVITY_FILTERS.some((option) => option.value === raw)
    ? (raw as ActivityFilter)
    : null;
}

/** How many rows each list of the read carries at most (`activity.md`). */
const ACTIVITY_LIST_LIMIT = 25;

/** Whether the member can check in to an event right now and hasn't. */
function activityEventNeedsCheckIn(
  event: Pick<ActivityEvent, "check_in_open" | "checked_in">,
): boolean {
  return event.check_in_open && !event.checked_in;
}

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
  "task" | "confirm" | "hours" | "poll" | "event" | "link";

/**
 * The shared nav glyph each kind draws (`@repo/theme/nav-glyphs`), so a row
 * draws the same shape as the place its record lives (`iconography.md` §6.2):
 * a task the Tasks glyph, hours the Service glyph. One map for web and the
 * phone, so the two can't name different shapes for one kind.
 */
export const ACTIVITY_GLYPH_NAV: Record<ActivityGlyph, NavGlyphName> = {
  task: "tasks",
  confirm: "confirm",
  hours: "service",
  poll: "polls",
  event: "events",
  link: "link",
};

/**
 * An event row's date, for a calendar-style block beside the row (#4173):
 * `month` "NOV" over `day` "12", as a calendar draws it. It is drawn beside
 * the row's detail, never instead of it: the detail keeps "Tomorrow · 7:00
 * PM", which says the day in words (and to a screen reader, since the block
 * is decoration) and gives the year outside the current one.
 */
export interface ActivityDateBlock {
  month: string;
  day: string;
}

interface RowBase {
  /** Unique on the page: the same task can sit under two groups. */
  key: string;
  title: string;
  /**
   * The row's second line, whole, as a screen reader says it. When `soon` is
   * set, it ends with that phrase (`activityDetailParts`).
   */
  detail: string;
  /**
   * "closes in 2 hours", "Due in 40 minutes": the closing time or due time
   * of something that runs out within a day, said relatively, which a client
   * draws in the warning tone (#4402, item 4). It is always `detail`'s last
   * segment. `null` when nothing on the row is closing soon.
   */
  soon: string | null;
  /**
   * Who the row is from or about, as a `users.id`, for the face that leads
   * it (#4402, item 4): the poster of a poll or link, whoever assigned a task
   * to the member, the member whose completion or hours wait on them. `null`
   * when there is no one else to show (an event, a task the member set
   * themselves, Made by you), and the row leads with its glyph. A client that
   * can't resolve the id on the roster (they have left) draws the glyph too.
   */
  faceId: string | null;
  /**
   * `warning` is an ask (`Vote`, `Confirm`, `Approve`, `Check in`): what the
   * member has to do, which a client may draw as an action rather than a
   * status (`activityBadgeIsAsk`).
   */
  badge: { label: string; variant: ActivityBadgeVariant } | null;
  glyph: ActivityGlyph;
  /** Set on an event row only. */
  dateBlock: ActivityDateBlock | null;
  /**
   * Whether the member hasn't opened it from Activity since it started
   * waiting on them (`spec/behavior/activity.md` § Unread): the row draws a
   * dot. Never on a Made by you row.
   */
  unread: boolean;
  /** The item `POST /v1/activity/reads` records when the row is opened. */
  readRef: ActivityItemRef;
}

/** Whether a row's badge asks the member to act, rather than naming a state. */
export function activityBadgeIsAsk(row: Pick<ActivityRow, "badge">): boolean {
  return row.badge?.variant === "warning";
}

/**
 * What a row's ask does on the row itself (#4402): the asks that are one
 * press with nothing to choose. `Vote` is not one, since a poll asks which
 * option, so it opens the record as before. Neither is `Check in` yet: an
 * event can require the member's location (`check_in_zone`), which the read
 * doesn't say and the web can't supply, so a one-press check-in would fail
 * there (#4427). The client acts through the same route and hook its panel
 * uses.
 */
export type ActivityRowAction = "confirm" | "approve";

export function activityRowAction(row: ActivityRow): ActivityRowAction | null {
  if (!activityBadgeIsAsk(row)) return null;
  if (row.kind === "task" && row.glyph === "confirm") return "confirm";
  if (row.kind === "hours") return "approve";
  return null;
}

/** One row of the page: what it shows, and the record it opens. */
export type ActivityRow = RowBase &
  (
    | { kind: "task"; task: ActivityTask }
    | { kind: "poll"; poll: ActivityPoll }
    | { kind: "event"; event: ActivityEvent }
    | { kind: "hours"; entry: ActivityHours }
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
  /**
   * Rows kept off the group behind one control, which a client draws closed
   * under the group: the member's closed polls, newest closed first, under
   * Made by you (#4258). `null` when there are none. Not in `rows`, and not
   * counted in the group's count.
   */
  archive: ActivityPart | null;
}

/** A name for a section the read could not load, for "Couldn't load …". */
export const ACTIVITY_SECTION_NAMES: Record<ActivitySection, string> = {
  tasks: "tasks",
  hours_approvals: "hours waiting for approval",
  polls: "polls",
  coming_up: "events",
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

/**
 * Whether a poll is still open at `now`: not closed when the read was taken,
 * and its closing time not passed since. The read's `is_closed` is true as of
 * the read, so a poll whose time runs out while the page is open is closed
 * here without a re-read (#4258).
 */
export function activityPollIsOpen(
  poll: Pick<ActivityPoll, "is_closed" | "closes_at">,
  now: Date,
): boolean {
  if (poll.is_closed) return false;
  const closes = poll.closes_at ? parseInstant(poll.closes_at) : null;
  return closes === null || closes.getTime() > now.getTime();
}

/**
 * When a closed poll stopped taking votes, for ordering the archive newest
 * first: closed by hand, or its closing time; its posting as a last resort.
 */
function pollClosedAt(poll: ActivityPoll): number {
  const at = parseInstant(poll.closed_at ?? poll.closes_at ?? poll.created_at);
  return at ? at.getTime() : 0;
}

function pollRow(poll: ActivityPoll, group: string, now: Date): ActivityRow {
  const closed = !activityPollIsOpen(poll, now);
  const left = closed ? null : timeLeftWithinDay(poll.closes_at, now);
  const soon = left ? `closes in ${left}` : null;
  const closes = poll.closes_at
    ? formatRelativeDayTime(poll.closes_at, now)
    : null;
  return {
    kind: "poll",
    key: `${group}:poll:${poll.message_id}`,
    poll,
    title: poll.question,
    detail: [
      channelLabel(poll),
      closed
        ? null
        : (soon ?? (closes ? `closes ${closes}` : "no closing time")),
    ]
      .filter(Boolean)
      .join(" · "),
    soon,
    faceId: group === "made" ? null : poll.sender_id,
    badge: closed
      ? { label: "Closed", variant: "outline" }
      : poll.has_voted
        ? { label: "Voted", variant: "success" }
        : { label: "Vote", variant: "warning" },
    glyph: "poll",
    dateBlock: null,
    unread: group !== "made" && poll.unread,
    readRef: { kind: "poll", item_id: poll.message_id },
  };
}

function taskRow(
  task: ActivityTask,
  group: string,
  role: "mine" | "confirm" | "assigned",
  now: Date,
): ActivityRow {
  // A finished task has no countdown: "Overdue by 2 days" under a task that is
  // done would be wrong.
  const finished = task.stored_status === "COMPLETED";
  const left = finished ? null : timeLeftWithinDay(task.due_at, now);
  const soon = left ? `Due in ${left}` : null;
  const due = finished
    ? null
    : (soon ?? formatDueLabel(task.due_at ?? task.due_date, now));
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
    soon,
    faceId:
      role === "confirm"
        ? task.assignee_id
        : role === "mine" && task.created_by !== task.assignee_id
          ? task.created_by
          : null,
    badge,
    glyph: role === "confirm" ? "confirm" : "task",
    dateBlock: null,
    unread: role !== "assigned" && task.unread,
    readRef: { kind: "task", item_id: task.id },
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
    soon: null,
    faceId: entry.user_id,
    badge: { label: "Approve", variant: "warning" },
    glyph: "hours",
    dateBlock: null,
    unread: entry.unread,
    readRef: { kind: "hours_entry", item_id: entry.id },
  };
}

function dateBlock(event: ActivityEvent): ActivityDateBlock | null {
  const at = parseInstant(event.start_time);
  if (!at) return null;
  return {
    month: at.toLocaleDateString(undefined, { month: "short" }).toUpperCase(),
    day: String(at.getDate()),
  };
}

function eventRow(event: ActivityEvent, group: string, now: Date): ActivityRow {
  const needsCheckIn = activityEventNeedsCheckIn(event);
  return {
    kind: "event",
    key: `${group}:event:${event.id}`,
    event,
    title: event.name,
    detail: [formatRelativeDayTime(event.start_time, now), event.location]
      .filter(Boolean)
      .join(" · "),
    soon: null,
    faceId: null,
    badge: needsCheckIn
      ? { label: "Check in", variant: "warning" }
      : event.checked_in
        ? { label: "Checked in", variant: "success" }
        : event.attendance === "required"
          ? { label: "Required", variant: "outline" }
          : null,
    glyph: "event",
    dateBlock: dateBlock(event),
    unread: group !== "made" && event.unread,
    readRef: { kind: "event", item_id: event.id },
  };
}

/**
 * A link row is titled by the page's own name when the API read one (#4187),
 * with its kind leading the detail ("Google Form · Olive · #rush · Tue 3:00
 * PM"); with no name it is titled by its kind, as before.
 */
function linkRow(link: ActivityLink, now: Date): ActivityRow {
  const kind = activityLinkKind(link);
  const name = link.title?.trim() || null;
  return {
    kind: "link",
    key: `link:${link.id}`,
    link,
    title: name ?? kind,
    detail: [
      name ? kind : null,
      link.posted_by_name || null,
      channelLabel(link),
      formatRelativeDayTime(link.posted_at, now),
    ]
      .filter(Boolean)
      .join(" · "),
    soon: null,
    faceId: link.posted_by,
    badge: null,
    glyph: "link",
    dateBlock: null,
    unread: link.unread,
    readRef: { kind: "link", item_id: link.id },
  };
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * "40 minutes", "2 hours": how long is left until `at`, when it is in the
 * future and less than a day away; `null` otherwise, and for a bare date,
 * which has no time to count down to. Rounded down, so "1 hour" is never
 * said with 59 minutes left; under a minute says "1 minute".
 */
function timeLeftWithinDay(at: string | null, now: Date): string | null {
  if (!at) return null;
  const instant = parseInstant(at);
  if (!instant) return null;
  const left = instant.getTime() - now.getTime();
  if (left <= 0 || left >= 24 * HOUR_MS) return null;
  if (left < HOUR_MS) {
    const minutes = Math.max(1, Math.floor(left / 60_000));
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  const hours = Math.floor(left / HOUR_MS);
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/**
 * A row's second line split for drawing (#4402, item 4): `lead` is the
 * detail before the closing-soon phrase, without its " · ", and `soon` that
 * phrase, which a client draws in the warning tone. With no phrase, `lead`
 * is the whole detail.
 */
export function activityDetailParts(
  row: Pick<ActivityRow, "detail" | "soon">,
): { lead: string; soon: string | null } {
  if (!row.soon || !row.detail.endsWith(row.soon)) {
    return { lead: row.detail, soon: null };
  }
  const lead = row.detail.slice(0, row.detail.length - row.soon.length);
  return {
    lead: lead.endsWith(" · ") ? lead.slice(0, -3) : lead,
    soon: row.soon,
  };
}

/** How many rows a part of Needs you draws before "Show all". */
const ACTIVITY_NEEDS_YOU_LIMIT = 5;
/** How many of each kind Made by you draws before "Show all". */
const ACTIVITY_MADE_BY_YOU_LIMIT = 3;

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
      const due = parseInstantOrBareLocalNoon(
        row.task.due_at ?? row.task.due_date,
      );
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
 * "Needs you" lists an event the member can check in to right now, then
 * tasks, confirmations, approvals and polls, each in the order the read
 * serves it; its parts split that into Now and Later (`activityRowIsNow`),
 * so a client that draws the parts leads with what is pressing, and one that
 * draws `rows` keeps the read's order. An event that needs a check-in is listed under
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
  // Needs you narrows by group, not kind: its rows are all kept, and every
  // other group is emptied below.
  const waiting = filter === "waiting";
  const keep = (rows: ActivityRow[]) =>
    !filtered || waiting
      ? rows
      : filter === "confirm"
        ? rows.filter((row) => row.glyph === "confirm")
        : rows.filter((row) => row.kind === filter);
  // The confirmations come from the tasks read.
  const kindFilter = filter === "confirm" ? "task" : filter;
  const downFor = (sections: ActivitySection[], kinds: ActivityKind[]) =>
    sections.filter(
      (section, index) =>
        down.has(section) &&
        (!filtered || waiting || kindFilter === kinds[index]),
    );
  // Under a chip the member asked for that kind, so nothing is held back.
  const cap = (limit: number) => (filtered ? null : limit);

  const checkInNow = activity.coming_up.filter(activityEventNeedsCheckIn);
  const later = activity.coming_up.filter(
    (event) => !activityEventNeedsCheckIn(event),
  );

  const needs = keep([
    ...checkInNow.map((event) => eventRow(event, "needs", now)),
    ...activity.needs_you.tasks.map((task) =>
      taskRow(task, "needs", "mine", now),
    ),
    ...activity.needs_you.task_confirmations.map((task) =>
      taskRow(task, "needs-confirm", "confirm", now),
    ),
    ...activity.needs_you.hours_approvals.map(hoursRow),
    // Open only: a poll whose time ran out since the read leaves at once.
    ...activity.needs_you.polls
      .filter((poll) => activityPollIsOpen(poll, now))
      .map((poll) => pollRow(poll, "needs", now)),
  ]);
  const needsNow = needs.filter((row) => activityRowIsNow(row, now));
  const needsLater = needs.filter((row) => !activityRowIsNow(row, now));

  const coming = keep(later.map((event) => eventRow(event, "coming", now)));
  const links = keep(activity.links.map((link) => linkRow(link, now)));

  // A closed poll, by time or by hand, leaves the list for the archive.
  const madePolls = keep(
    activity.made_by_you.polls
      .filter((poll) => activityPollIsOpen(poll, now))
      .map((poll) => pollRow(poll, "made", now)),
  );
  const archivedPolls = keep(
    activity.made_by_you.polls
      .filter((poll) => !activityPollIsOpen(poll, now))
      .sort((a, b) => pollClosedAt(b) - pollClosedAt(a))
      .map((poll) =>
        // The same key as when it was listed, so a panel open on the
        // poll keeps finding it after it closes.
        pollRow(poll, "made", now),
      ),
  );
  const madeEvents = keep(
    activity.made_by_you.events.map((event) => eventRow(event, "made", now)),
  );
  const madeTasks = keep(
    activity.made_by_you.tasks.map((task) =>
      taskRow(task, "made", "assigned", now),
    ),
  );

  const groups: ActivityGroup[] = [
    {
      id: "needs-you",
      label: "Needs you",
      empty: "Nothing is waiting on you.",
      rows: needs,
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
          : // The lone part keeps the id of the side it holds, so a client
            // that keys its Show all state by part id keeps it open when
            // the other side empties (the last Now row acted on) or fills.
            part(
              needsNow.length > 0 ? "now" : "later",
              null,
              [...needsNow, ...needsLater],
              cap(ACTIVITY_NEEDS_YOU_LIMIT),
            ),
      unavailable: downFor(
        ["tasks", "hours_approvals", "polls", "coming_up"],
        ["task", "hours", "poll", "event"],
      ),
      archive: null,
    },
    {
      id: "coming-up",
      label: "Coming up",
      empty: "No events in the next two weeks.",
      rows: coming,
      parts: part("all", null, coming, null),
      unavailable: downFor(["coming_up"], ["event"]),
      archive: null,
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
      archive: null,
    },
    {
      id: "made-by-you",
      label: "Made by you",
      empty:
        "Open polls you post, events you make and tasks you assign show up here.",
      rows: [...madePolls, ...madeEvents, ...madeTasks],
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
      ],
      // To confirm narrows to Needs you's confirmations: nothing here is one.
      unavailable:
        filter === "confirm"
          ? []
          : downFor(
              ["polls", "made_events", "tasks"],
              ["poll", "event", "task"],
            ),
      archive:
        archivedPolls.length === 0
          ? null
          : {
              id: "archived-polls",
              label: "Archived polls",
              rows: archivedPolls,
              limit: null,
            },
    },
  ];
  // Under Needs you only that group stays; the page leaves out the rest.
  return waiting
    ? groups.map((group) =>
        group.id === "needs-you"
          ? group
          : { ...group, rows: [], parts: [], unavailable: [], archive: null },
      )
    : groups;
}

/** One count tile at the top of the page (#4173). */
export interface ActivityTile {
  id: "check-in" | "tasks" | "confirm" | "approve" | "polls";
  label: string;
  /**
   * What the tile draws: the count, `25+` when its list reached the read's
   * cap (the read cuts each list at 25, so more may be waiting), or `null`
   * when its section could not be read, which a client draws as unknown,
   * never as 0.
   */
  count: string | null;
  /** Whether nothing of this kind is waiting, so the tile can dim. */
  zero: boolean;
  /** The filter a tap on the tile sets. Each tile's is its own. */
  filter: ActivityFilter;
}

export interface ActivitySummary {
  /** Everything waiting on the member, counted before the list cap. */
  needsYou: number;
  /**
   * A section behind Needs you could not be read, so `needsYou` may
   * undercount: the page must not say the member is caught up.
   */
  incomplete: boolean;
  tiles: ActivityTile[];
  /** The soonest event still ahead, for "Next up". */
  nextEvent: ActivityEvent | null;
}

function tileCount(
  rows: readonly unknown[],
  down: boolean,
): Pick<ActivityTile, "count" | "zero"> {
  if (down) return { count: null, zero: false };
  return {
    count:
      rows.length >= ACTIVITY_LIST_LIMIT
        ? `${ACTIVITY_LIST_LIMIT}+`
        : String(rows.length),
    zero: rows.length === 0,
  };
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
  const down = new Set(activity.unavailable);
  // Open only, as the list draws them: a poll whose time ran out since the
  // read no longer waits on the member (#4258).
  const openPolls = activity.needs_you.polls.filter((poll) =>
    activityPollIsOpen(poll, now),
  );
  const checkIn = activity.coming_up.filter(activityEventNeedsCheckIn);
  const tiles: ActivityTile[] = [];
  if (checkIn.length > 0) {
    tiles.push({
      id: "check-in",
      label: "Check in now",
      ...tileCount(checkIn, false),
      filter: "event",
    });
  }
  if (on("tasks")) {
    tiles.push({
      id: "tasks",
      label: "Your tasks",
      ...tileCount(activity.needs_you.tasks, down.has("tasks")),
      filter: "task",
    });
    if (options.canConfirmTasks) {
      tiles.push({
        id: "confirm",
        label: "To confirm",
        ...tileCount(activity.needs_you.task_confirmations, down.has("tasks")),
        filter: "confirm",
      });
    }
  }
  if (on("hours") && options.canApproveHours) {
    tiles.push({
      id: "approve",
      label: "Hours to approve",
      ...tileCount(
        activity.needs_you.hours_approvals,
        down.has("hours_approvals"),
      ),
      filter: "hours",
    });
  }
  if (on("polls")) {
    tiles.push({
      id: "polls",
      label: "Polls to vote on",
      ...tileCount(openPolls, down.has("polls")),
      filter: "poll",
    });
  }
  const nextEvent =
    activity.coming_up.find((event) => {
      const start = parseInstant(event.start_time);
      return start !== null && start.getTime() > now.getTime();
    }) ?? null;
  const incomplete = (
    ["tasks", "hours_approvals", "polls", "coming_up"] as const
  ).some((section) => down.has(section));
  return {
    // The read's count, less the polls that closed since it was taken.
    needsYou: Math.max(
      0,
      activity.needs_you_count -
        (activity.needs_you.polls.length - openPolls.length),
    ),
    incomplete,
    tiles,
    nextEvent,
  };
}

/**
 * The line under the headline: "Next up: Exec Board Sync · Tomorrow · 5:00
 * PM", or `null` when nothing is ahead.
 */
export function activityNextUpLine(
  summary: Pick<ActivitySummary, "nextEvent">,
  now: Date = new Date(),
): string | null {
  const next = summary.nextEvent;
  if (!next) return null;
  const when = formatRelativeDayTime(next.start_time, now);
  return ["Next up:", next.name, when ? `· ${when}` : null]
    .filter(Boolean)
    .join(" ");
}

/**
 * The page's headline: "8 things need you", "1 thing needs you", "You're
 * all caught up" at zero, and never that while part of Needs you could not
 * be read, since a failed read must not look like an empty one.
 */
export function activityNeedsYouHeadline(
  summary: Pick<ActivitySummary, "needsYou" | "incomplete">,
): string {
  const { needsYou, incomplete } = summary;
  if (needsYou === 0) {
    return incomplete
      ? "Some of what needs you couldn't load"
      : "You're all caught up";
  }
  const words =
    needsYou === 1 ? "1 thing needs you" : `${needsYou} things need you`;
  return incomplete ? `At least ${words}` : words;
}
