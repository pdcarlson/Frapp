/**
 * Asking Frapp to do something (#718, `spec/behavior/ai.md` § Asking Frapp to
 * do something): what the API answers and the words both clients show.
 *
 * An officer types a request ("give 5 points to everyone who came tonight").
 * Nothing is done by asking: the answer is a card that says exactly what
 * would happen, and only the officer's Confirm does it.
 *
 * A reader ignores a `status`, an `action`, a note `type` or a `missing`
 * value it does not know (it shows the generic line), so an installed mobile
 * build keeps working when the list grows.
 */

export const ACT_REQUEST_MAX_LENGTH = 1000;

/** The actions the agent can propose. Open on the wire. */
export const ACT_ACTIONS = [
  "give_points",
  "create_task",
  "create_event",
] as const;
export type ActAction = (typeof ACT_ACTIONS)[number];

/**
 * How a request ended.
 *
 * - `proposed`: a card is waiting; `suggestion` is it.
 * - `needs_event`: the points are for everyone who came to an event, and
 *   which event is not clear. `event_choice` lists the ones to pick from.
 * - `unclear`: an action fits, and something it needs was not said.
 * - `no_action`: nothing this member can do here fits the request.
 * - `refused`: the model provider declined the request.
 * - `unavailable`: nothing was attempted; `reason` says why.
 */
export const ACT_STATUSES = [
  "proposed",
  "needs_event",
  "unclear",
  "no_action",
  "refused",
  "unavailable",
] as const;
export type ActStatus = (typeof ACT_STATUSES)[number];

/** What an `unclear` request left out. */
export const ACT_MISSING = [
  "amount",
  "reason",
  "people",
  "title",
  "date",
  "time",
  "attendance_access",
  "nobody_attended",
  "too_many_members",
  "request",
] as const;
export type ActMissing = (typeof ACT_MISSING)[number];

/** Things the card says beside the proposal. */
export const ACT_NOTE_TYPES = [
  "matched_name",
  "unmatched_name",
  "ambiguous_name",
  "role_members",
  "self_left_out",
] as const;
export type ActNoteType = (typeof ACT_NOTE_TYPES)[number];

/** A proposal the member asked for waits this long, then is gone. */
export const ACT_PROPOSAL_EXPIRY_DAYS = 1;

/**
 * The words a proposal in the Ask conversation shows, shared so web and
 * mobile cannot drift. What surrounds the card (the field, the empty state)
 * is `ASK_COPY`'s.
 */
export const ACT_COPY = {
  /** One request to try, per action, on Ask's empty state. */
  examples: {
    give_points: "Give 5 points to everyone who came to chapter tonight",
    create_task: "Make a task for Jordan to book the bus by Friday",
    create_event: "Put a study night on the calendar for Tuesday at 7",
  } satisfies Record<ActAction, string>,
  confirm: "Confirm",
  cancel: "Cancel",
  confirming: "Confirming",
  mine_only: "Only you can see this. Nothing changes until you confirm.",
  no_members: "Add at least one member to confirm.",
  need_assignee: "Pick who this is for.",
  need_due: "Pick when it is due.",
  gone: "This is no longer waiting. Ask again.",
  cancelled: "Cancelled. Nothing was changed.",
  failed: "That didn't go through. Try again.",
  /** Why Confirm was refused, by the API's error code. */
  refused_confirm: {
    "ai.suggestion.points.over_limit":
      "That is more point changes than your chapter allows in an hour. Take some members off, or raise the limit in Points settings.",
    "ai.suggestion.points.partial":
      "Some members got their points and the rest did not go through. Confirm again to finish. Nobody is changed twice.",
    "ai.suggestion.points.no_members":
      "None of these members are in the chapter any more.",
    "ai.suggestion.incomplete":
      "Something on this card is missing. Fill it in, then confirm.",
  },
  no_action: "That isn't something Ask can do for you here.",
  no_action_can: "It can:",
  action_labels: {
    give_points: "Give or take away points",
    create_task: "Create a task",
    create_event: "Create an event",
  } satisfies Record<ActAction, string>,
  missing: {
    amount: "Say how many points.",
    reason: "Say what the points are for.",
    people: "Say who it is for.",
    title: "Say what it is called.",
    date: "Say which day.",
    time: "Say what time it starts.",
    attendance_access:
      "You can't see attendance for events, so name the members instead.",
    nobody_attended: "Nobody is marked as having attended that event.",
    too_many_members:
      "That is more members than one points change can hold. Split it up.",
    request:
      "I couldn't work out what to do from that. Try saying it another way.",
  } satisfies Record<ActMissing, string>,
  /** The card. */
  card_points_title_give: "Give points",
  card_points_title_take: "Take away points",
  card_task_title: "Create a task",
  card_event_title: "Create an event",
  field_reason: "Reason",
  field_members: "Members",
  field_for: "For",
  field_due: "Due",
  field_when: "When",
  field_where: "Where",
  field_points: "Points",
  field_attendance: "Attendance",
  show_members: "Show members",
  hide_members: "Hide members",
  remove_member: "Remove",
  add_member: "Add a member",
  pick_member: "Pick a member",
  pick_due: "Pick a due date",
  pick_event: "Which event?",
  no_recent_events: "There are no recent events to pick from.",
  former_member: "A former member",
  required: "Required",
  optional: "Optional",
  default_points: "The chapter's usual amount",
  event_push: "The members it invites are notified when it is created.",
  points_push: "Each member is notified.",
  task_push: "They are notified when it is created.",
  self_left_out: "You can't change your own points, so you are left out.",
  done_task: "Task created.",
  done_event: "Event created.",
  open_tasks: "Open Tasks",
  open_events: "Open Events",
  open_points: "Open Points",
  waiting: "Waiting for you",
} as const;

