import type { components } from "@repo/api-sdk";
import type { NavGlyphName } from "@repo/theme/nav-glyphs";
import { eventOnAt, signUpLinkKind, taskGroupLabel } from "@repo/validation";
import { isSentBack, taskStatusLabel } from "./task-card";
import {
  closesAtHasPassed,
  formatDueLabel,
  formatMinutesRounded,
  formatRelativeDayTime,
  formatTimeOfDay,
  parseInstant,
  parseInstantOrBareLocalNoon,
} from "@repo/formatting";

export type Activity = components["schemas"]["ActivityDto"];
export type ActivityTask = components["schemas"]["ActivityTaskDto"];
/**
 * A task for everyone the member assigned, as one row of `task_items`
 * (#5492): the group's progress and what its copies share.
 */
export type ActivityTaskGroup = components["schemas"]["ActivityTaskGroupDto"];
export type ActivityPoll = components["schemas"]["ActivityPollDto"];
type ActivityEvent = components["schemas"]["ActivityEventDto"];
type ActivityHours = components["schemas"]["ActivityHoursEntryDto"];
export type ActivityLink = components["schemas"]["ActivityLinkDto"];
/** A reminder the member set on a chat message (#4957). Private to them. */
type ActivityReminder = components["schemas"]["ActivityReminderDto"];
/** A sign-up sheet, headcount or form waiting on the member's answer (#3926). */
export type ActivityCard = components["schemas"]["ActivityCardDto"];
/** How many have answered something the member made, of how many can (#4792). */
type ActivityProgress = components["schemas"]["ActivityProgressDto"];
export type ActivitySection = Activity["unavailable"][number];
/** What `POST /v1/activity/reads` names: an item's kind and id. */
export type ActivityItemRef = components["schemas"]["ActivityItemRefDto"];

/** How many rows each list of the read carries at most (`activity.md`). */
export const ACTIVITY_LIST_LIMIT = 25;

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
  | "task"
  | "confirm"
  | "hours"
  | "poll"
  | "event"
  | "link"
  | "signup"
  | "form"
  | "reminder";

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
  signup: "signup",
  form: "form",
  reminder: "schedule",
};

/**
 * An event row's date, for a calendar-style block beside the row (#4173):
 * `month` "NOV" over `day` "12", as a calendar draws it. It is drawn beside
 * the row's detail, never instead of it: the detail keeps "Tomorrow · 7:00
 * PM", which says the day in words (and to a screen reader, since the block
 * is decoration) and gives the year outside the current one.
 */
interface ActivityDateBlock {
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
   * themselves, Waiting on others), and the row leads with its glyph. A client that
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
   * dot. Never on a Waiting on others row.
   */
  unread: boolean;
  /**
   * What opening the row records as read. Null for a row that has no unread
   * dot to clear: a reminder (#4957), which is the member's own.
   */
  readRef: ActivityItemRef | null;
  /**
   * How far along a Waiting on others row is (#4792): an open poll the member
   * posted, or an event they made once its check-in has opened. A client
   * draws it as a thin bar with `label` beside it. `null` on every other row,
   * and when the read has no count for it (never "0 of 0").
   */
  progress: ActivityRowProgress | null;
}

/** A row's progress, ready to draw (#4792). */
export interface ActivityRowProgress {
  done: number;
  /** Never 0. */
  total: number;
  /** "41 of 60", drawn beside the bar. */
  label: string;
  /** "41 of 60 voted", for a screen reader. */
  spoken: string;
}

/**
 * The read's count as a row draws it. An API read from before the field
 * existed has none, and a count with nobody to answer is not drawn.
 */
function rowProgress(
  progress: ActivityProgress | null | undefined,
  verb: string,
): ActivityRowProgress | null {
  if (!progress || progress.total <= 0) return null;
  const done = Math.min(Math.max(progress.done, 0), progress.total);
  const label = `${done} of ${progress.total}`;
  return { done, total: progress.total, label, spoken: `${label} ${verb}` };
}

/** Whether a row's badge asks the member to act, rather than naming a state. */
export function activityBadgeIsAsk(row: Pick<ActivityRow, "badge">): boolean {
  return row.badge?.variant === "warning";
}

