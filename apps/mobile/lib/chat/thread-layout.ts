import type { ThreadRow } from "@repo/chat-core/blocks";
import { decorateThread } from "@repo/chat-core/grouping";

export interface RowPlacement {
  /** Draw the avatar and author line (`components.md` §11 § Grouping). */
  startsRun: boolean;
  /** Draw a day divider above the row. */
  startsDay: boolean;
}

/**
 * Where each s05 row's run and day start, keyed by the list's own row key
 * (`client_message_id`), so the rows the list holds stay plain `ThreadRow`s
 * for `useJumpToMessage`.
 *
 * Worked out over the rows **oldest first**, the order the rules read in, and
 * never over the inverted list the screen draws: grouping newest-first would
 * put every divider under the wrong row. The rules are `decorateThread`, the
 * ones web's timeline calls too.
 */
export function threadLayout(
  rows: readonly ThreadRow[],
): ReadonlyMap<string, RowPlacement> {
  const byKey = new Map<string, RowPlacement>();
  for (const { row, startsRun, startsDay } of decorateThread(rows)) {
    byKey.set(row.message.client_message_id, { startsRun, startsDay });
  }
  return byKey;
}
