import { DiscordImport } from '#domain/entities/discord-import.entity';
import type { DiscordImportWithProgress } from './discord-import.service';

/**
 * The `discord_imports` columns the API returns (#2860).
 *
 * Every route that returns an import used to return the whole row, because
 * the repository reads it with `select('*')` and the service passed it on.
 * That put the worker's internals in the browser:
 *
 * - the lease: `lock_token` (the compare-and-swap token the sweeper holds
 *   while it works a slice), `locked_by` (the replica's identity),
 *   `lease_expires_at` and `attempt_count`;
 * - the resume cursor (`cursor_part_index`, `cursor_message_index`,
 *   `cursor_part_message_count`, `parts_total`) and `storage_prefix`;
 * - `guild_id`, which the worker never trusts (it re-reads the connection on
 *   every slice), so showing it only invites a client to.
 *
 * No route takes any of them back, so none was a hole. But a future route
 * that trusted a caller-supplied token would have made the lease one, and
 * the web read fields the contract never declared.
 *
 * ## Why an allowlist, walked rather than deleted from
 *
 * The same reason as `toChapterMemberView` (#930): spreading the row and
 * deleting the private keys fails open, because the next migration's column
 * is exposed by default. Walking this list means a new column stays out until
 * someone adds it here on purpose.
 *
 * The list is what the web reads (`ImportRow` in
 * `apps/web/components/discord-import/import-progress.ts`, and `source` and
 * `status` in the wizard and list). Add to it when a client needs a field,
 * together with `DiscordImportResponseDto`.
 */
export const DISCORD_IMPORT_VIEW_FIELDS = [
  'id',
  'status',
  'source',
  'guild_name',
  'total_messages',
  'imported_messages',
  'messages_skipped',
  'attachments_imported',
  'warnings',
  'error',
  'created_at',
  'messages_after',
  'purged_messages',
] as const satisfies readonly (keyof DiscordImport)[];

export type DiscordImportViewField =
  (typeof DISCORD_IMPORT_VIEW_FIELDS)[number];

/** An import as the API returns it. */
export type DiscordImportView = Pick<DiscordImport, DiscordImportViewField>;

/**
 * A bot import's progress in channel rows, which list and detail add. The
 * service's type owns the shape.
 */
export type DiscordImportProgressCounts = Pick<
  DiscordImportWithProgress,
  'channels_total' | 'channels_done'
>;

/**
 * Project an import row onto what the API returns.
 *
 * Absent keys stay absent rather than becoming `undefined`, as in
 * `toChapterMemberView`. The overload with the counts comes first: a row
 * carrying them is also a `DiscordImport`, so in the other order every call
 * resolves to the one without them.
 */
export function toDiscordImportView(
  row: DiscordImportWithProgress,
): DiscordImportView & DiscordImportProgressCounts;
export function toDiscordImportView(row: DiscordImport): DiscordImportView;
export function toDiscordImportView(
  row: DiscordImport & Partial<DiscordImportProgressCounts>,
): DiscordImportView & Partial<DiscordImportProgressCounts> {
  const view: Record<string, unknown> = {};
  for (const field of DISCORD_IMPORT_VIEW_FIELDS) {
    if (field in row) view[field] = row[field];
  }
  // The progress counts are computed, not columns, so they ride beside the
  // allowlist rather than in it: only list and detail compute them.
  if ('channels_total' in row) view.channels_total = row.channels_total;
  if ('channels_done' in row) view.channels_done = row.channels_done;
  return view as DiscordImportView & Partial<DiscordImportProgressCounts>;
}