function members(count: number): string {
  return count === 1 ? "1 member" : `${count} members`;
}

function points(amount: number): string {
  const size = Math.abs(amount);
  return size === 1 ? "1 point" : `${size} points`;
}

/** "Give 5 points to 42 members" / "Take 10 points away from 1 member". */
export function actPointsHeadline(amount: number, count: number): string {
  return amount < 0
    ? `Take ${points(amount)} away from ${members(count)}`
    : `Give ${points(amount)} to ${members(count)}`;
}

/** The size line of a points card: every bulk action says its size plainly. */
export function actPointsTotalLine(amount: number, count: number): string {
  if (count <= 1) return "";
  const total = Math.abs(amount) * count;
  return `${total.toLocaleString("en-US")} points in all, in ${count} separate changes.`;
}

/** What the card says once a points proposal was carried out. */
export function actPointsDoneLine(
  amount: number,
  adjusted: number,
  skipped: number,
): string {
  const done =
    amount < 0
      ? `Took ${points(amount)} away from ${members(adjusted)}.`
      : `Gave ${points(amount)} to ${members(adjusted)}.`;
  return skipped > 0
    ? `${done} ${members(skipped)} ${skipped === 1 ? "was" : "were"} left out because they are no longer in the chapter.`
    : done;
}

/**
 * When a proposed event is, written out in full ("Tuesday, November 17,
 * 7:00 PM to 8:00 PM"): the card is what the officer confirms, so nothing in
 * it is abbreviated. An end on another day names that day too. Empty when
 * the start cannot be read.
 */
export function actWhenLine(
  start: string,
  end: string,
  timeZone?: string,
): string {
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime())) return "";
  const zone = timeZone ? { timeZone } : {};
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...zone,
  });
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    ...zone,
  });
  const opens = `${day.format(from)}, ${time.format(from)}`;
  if (Number.isNaN(to.getTime())) return opens;
  return day.format(from) === day.format(to)
    ? `${opens} to ${time.format(to)}`
    : `${opens} to ${day.format(to)}, ${time.format(to)}`;
}

/**
 * Whose attendance a points card was read from ("Everyone marked present or
 * late at Chapter Meeting, Thursday, November 12"), so a card never lists
 * members without saying where they came from. Empty without an event.
 */
export function actAttendanceLine(
  eventName: string | null | undefined,
  start: string | null | undefined,
  timeZone?: string,
): string {
  if (!eventName) return "";
  const at = start ? new Date(start) : null;
  const day =
    at && !Number.isNaN(at.getTime())
      ? new Intl.DateTimeFormat("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          ...(timeZone ? { timeZone } : {}),
        }).format(at)
      : "";
  return `Everyone marked present or late at ${eventName}${day ? `, ${day}` : ""}`;
}

/** One note beside a proposal, in words. Null for a note this build does not know. */
export function actNoteLine(note: {
  type: string;
  name?: string | null;
  matched?: string | null;
  count?: number | null;
}): string | null {
  const name = note.name ?? "";
  switch (note.type) {
    case "matched_name":
      return `"${name}" was read as ${note.matched ?? "a member"}. Check that is who you meant.`;
    case "unmatched_name":
      return `Nobody in the chapter matched "${name}". Add them below if they should be included.`;
    case "ambiguous_name":
      return `More than one member matched "${name}". Add the one you meant below.`;
    case "role_members":
      return `"${name}" was read as the role, which ${members(note.count ?? 0)} ${note.count === 1 ? "holds" : "hold"}.`;
    case "self_left_out":
      return ACT_COPY.self_left_out;
    default:
      return null;
  }
}

/** What an unclear request says, with a fallback for a value this build does not know. */
export function actMissingLine(missing: string | null): string {
  return (
    (ACT_COPY.missing as Record<string, string>)[missing ?? ""] ??
    ACT_COPY.missing.request
  );
}

/** An action's label, or null for an action this build does not know. */
export function actActionLabel(action: string): string | null {
  return (ACT_COPY.action_labels as Record<string, string>)[action] ?? null;
}

/** Why a Confirm was refused, or null for a code this build has no words for. */
export function actConfirmRefusalLine(code: string | null): string | null {
  return (
    (ACT_COPY.refused_confirm as Record<string, string>)[code ?? ""] ?? null
  );
}
