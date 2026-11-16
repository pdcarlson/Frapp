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
  /** Photos staged in the tray: upload status, and the claim once uploaded. */
  photos: readonly {
    status: "uploading" | "ready" | "failed";
    attachment?: unknown;
  }[];
  /** The draft names `@Frapp`, so Send would ask rather than post. */
  asksFrapp: boolean;
  /** Why a write can't go out this second (offline), or `null`. */
  writeBlocked: string | null;
}

/**
 * Why the draft can't be scheduled, or `null` when it can. The text, the
 * photos and a staged reply all go (#4971), but a photo must be uploaded
 * first: a scheduled message holds its photos' storage paths, and a photo
 * still uploading has none yet, while one that failed would be dropped.
 * Scheduling is a write with no outbox, so offline says so too.
 */
export function scheduleRefusal(input: ScheduleRefusalInput): string | null {
  if (input.photos.some((photo) => photo.status === "failed")) {
    return "A photo didn't upload. Tap it to try again, or remove it.";
  }
  // Ready with no claim is still on its way: nothing to schedule yet.
  if (
    input.photos.some(
      (photo) => photo.status === "uploading" || photo.attachment === null,
    )
  ) {
    return "Wait for your photos to finish uploading.";
  }
  if (input.asksFrapp) return "A question for Frapp can't be scheduled.";
  // A belt: the long press is offered only on a sendable draft.
  if (
    withoutObjectReplacement(input.text).trim().length === 0 &&
    input.photos.length === 0
  ) {
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
