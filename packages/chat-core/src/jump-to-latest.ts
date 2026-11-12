/**
 * The way back to a thread's newest message once the reader is back in
 * history, shared by the phone (`apps/mobile/lib/chat/use-jump-to-latest.ts`)
 * and the web (`apps/web/lib/chat/use-jump-to-latest.ts`). Each client owns its
 * own scroll geometry (the phone's list is inverted, the web's is not); what
 * counts as "something new landed below you" and what the control reads are
 * the same on both, so they live here.
 */

/** One row of the thread, newest first. */
export interface LatestRow {
  /** Its stable key: `client_message_id`, unchanged through confirmation. */
  id: string;
  /**
   * The viewer's own message: an unconfirmed send from this device, or one
   * of theirs the server has confirmed, from here or another device. Never
   * news to them.
   */
  own: boolean;
  /**
   * Drawn with nothing to read: a tombstone for a member the viewer blocked
   * (on their list, or masked by the server), or a deleted message. Never
   * news either. Blocked members' messages raise no unread badge for the
   * same reason (spec/behavior/chat § Read Receipts).
   */
  silent: boolean;
}

/**
 * Whether a row landed below the reader since they left the newest message,
 * judged on the thread as it is now rather than on anything frozen when they
 * left. `rows` is newest first; `seen` is every row's key when they left, or
 * `null` while they are at the newest message. The newest row's identity or
 * timestamp is not enough:
 *
 * - The viewer's own message is re-sorted when the server confirms it (its
 *   `created_at` becomes the server's), so a device clock ahead of the
 *   server's puts a later arrival behind a timestamp the cache no longer
 *   orders by.
 * - A message queued offline is confirmed after everything backfilled from
 *   the outage, so it comes back newest under the same key with the
 *   backfilled rows beneath it.
 * - Discarding your own failed newest message takes a row away, and the row
 *   before it becomes the newest without anything having arrived.
 *
 * So a row arrived when all of these hold:
 *
 * - Its key was not there when they left. A removal adds no key.
 * - It sits newer than the oldest row that was, which every row they could
 *   have been reading is. An older page loads past that end. With none of
 *   the old rows left (an empty thread when they left), anything there now
 *   arrived.
 * - It is someone else's and has something to read (`own`, `silent`).
 *
 * Where it sits among the rows they saw, and how old it is, don't matter.
 * The cache fills gaps under rows the reader has already seen: on reconnect
 * the realtime manager resubscribes before its REST backfill, so a live
 * message can be on screen before the ones posted during the outage are
 * merged in beneath it at their own times. Those are real messages the
 * reader hasn't seen, and missing one is worse than the other mistake this
 * rule allows: an older row released mid-history (a held row, once the
 * block list loads) lights the dot too, which costs one jump offer they can
 * ignore, since the jump only ever goes to the newest message.
 */
export function arrivedSince(
  rows: readonly LatestRow[],
  seen: ReadonlySet<string> | null,
): boolean {
  if (seen === null) return false;
  let oldestSeen = rows.length;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (seen.has(rows[index]!.id)) {
      oldestSeen = index;
      break;
    }
  }
  for (let index = 0; index < oldestSeen; index += 1) {
    const row = rows[index]!;
    if (!row.own && !row.silent && !seen.has(row.id)) return true;
  }
  return false;
}

/** The control's accessible name, by whether something new landed below. */
export function jumpToLatestLabel(hasNew: boolean): string {
  return hasNew ? "New messages. Jump to latest" : "Jump to latest";
}
