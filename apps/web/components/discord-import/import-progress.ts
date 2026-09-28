/** An import as the list shows it. */
export type ImportRow = {
  id: string;
  status: string;
  source?: string;
  guild_name: string | null;
  total_messages: number;
  imported_messages: number;
  /**
   * A bot import's progress in channel and thread rows; null for an upload.
   * Its message total grows as it reads, so messages cannot measure it.
   */
  channels_total?: number | null;
  channels_done?: number | null;
  messages_skipped: number;
  attachments_imported: number;
  warnings: string[];
  error: string | null;
  created_at: string;
};

/** Statuses in which an import is finished and can be cleared off the list. */
const CLEARABLE = new Set(["completed", "failed", "cancelled", "purged"]);

export function isClearable(status: string): boolean {
  return CLEARABLE.has(status);
}

/**
 * How far along an import is, in whole percent.
 *
 * A bot import is measured in channel rows: it reads Discord as it goes, so
 * its message total rises with every page and `imported / total` would read
 * 100% from the first slice (#2816). An upload knows its total from the
 * export. Either way, 100% is kept for an import that has actually finished.
 */
export function importPercent(row: ImportRow): number {
  if (row.status === "completed") return 100;
  const [done, total] =
    row.channels_total !== null && row.channels_total !== undefined
      ? [row.channels_done ?? 0, row.channels_total]
      : [row.imported_messages, row.total_messages];
  if (total === 0) return 0;
  return Math.min(99, Math.floor((done / total) * 100));
}
