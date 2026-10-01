import type { components } from "@repo/api-sdk";

/**
 * An import as the list shows it: the contract's own type, so a field the API
 * stops sending is a compile error here, not a silent `undefined` read as 0 or
 * as "not a bot import" (#2860). The fields are documented on
 * `DiscordImportWithProgressResponseDto`.
 */
export type ImportRow =
  components["schemas"]["DiscordImportWithProgressResponseDto"];

/** How far a deletion has got, in messages, for a row that is `purging`. */
export type PurgeProgress = {
  /** Messages still to delete, out of `total`. Never below 0. */
  left: number;
  total: number;
  /** Whole percent deleted, capped at 99: only `purged` means done. */
  percent: number;
};

/**
 * A deleting import's progress, or null for any other status.
 *
 * The total is `imported_messages`, the figure the row and the delete
 * confirmation both show. The count can finish short of it (a message deleted
 * before #2878 lost its import id, so the purge no longer finds it) or run
 * past it (a slice that died after inserting and before its checkpoint left
 * rows it never counted), so `left` is clamped and the percent stops at 99.
 * The status, never this count, says the deletion is over.
 */
export function purgeProgress(row: ImportRow): PurgeProgress | null {
  if (row.status !== "purging") return null;
  const total = row.imported_messages;
  const purged = row.purged_messages ?? 0;
  const left = Math.max(0, total - purged);
  const percent =
    total === 0 ? 99 : Math.min(99, Math.floor((purged / total) * 100));
  return { left, total, percent };
}

/**
 * How far along an import is, in whole percent, or null when there is no
 * honest measure to show: a deleted import, or a bot import whose channel
 * counts the API did not send (not started, or the count failed). A bot
 * import's message ratio is never a stand-in, since it reads full from the
 * first page.
 *
 * A bot import is measured in channel rows: it reads Discord as it goes, so
 * its message total rises with every page and `imported / total` would read
 * 100% from the first slice (#2816). An upload is measured in messages; its
 * total also grows, a part at a time, so it can briefly read full between
 * parts. Either way, 100% is kept for an import that has actually finished.
 */
export function importPercent(row: ImportRow): number | null {
  if (row.status === "completed") return 100;
  if (row.status === "purging" || row.status === "purged") return null;
  const hasChannelCounts =
    row.channels_total !== null && row.channels_total !== undefined;
  if (row.source === "bot" && !hasChannelCounts) return null;
  const [done, total] = hasChannelCounts
    ? [row.channels_done ?? 0, row.channels_total as number]
    : [row.imported_messages, row.total_messages];
  if (total === 0) return 0;
  return Math.min(99, Math.floor((done / total) * 100));
}