/**
 * What a row's ask does on the row itself (#4402): the asks that are one
 * press with nothing to choose. `Vote` is not one, since a poll asks which
 * option, so it opens the record as before. The client acts through the same
 * route and hook its panel uses.
 *
 * `Check in` is one wherever the client can complete it (#4427): an event
 * with a check-in zone needs the member's location, so it is on the row only
 * for a client that can supply one (`canSupplyLocation`, the phone). On web a
 * zoned event's row opens its panel, which says to use the phone
 * (`spec/behavior/events.md` § Check-In). An API read from before the field
 * existed doesn't say, so web counts its event as zoned and draws no button.
 *
 * Likewise once an officer's screen has made the code required
 * (`check_in_needs_code`, #4808): it is on the row only for a client that can
 * scan (`canScan`, the phone, which asks for the code if the press is
 * refused). On web the row opens its panel, which says to point the phone's
 * camera at the code. An officer can open the screen after the read, so a web
 * press can still be refused for that, in the words the card uses.
 */
export type ActivityRowAction = "confirm" | "approve" | "check-in";

export function activityRowAction(
  row: ActivityRow,
  options: { canSupplyLocation?: boolean; canScan?: boolean } = {},
): ActivityRowAction | null {
  if (!activityBadgeIsAsk(row)) return null;
  // A task that asks for proof opens instead: the officer sees the photos or
  // link before confirming it (#4635), which a one-press row can't show.
  if (row.kind === "task" && row.glyph === "confirm") {
    return (row.task.proof_kind ?? "none") === "none" ? "confirm" : null;
  }
  if (row.kind === "hours") return "approve";
  if (row.kind === "event" && activityEventNeedsCheckIn(row.event)) {
    const needsLocation = row.event.check_in_needs_location !== false;
    if (needsLocation && !options.canSupplyLocation) return null;
    // An API read from before the field says nothing: no code, as before.
    const needsCode = row.event.check_in_needs_code === true;
    return needsCode && !options.canScan ? null : "check-in";
  }
  return null;
}

/** One row of the page: what it shows, and the record it opens. */
export type ActivityRow = RowBase &
  (
    | { kind: "task"; task: ActivityTask }
    | {
        /**
         * A task for everyone the member assigned, once however many copies
         * it has (#5492, Paul, 2026-11-18): "Everyone · 12", how many are
         * done, and the faces of whom it went to. It opens the group's
         * `task_id`, a copy that carries the group.
         */
        kind: "task-group";
        group: ActivityTaskGroup;
        /**
         * Up to 5 of the members it went to, overdue first, for a stack of
         * faces; `group.total` says how many in all.
         */
        faceIds: string[];
      }
    | { kind: "poll"; poll: ActivityPoll }
    | { kind: "event"; event: ActivityEvent }
    | { kind: "hours"; entry: ActivityHours }
    | { kind: "link"; link: ActivityLink }
    | { kind: "card"; card: ActivityCard }
    | { kind: "reminder"; reminder: ActivityReminder }
  );

/**
 * A run of rows inside a group, under its own small heading: one per kind
 * under Waiting on others (#4173). A group with one part draws it with no
 * heading.
 */
export interface ActivityPart {
  id: string;
  /** `null` when the part is the whole group, so the group label says it. */
  label: string | null;
  rows: ActivityRow[];
  /** How many rows to draw before a "Show all" (`null`: all of them). */
  limit: number | null;
}

export interface ActivityGroup {
  id: "reminders" | "made-by-you" | "links";
  label: string;
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
  cards: "sign-ups and forms",
  coming_up: "events",
  made_events: "events you made",
  links: "links",
  reminders: "reminders",
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
  let path = "";
  try {
    path = new URL(link.url).pathname;
  } catch {
    // An unparseable URL still names its host; only Google needs the path.
  }
  return signUpLinkKind(link.host, path) ?? link.host;
}

/**
 * Whether a poll is still open at `now`: not closed when the read was taken,
 * and its closing time not passed since. The read's `is_closed` is true as of
 * the read, so a poll whose time runs out while the page is open is closed
 * here without a re-read (#4258). The closing time is read by
 * `closesAtHasPassed`, the rule chat's poll card uses too (#5242).
 */
