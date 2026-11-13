/**
 * Chat's cards, fed from the Activity page's rows (`GET /v1/activity`,
 * `spec/behavior/activity.md`).
 *
 * The page acts in place with the cards chat already draws (vote, mark done,
 * confirm, check in), and each of those cards takes one chat message. A poll
 * row carries its real message. A task, an event or a pending service entry
 * may have no card message at all (a card is only posted when the record was
 * made from a channel), so these build the message the card reads: the
 * payload the API writes when it posts one, except where a row says less (an
 * event row holds the member's own answer, not the event's role lists). The cards read live state by id
 * (`useTask`, `useAttendance`, `useServiceEntry`), so a built message draws
 * the record as it is now, exactly as a posted card does.
 *
 * Zero React deps, so web and mobile hand the result to their own card.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { readMessageActions } from "./history";
import {
  normalizeRow,
  type ChatMessage,
  type RawChatMessage,
  type RawChatMessageAction,
} from "./types";

/** The fields of an Activity task row the task card reads. */
export interface ActivityTaskRow {
  id: string;
  title: string;
  due_date: string;
  /** Set when the task is due at a time of day (#4003). */
  due_at?: string | null;
  assignee_id: string;
  assignee_name: string;
  created_by: string;
  created_by_name: string;
  point_reward: number | null;
  created_at: string;
}

/** The fields of an Activity event row the event card reads. */
export interface ActivityEventRow {
  id: string;
  name: string;
  location: string | null;
  start_time: string;
  end_time: string;
  attendance: "required" | "optional";
  point_value: number;
  check_in_opens_minutes: number;
}

/** The fields of an Activity hours row the hours card reads. */
export interface ActivityHoursRow {
  id: string;
  user_id: string;
  member_name: string;
  date: string;
  duration_minutes: number;
  description: string;
  created_at: string;
}

/**
 * A message for a record that has none. `id` is namespaced so it can never be
 * mistaken for a real message id (and is not one: nothing may send it to a
 * message route). No channel, for the same reason.
 */
function recordMessage(
  kind: "task" | "event" | "hours",
  recordId: string,
  senderId: string | null,
  createdAt: string,
  payload: Record<string, unknown>,
): ChatMessage {
  return normalizeRow({
    id: `activity:${kind}:${recordId}`,
    channel_id: "",
    sender_id: senderId,
    content: "",
    kind,
    payload,
    created_at: createdAt,
    sender_blocked: false,
  });
}

/** The task card's message: `TaskService.postTaskCard`'s payload. */
export function activityTaskMessage(task: ActivityTaskRow): ChatMessage {
  return recordMessage("task", task.id, task.created_by, task.created_at, {
    task_id: task.id,
    title: task.title,
    assigner_user_id: task.created_by,
    assigner_name: task.created_by_name,
    assignee_user_id: task.assignee_id,
    assignee_name: task.assignee_name,
    due_date: task.due_date,
    due_at: task.due_at ?? null,
    // The creation-time snapshot. The card shows the live status it reads back.
    status: "TODO",
    point_reward: task.point_reward,
    created_at: task.created_at,
  });
}

/** The event card's message: `EventAnnouncementService`'s payload. */
export function activityEventMessage(event: ActivityEventRow): ChatMessage {
  return recordMessage("event", event.id, null, event.start_time, {
    event_id: event.id,
    name: event.name,
    start_time: event.start_time,
    end_time: event.end_time,
    location: event.location,
    point_value: event.point_value,
    // The member's own answer, which is what the row carries, rather than the
    // event's default. The row has no role lists, so it also says outright
    // whether the event requires this member (the server's rule, alumni
    // included), which the card's Can't make it goes by (#4660).
    is_mandatory: event.attendance === "required",
    viewer_required: event.attendance === "required",
    check_in_opens_minutes: event.check_in_opens_minutes,
    created_at: event.start_time,
  });
}

/** The hours card's message: `ServiceEntryService.postHoursCard`'s payload. */
export function activityHoursMessage(entry: ActivityHoursRow): ChatMessage {
  return recordMessage("hours", entry.id, entry.user_id, entry.created_at, {
    entry_id: entry.id,
    user_id: entry.user_id,
    user_name: entry.member_name,
    duration_minutes: entry.duration_minutes,
    description: entry.description,
    date: entry.date,
    status: "PENDING",
    created_at: entry.created_at,
  });
}

/**
 * The poll card's message: the row's own chat message with its votes
 * attached. `actions` are the message's `chat_message_actions` rows, read the
 * way chat reads them; the card tallies from them.
 */
export function activityPollMessage(
  message: RawChatMessage,
  actions: readonly RawChatMessageAction[],
): ChatMessage {
  return {
    ...normalizeRow(message),
    actions: actions.filter((action) => action.message_id === message.id),
  };
}

/** How often an open poll's votes are re-read while its card is on screen. */
export const ACTIVITY_POLL_VOTES_REFRESH_MS = 15_000;

/**
 * One poll's votes, for a card drawn outside its thread. Chat keeps a poll's
 * votes current through the channel's live subscription, which the Activity
 * page does not hold, so it reads them itself: `chat_message_actions` for
 * this one message, under the member's own session (the table's read policy
 * is the channel-access rule, so a poll the member cannot read returns no
 * votes), through chat's own paged read.
 *
 * Throws on a partial set: a tally drawn from one would be wrong, so to the
 * card it is a failed read.
 */
export async function readActivityPollVotes(
  supabase: SupabaseClient,
  messageId: string,
): Promise<RawChatMessageAction[]> {
  const { actions, incomplete } = await readMessageActions(supabase, [
    messageId,
  ]);
  if (incomplete) throw new Error("Couldn't read this poll's votes");
  return actions;
}
