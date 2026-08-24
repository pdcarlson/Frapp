/**
 * The Discord archive import (phase 2 of the migration tool).
 *
 * The admin runs DiscordChatExporter themselves and uploads the export; Signet
 * imports it. No Discord bot token is stored anywhere in the product, and no
 * part of DCE runs on our infrastructure. That is a deliberate boundary, not a
 * shortcut: the API image is Node-on-Alpine with no .NET, Render hosts only
 * web services with ephemeral disk, and there is no per-tenant credential
 * storage in this repo to hold a bot token safely.
 */

/**
 * Where an import is in its life.
 *
 * `running` and `purging` are the two **worker-owned** states — the only ones
 * the cron sweeper advances. Every other transition is an admin action through
 * the API, so a stalled job is always either waiting on a person or holding a
 * lease that will expire.
 */
export type DiscordImportStatus =
  | 'draft'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'purging'
  | 'purged';

export const DISCORD_IMPORT_STATUSES: readonly DiscordImportStatus[] = [
  'draft',
  'ready',
  'running',
  'completed',
  'failed',
  'cancelled',
  'purging',
  'purged',
] as const;

/** Statuses from which nothing further happens without an admin acting. */
export const DISCORD_IMPORT_TERMINAL_STATUSES: readonly DiscordImportStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'purged',
] as const;

/** What the admin chose to do with one Discord channel. */
export type DiscordChannelMappingAction =
  | 'create_new'
  | 'use_existing'
  | 'skip';

export type DiscordImportChannelStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

/**
 * One Discord role as the export recorded it, paired with the Signet role the
 * admin intends for its members.
 *
 * **This grants nothing.** Nothing reads `signet_role_key` to assign a role, and
 * the importer never touches a `members` row — every imported author is a name
 * on a message, not an account. It is a worksheet the admin fills in during the
 * wizard and reads back later when promoting people by hand, which is the
 * model Signet's onboarding already uses. If a future change wants Discord data
 * to actually grant a permission, that is a new decision and a new review, not
 * a matter of wiring up a field that is already here.
 */
export interface DiscordRoleMapping {
  discord_role_id: string;
  discord_role_name: string;
  /** A Signet system-role key. Defaults to the member role for every entry. */
  signet_role_key: string;
}

export interface DiscordImport {
  id: string;
  chapter_id: string;
  created_by: string | null;
  status: DiscordImportStatus;
  guild_id: string | null;
  guild_name: string | null;
  /**
   * When the admin confirmed they posted an in-channel notice to their Discord
   * server. NOT NULL in the database, so no import can exist without it — a
   * friction point that lived only in the web wizard would be skippable by
   * anything calling the API directly.
   */
  consent_acknowledged_at: string;
  role_mapping: DiscordRoleMapping[];
  storage_prefix: string | null;
  total_messages: number;
  imported_messages: number;
  messages_skipped: number;
  attachments_imported: number;
  attachments_skipped: number;
  parts_total: number;
  cursor_part_index: number;
  cursor_message_index: number;
  cursor_part_message_count: number;
  warnings: string[];
  error: string | null;
  lock_token: string | null;
  locked_by: string | null;
  lease_expires_at: string | null;
  attempt_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  purged_at: string | null;
}

export interface DiscordImportChannel {
  id: string;
  import_id: string;
  discord_channel_id: string;
  discord_channel_name: string;
  discord_category: string | null;
  mapping_action: DiscordChannelMappingAction;
  /** The Signet channel this maps onto. Null until the mapping step runs. */
  target_channel_id: string | null;
  new_channel_name: string | null;
  new_channel_is_read_only: boolean;
  message_count: number;
  imported_count: number;
  status: DiscordImportChannelStatus;
  error: string | null;
}

export type DiscordImportFileKind = 'export' | 'media';

/**
 * One uploaded file, and the only bridge from the export's own asset URLs back
 * to storage.
 *
 * DCE run with `--media` rewrites every asset URL in the JSON to a path
 * relative to the export folder on the admin's machine, so `attachments[].url`
 * reads like `Guild - general [123]_Files/photo-a1b2c3.png`. The importer
 * resolves that by looking `relative_path` up here — never by rebuilding a
 * storage key out of parts.
 */
export interface DiscordImportFile {
  id: string;
  import_id: string;
  chapter_id: string;
  kind: DiscordImportFileKind;
  /** Order of the JSON partitions; what `cursor_part_index` indexes into. */
  part_index: number | null;
  /** The path exactly as the export names it. The join key. */
  relative_path: string;
  bucket: string;
  storage_path: string;
  content_type: string | null;
  byte_size: number | null;
  /** Null until the browser confirms its PUT landed. */
  uploaded_at: string | null;
  created_at: string;
}

/** A Discord channel the scan found in the export, before it is mapped. */
export interface DiscoveredDiscordChannel {
  discord_channel_id: string;
  discord_channel_name: string;
  discord_category: string | null;
  message_count: number;
}

/** A Discord role the scan found on a message author. */
export interface DiscoveredDiscordRole {
  discord_role_id: string;
  discord_role_name: string;
}
