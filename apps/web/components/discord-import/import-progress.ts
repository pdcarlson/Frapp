/** An import as the list shows it. */
export type ImportRow = {
  id: string;
  status: string;
  source?: string;
  guild_name: string | null;
  total_messages: number;
  imported_messages: number;
  /**
   * A bot import's progress in channel and thread rows. Null for an upload, and
   * for a bot import that is not queued, running or stopped part-way. Its
   * message total grows with every page it reads, so messages cannot measure
   * it.
   */
  channels_total?: number | null;
  channels_done?: number | null;
  messages_skipped: number;
  attachments_imported: number;
  warnings: string[];
  error: string | null;
  created_at: string;
};

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