export function activityPollIsOpen(
  poll: Pick<ActivityPoll, "is_closed" | "closes_at">,
  now: Date,
): boolean {
  if (poll.is_closed) return false;
  return !closesAtHasPassed(poll.closes_at, now.getTime());
}

/**
 * How a row's detail says when: `dated` names the day ("Tomorrow · 7:00
 * PM"), for a row that stands alone; `timed` says only the time ("7:00 PM"),
 * for a row drawn under a day's heading, as the Events lists draw theirs.
 */
type RowWhen = "dated" | "timed";

function pollRow(
  poll: ActivityPoll,
  group: string,
  now: Date,
  when: RowWhen = "dated",
): ActivityRow {
  const closed = !activityPollIsOpen(poll, now);
  const left = closed ? null : timeLeftWithinDay(poll.closes_at, now);
  const soon = left ? `closes in ${left}` : null;
  const closes = poll.closes_at
    ? when === "timed"
      ? formatTimeOfDay(poll.closes_at)
      : formatRelativeDayTime(poll.closes_at, now)
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
    // A closed poll waits on nobody; the read sends no count for one, and a
    // poll that closes after the read stops drawing its bar on the same tick.
    progress:
      group === "made" && !closed ? rowProgress(poll.progress, "voted") : null,
  };
}

/**
 * Whether a sign-up or form card still takes answers at `now`: the read
 * serves only open ones, so this is its end time not passed since
 * (`closesAtHasPassed`, as on the chat card, #5242).
 */
export function activityCardIsOpen(
  card: Pick<ActivityCard, "closes_at">,
  now: Date,
): boolean {
  return !closesAtHasPassed(card.closes_at, now.getTime());
}

/**
 * The read's cards. A read cached before the API served them (a phone's
 * persisted cache, an open tab across a deploy) has none, which is no cards.
 */
function activityCards(activity: Activity): ActivityCard[] {
  return activity.needs_you.cards ?? [];
}

/** What a card row says it is, leading its detail. */
function cardKindLabel(card: ActivityCard): string {
  const n = card.item_count;
  switch (card.kind) {
    case "headcount":
      return "Headcount";
    case "form":
      return `Form · ${n} ${n === 1 ? "question" : "questions"}`;
    default:
      return `Sign-up · ${n} ${n === 1 ? "slot" : "slots"}`;
  }
}

/** The ask on a card row: what answering it is called on the card. */
const CARD_ASK: Record<ActivityCard["kind"], string> = {
  signup: "Sign up",
  headcount: "Answer",
  form: "Fill out",
};

/**
 * A sign-up sheet, headcount or form the member hasn't answered (#3926 step
 * 4). It is answered on the card in chat, so the row opens the message there
 * rather than a panel.
 */
function cardRow(
  card: ActivityCard,
  now: Date,
  when: RowWhen = "dated",
): ActivityRow {
  const left = timeLeftWithinDay(card.closes_at, now);
  const soon = left ? `closes in ${left}` : null;
  const closes = card.closes_at
    ? when === "timed"
      ? formatTimeOfDay(card.closes_at)
      : formatRelativeDayTime(card.closes_at, now)
    : null;
  return {
    kind: "card",
    key: `needs:card:${card.message_id}`,
    card,
    title: card.title,
    detail: [
      cardKindLabel(card),
      channelLabel(card),
      soon ?? (closes ? `closes ${closes}` : null),
    ]
      .filter(Boolean)
      .join(" · "),
    soon,
    faceId: card.sender_id,
    badge: { label: CARD_ASK[card.kind], variant: "warning" },
    glyph: card.kind === "form" ? "form" : "signup",
    dateBlock: null,
    unread: card.unread,
    readRef: {
      kind: card.kind === "form" ? "form" : "signup",
      item_id: card.message_id,
    },
    progress: null,
  };
}

function taskRow(
  task: ActivityTask,
  group: string,
  role: "mine" | "confirm" | "assigned",
  now: Date,
  when: RowWhen = "dated",
): ActivityRow {
  // A finished task has no countdown: "Overdue by 2 days" under a task that is
  // done would be wrong.
  const finished = task.stored_status === "COMPLETED";
  const { soon, due } = finished
    ? { soon: null, due: null }
    : taskDue(task, now, when);
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
          label: taskStatusLabel({
            status: task.status,
            stored_status: task.stored_status,
            points_awarded: !!task.confirmed_at,
            sent_back_at: task.sent_back_at,
            point_reward: task.point_reward,
            proof_kind: task.proof_kind,
          }),
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
    progress: null,
  };
}

