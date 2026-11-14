/**
 * The phone's rules for scheduling a chat message (#4956), kept out of the
 * sheets so they can be tested. The times themselves (presets, limits, how a
 * time reads) are shared with web in `@repo/hooks` (`scheduled-message-times`);
 * the line's count is the phone's own, since it also names the next time.
 */
import { formatScheduledFor, type ScheduledMessage } from "@repo/hooks";
import { withoutObjectReplacement } from "@repo/validation";

export interface ScheduleRefusalInput {
  /** The draft as typed. */
  text: string;
  /** Photos staged in the tray. */
  photos: number;
  /** A reply is staged. */
  replying: boolean;
  /** The draft names `@Frapp`, so Send would ask rather than post. */
  asksFrapp: boolean;
  /** Why a write can't go out this second (offline), or `null`. */
  writeBlocked: string | null;
}

/**
 * Why the draft can't be scheduled, or `null` when it can. Text only for now,
 * as on web: a photo or a reply would be dropped on the way, so the sheet
 * says so and keeps everything, rather than scheduling half the message.
 * Scheduling is a write with no outbox, so offline says so too.
 */
export function scheduleRefusal(input: ScheduleRefusalInput): string | null {
  if (input.photos > 0) {
    return "Photos can't be scheduled yet. Send them now, or remove them first.";
  }
  if (input.replying) {
    return "Replies can't be scheduled yet. Remove the reply first.";
  }
  if (input.asksFrapp) return "A question for Frapp can't be scheduled.";
  // A belt: the long press is offered only on a sendable draft.
  if (withoutObjectReplacement(input.text).trim().length === 0) {
    return "Type a message to schedule.";
  }
  return input.writeBlocked;
}

/**
 * What the line above the composer says while the member has scheduled
 * messages in the channel: how many, and when the soonest goes, so a message
 * just scheduled confirms itself there. `null` when there are none.
 */
export function scheduledLine(
  rows: readonly Pick<ScheduledMessage, "status" | "send_at">[],
  now: Date,
): { label: string; failed: number } | null {
  if (rows.length === 0) return null;
  const count =
    rows.length === 1
      ? "1 scheduled message"
      : `${rows.length} scheduled messages`;
  const failed = rows.filter((row) => row.status === "failed").length;
  const soonest = rows
    .filter((row) => row.status !== "failed")
    .map((row) => new Date(row.send_at))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const label = soonest
    ? `${count} · next ${lowerFirst(formatScheduledFor(soonest, now))}`
    : count;
  return { label, failed };
}

/** "Tomorrow at 9:00 AM" reads "tomorrow at 9:00 AM" mid-sentence. */
function lowerFirst(text: string): string {
  return /^(Today|Tomorrow) /.test(text)
    ? text.charAt(0).toLowerCase() + text.slice(1)
    : text;
}