/**
 * When an unfinished task is due, as a row says it: `soon` is "Due in 40
 * minutes" within a day, and `due` the clause the detail ends with (that, or
 * "Due Friday"; under a day's heading only its time, if it has one).
 */
function taskDue(
  task: { due_at: string | null; due_date: string },
  now: Date,
  when: RowWhen,
): { soon: string | null; due: string | null } {
  const left = timeLeftWithinDay(task.due_at, now);
  const soon = left ? `Due in ${left}` : null;
  const due =
    soon ??
    (when === "timed"
      ? // Under its day's heading a task says only its time, if it has one.
        task.due_at
        ? `Due ${formatTimeOfDay(task.due_at)}`
        : null
      : formatDueLabel(task.due_at ?? task.due_date, now));
  return { soon, due };
}

/**
 * A task for everyone the member assigned, as one row of Tasks you assigned
 * (#5492): who it went to, in the shared words (`taskGroupLabel`:
 * "Everyone", "Everyone in Philanthropy", "6 people"), then when it is due;
 * how many it went to is said once, in the bar of how many copies are done
 * ("3 of 12"), not again in the detail; Overdue when any copy is. One task
 * sent to the whole chapter is one row, not one per member, so it can't bury
 * the other tasks the officer assigned, as Paul's 25 identical rows did.
 */
function taskGroupRow(group: ActivityTaskGroup, now: Date): ActivityRow {
  const { soon, due } = taskDue(group, now, "dated");
  return {
    kind: "task-group",
    key: `made:task-group:${group.id}`,
    group,
    faceIds: group.preview_assignee_ids,
    title: group.title,
    detail: [taskGroupLabel(group), due].filter(Boolean).join(" · "),
    soon,
    // The row leads with a stack of the members' faces instead.
    faceId: null,
    badge: group.overdue ? { label: "Overdue", variant: "destructive" } : null,
    glyph: "task",
    dateBlock: null,
    // What the member made has no dot, and no Snooze.
    unread: false,
    readRef: null,
    progress: rowProgress({ done: group.done, total: group.total }, "done"),
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
    progress: null,
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

function eventRow(
  event: ActivityEvent,
  group: string,
  now: Date,
  when: RowWhen = "dated",
): ActivityRow {
  const needsCheckIn = activityEventNeedsCheckIn(event);
  return {
    kind: "event",
    key: `${group}:event:${event.id}`,
    event,
    title: event.name,
    detail: [
      when === "timed"
        ? formatTimeOfDay(event.start_time)
        : formatRelativeDayTime(event.start_time, now),
      event.location,
    ]
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
    // Under a day's heading the date is already said: the row leads with
    // the events glyph instead.
    dateBlock: when === "timed" ? null : dateBlock(event),
    unread: group !== "made" && event.unread,
    readRef: { kind: "event", item_id: event.id },
    progress:
      group === "made" ? rowProgress(event.progress, "checked in") : null,
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
    progress: null,
  };
}

/**
 * A reminder row (#4957): the message's words as the title, then who wrote
 * it, where, and when the reminder is (or was) for. A due one carries a
 * "Due" badge, as Slack's Later list marks a reminder whose time came.
 */
function reminderRow(reminder: ActivityReminder, now: Date): ActivityRow {
  const when = formatRelativeDayTime(reminder.remind_at, now);
  return {
    kind: "reminder",
    key: `reminder:${reminder.id}`,
    reminder,
    title: reminder.preview,
    detail: [
      reminder.author_name || null,
      reminder.message_available && reminder.channel_type
        ? channelLabel({
            channel_type: reminder.channel_type,
            channel_name: reminder.channel_name ?? "",
          })
        : null,
      when ? (reminder.due ? `Reminded ${when}` : `Remind me ${when}`) : null,
    ]
      .filter(Boolean)
      .join(" · "),
    soon: null,
    faceId: null,
    badge: reminder.due ? { label: "Due", variant: "warning" } : null,
    glyph: "reminder",
    dateBlock: null,
    unread: false,
    readRef: null,
    progress: null,
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

/** How many of each kind Waiting on others draws before "Show all". */
const ACTIVITY_MADE_BY_YOU_LIMIT = 3;

function part(
  id: string,
  label: string | null,
  rows: ActivityRow[],
  limit: number | null,
): ActivityPart[] {
  return rows.length === 0 ? [] : [{ id, label, rows, limit }];
}

/**
 * The groups the page draws under the To do list, in order (#4766): Waiting
 * on others, which is what the member made (the polls they posted, the
 * events they made, the tasks they assigned), one part per kind and a few
 * rows each, so one busy kind doesn't bury the others; then Links. A client
 * leaves out a group with no rows and nothing that failed.
 *
 * The member's own things are the To do list (`activityToDos`), and what
 * waits on their review is the To review card (`activityReviewRows`). Until
 * #4766 this also built "Needs you" (split into Now and Later) and "Coming
 * up", narrowed by a row of filter chips.
 */
export function activityGroups(
  activity: Activity,
  now: Date = new Date(),
): ActivityGroup[] {
  const down = new Set(activity.unavailable);
  const downFor = (sections: ActivitySection[]) =>
    sections.filter((section) => down.has(section));
  const links = activity.links.map((link) => linkRow(link, now));
  // Due first (the read orders by time, so the oldest due leads), then the
  // ones still waiting, soonest first. `?? []`: a read from an API before
  // #4957 has no field.
  const reminders = (activity.reminders ?? []).map((reminder) =>
    reminderRow(reminder, now),
  );

  // A poll that closes, by time or by hand, leaves the list on the page's
  // clock; the next read leaves it out, and it is in the Archive (#5127).
  const madePolls = activity.made_by_you.polls
    .filter((poll) => activityPollIsOpen(poll, now))
    .map((poll) => pollRow(poll, "made", now));
  const madeEvents = activity.made_by_you.events.map((event) =>
    eventRow(event, "made", now),
  );
  const madeTasks = madeTaskRows(activity, now);

  return [
    {
      // The member's own reminders on chat messages (#4957), apart from the
      // To do list: Slack keeps them in Later, beside saved items.
      id: "reminders",
      label: "Reminders",
      rows: reminders,
      parts: part("all", null, reminders, null),
      unavailable: downFor(["reminders"]),
    },
    {
      // What the member made, listed for what it still waits on.
      id: "made-by-you",
      label: "Waiting on others",
      rows: [...madePolls, ...madeEvents, ...madeTasks],
      parts: [
        ...part(
          "polls",
          "Polls you posted",
          madePolls,
          ACTIVITY_MADE_BY_YOU_LIMIT,
        ),
        ...part(
          "events",
          "Events you made",
          madeEvents,
          ACTIVITY_MADE_BY_YOU_LIMIT,
        ),
        ...part(
          "tasks",
          "Tasks you assigned",
          madeTasks,
          ACTIVITY_MADE_BY_YOU_LIMIT,
        ),
      ],
      unavailable: downFor(["polls", "made_events", "tasks"]),
    },
    {
      // Their own group, not the To do list: a link may or may not be for
      // this member, and Frapp can't see one filled in (spec § Links).
      id: "links",
      label: "Links",
      rows: links,
      parts: part("all", null, links, null),
      unavailable: downFor(["links"]),
    },
  ];
}

/**
 * Tasks you assigned. From `task_items` when served (#5492): the read has
 * already left out what is finished and counted a task for everyone once,
 * as one row that opens its group (the phone's task screen, web's Tasks
 * board since #5538). From an API before the field (a persisted cache, a
 * server behind the build), from `tasks`, each copy its own row, less the
 * confirmed ones, which are finished and in the Archive (#5127).
 */
function madeTaskRows(activity: Activity, now: Date): ActivityRow[] {
  const items = activity.made_by_you.task_items ?? null;
  if (items) {
    return items.map((item) =>
      item.kind === "group"
        ? taskGroupRow(item.group, now)
        : taskRow(item.task, "made", "assigned", now),
    );
  }
  return activity.made_by_you.tasks
    .filter((task) => !task.confirmed_at)
    .map((task) => taskRow(task, "made", "assigned", now));
}

/** One of the member's own to-dos, with when it falls. */
export interface ActivityToDo {
  /** The row as it stands alone: its detail names the day. */
  dated: ActivityRow;
  /** The same row for under a day's heading: its detail says only the time. */
  timed: ActivityRow;
  /**
   * When it is due, starts or closes; `null` for a poll or card with no
   * closing time. A task with only a date is read as noon that day.
   */
  at: Date | null;
  /** An event on now (`eventOnAt`) that the member can check in to and hasn't. */
  now: boolean;
  /** A task past its due date. */
  overdue: boolean;
}

/**
 * The member's own to-dos (#4766): their events, their open tasks, and the
 * polls, sign-ups and forms they haven't answered, in the read's order. Never
 * what waits on their review (`activityReviewRows`). A row's key is its
 * record's (`needs:task:<id>`, `needs:poll:<id>`), the same on every re-read,
 * so a sheet opened on one finds it again.
 */
export function activityToDos(
  activity: Activity,
  now: Date = new Date(),
): ActivityToDo[] {
  const both = (
    build: (when: RowWhen) => ActivityRow,
    at: Date | null,
    flags: { now?: boolean; overdue?: boolean } = {},
  ): ActivityToDo => ({
    dated: build("dated"),
    timed: build("timed"),
    at,
    now: flags.now ?? false,
    overdue: flags.overdue ?? false,
  });
  return [
    // An event the member has checked in to is done: it counts in the week
    // ring and leaves the list.
    ...activity.coming_up
      .filter((event) => !event.checked_in)
      .map((event) => {
        const needsCheckIn = activityEventNeedsCheckIn(event);
        return both(
          (when) =>
            eventRow(event, needsCheckIn ? "needs" : "coming", now, when),
          parseInstant(event.start_time),
          // Happening now only until its end, as the Now card and the
          // event's pill say (#5777); check-in's grace after it still
          // offers Check in under its day.
          {
            now:
              needsCheckIn &&
              eventOnAt(
                event.start_time,
                event.end_time,
                event.check_in_opens_minutes,
                now.getTime(),
              ),
          },
        );
      }),
    ...activity.needs_you.tasks.map((task) =>
      both(
        (when) => toDoTaskRow(taskRow(task, "needs", "mine", now, when)),
        parseInstantOrBareLocalNoon(task.due_at ?? task.due_date),
        { overdue: task.status === "OVERDUE" },
      ),
    ),
    ...activity.needs_you.polls
      .filter((poll) => activityPollIsOpen(poll, now))
      .map((poll) =>
        both(
          (when) => pollRow(poll, "needs", now, when),
          poll.closes_at ? parseInstant(poll.closes_at) : null,
        ),
      ),
    ...activityCards(activity)
      .filter((card) => activityCardIsOpen(card, now))
      .map((card) =>
        both(
          (when) => cardRow(card, now, when),
          card.closes_at ? parseInstant(card.closes_at) : null,
        ),
      ),
  ];
}

/**
 * A task on the To do list says its state only when that is news: overdue,
 * or sent back for changes. "To do" on every row of a list named To do is
 * the chip Paul's principles call noise (P3).
 */
function toDoTaskRow(row: ActivityRow): ActivityRow {
  if (row.kind !== "task" || row.badge?.variant !== "outline") return row;
  return isSentBack(row.task) ? row : { ...row, badge: null };
}

/**
 * What waits on the member's review (#4766): finished tasks they can confirm,
 * longest waiting first, then service hours they can approve, as the read
 * serves them. Empty for a member who holds neither permission.
 */
export function activityReviewRows(
  activity: Activity,
  now: Date = new Date(),
): ActivityRow[] {
  return [
    ...activity.needs_you.task_confirmations.map((task) =>
      taskRow(task, "needs-confirm", "confirm", now),
    ),
    ...activity.needs_you.hours_approvals.map(hoursRow),
  ];
}

/**
 * The row a task's review push opens (`target.view === "review"`): the task
 * wherever the feed has it. What waits on the viewer's review comes first,
 * so a completion opens as the thing to act on, then their own to-dos, then
 * what they assigned. Null when the feed no longer has it, such as a
 * completion confirmed from another device.
 *
 * A copy of a task for everyone the viewer assigned finds the group's row when it is the copy that row opens
 * (`task_id`); the read names no other copy, so another finds nothing there.
 * A completed copy is found first anyway, among what waits on review.
 */
export function findActivityTaskRow(
  activity: Activity,
  taskId: string,
  now: Date = new Date(),
): ActivityRow | null {
  const rows = [
    ...activityReviewRows(activity, now),
    ...activityToDos(activity, now).map((todo) => todo.dated),
    ...activityGroups(activity, now).flatMap((group) => group.rows),
  ];
  return rows.find((row) => activityRowTaskId(row) === taskId) ?? null;
}

/**
 * The task a row opens: its own, or for a task for everyone the copy that
 * carries the group (`task_id`). `null` on a row that is not a task.
 */
export function activityRowTaskId(row: ActivityRow): string | null {
  if (row.kind === "task") return row.task.id;
  if (row.kind === "task-group") return row.group.task_id;
  return null;
}

/**
 * The tasks waiting on the viewer's sign-off, longest waiting first, as the
 * To review card lists them: the queue a review steps through (#4693).
 * Confirm or Send back on one opens the next, the way Classroom's grader
 * moves to the next student's work, so twenty-five Sunday-night chores are
 * one sitting rather than twenty-five trips back to the list.
 */
export function activityReviewQueue(
  activity: Activity,
  now: Date = new Date(),
): ActivityRow[] {
  return activityReviewRows(activity, now).filter(
    (row) => row.kind === "task" && row.glyph === "confirm",
  );
}

/** `GET /v1/activity/archive`: what the member has finished (#5127). */
export type ActivityArchive = components["schemas"]["ActivityArchiveDto"];
export type ActivityArchiveSection = ActivityArchive["unavailable"][number];

/**
 * One section of the Archive, laid out as Activity lays out its groups:
 * Events, Tasks, Polls, each newest first.
 */
export interface ActivityArchiveGroup {
  id: ActivityArchiveSection;
  label: string;
  rows: ActivityRow[];
  /** The section could not be read this time: "Couldn't load …". */
  unavailable: boolean;
}

/** A name for an Archive section that could not load. */
export const ACTIVITY_ARCHIVE_SECTION_NAMES: Record<
  ActivityArchiveSection,
  string
> = {
  events: "events",
  tasks: "tasks",
  polls: "polls",
};

/** What the Archive says when it holds nothing. */
export const ACTIVITY_ARCHIVE_EMPTY =
  "Nothing finished in the last 30 days. Events, tasks and polls land here once they're over.";

/**
 * The Archive's sections (#5127,
 * `spec/behavior/activity.md` § Archive), each row built as the page builds
 * it so it reads and opens the same: an event that is over (with "Checked
 * in" when the member did), a task that is done (with its state: Confirmed,
 * or still waiting on an officer), a poll that has closed. A row's key is
 * `archive:…`, apart from the page's keys. A section with no rows and
 * nothing that failed is left out.
 */
export function activityArchiveGroups(
  archive: ActivityArchive,
  viewerId: string | null,
  now: Date = new Date(),
): ActivityArchiveGroup[] {
  const down = new Set(archive.unavailable);
  const events = archive.events.map((event) => {
    const row = eventRow(event, "archive", now);
    // Over: nothing to check in to, and "Required" no longer asks anything.
    return { ...row, badge: event.checked_in ? row.badge : null };
  });
  const tasks = archive.tasks.map((task) =>
    taskRow(
      task,
      "archive",
      viewerId !== null && task.assignee_id !== viewerId ? "assigned" : "mine",
      now,
    ),
  );
  const polls = archive.polls.map((poll) => ({
    ...pollRow(poll, "archive", now),
    // The member's own poll leads with its glyph, as on the page.
    faceId: poll.sender_id === viewerId ? null : poll.sender_id,
  }));
  const groups: ActivityArchiveGroup[] = [
    { id: "events", label: "Events", rows: events, unavailable: false },
    { id: "tasks", label: "Tasks", rows: tasks, unavailable: false },
    { id: "polls", label: "Polls", rows: polls, unavailable: false },
  ];
  return groups
    .map((group) => ({ ...group, unavailable: down.has(group.id) }))
    .filter((group) => group.rows.length > 0 || group.unavailable);
}
