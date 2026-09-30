/**
 * The Discord archive import.
 *
 * There are two ways in, and both land here.
 *
 * **`source: 'upload'`** (phase 2) — the admin runs DiscordChatExporter
 * themselves and their browser uploads the export. No part of DCE runs on our
 * infrastructure: the API image is Node-on-Alpine with no .NET, and Render
 * hosts only web services with ephemeral disk.
 *
 * **`source: 'bot'`** (phase 3) — the chapter installs one Frapp-owned bot
 * through Discord's ordinary "Add to Server" OAuth flow and the API reads the
 * history itself over the REST API. The bot token is a single global Frapp
 * secret; the only per-chapter value is a guild id, which is public and inert
 * without an install behind it.
 *
 * The upload path is **not** superseded. It is the fallback for the day one
 * shared bot gets throttled or refused across every chapter, and everything
 * downstream of the fetch — consent, channel mapping, the purge — is shared
 * verbatim between the two. Only the bot path maps roles (#2818): an export
 * names no roles and carries no permissions.
 */

/** Where an import's bytes came from. */
export type DiscordImportSource = 'upload' | 'bot';

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

/** What the admin chose to do with one Discord channel. */
export type DiscordChannelMappingAction =
  'create_new' | 'use_existing' | 'skip';

export type DiscordImportChannelStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/** What the admin chose for one Discord role. */
export type DiscordRoleMappingAction = 'existing' | 'new' | 'ignore';

/**
 * One Discord role, and the Frapp role it becomes (#2818).
 *
 * The mapping **gates channels and creates roles, but never assigns anyone.**
 * A channel imported "Same as Discord" is readable by the Frapp roles mapped
 * from the Discord roles that could read it, through each role's
 * `read_permission`. Starting the import creates the `new` roles and grants
 * each role the read permission of the channels gated on it; it never touches
 * a `members` row, since every imported author is a name on a message, not an
 * account. People are put into roles by hand afterwards.
 *
 * `ignore` maps to nothing: channels gated "Same as Discord" leave that role's
 * members out. A row written before #2818 (it carried a `signet_role_key`
 * worksheet note) reads as `ignore`.
 */
export interface DiscordRoleMapping {
  discord_role_id: string;
  discord_role_name: string;
  action: DiscordRoleMappingAction;
  /**
   * `existing`: the chapter role it maps to. `new`: the role starting the
   * import created (or found by name), null until then. Null for `ignore`.
   */
  frapp_role_id: string | null;
  /** `new` only: the name the role is created with. */
  new_role_name: string | null;
  /**
   * The permission a channel gated "Same as Discord" requires for this role,
   * assigned by the API when the mapping is saved (never by the caller). Every
   * entry mapping to the same Frapp role carries the same one. Null for
   * `ignore`.
   */
  read_permission: string | null;
}

export interface DiscordImport {
  id: string;
  chapter_id: string;
  created_by: string | null;
  status: DiscordImportStatus;
  /**
   * Which way the bytes came in. Defaults to `upload` in the database, so every
   * pre-phase-3 row keeps its meaning without a backfill.
   */
  source: DiscordImportSource;
  /**
   * The guild this import reads.
   *
   * Informational on an `upload` import (whatever the export's preamble said).
   * On a `bot` import it is a **copy** of `discord_connections.guild_id`, taken
   * when the job was created — and it is never the value the fetch trusts. The
   * worker re-reads the connection by `chapter_id` on every slice and refuses
   * the job if the two disagree, so a tampered job row cannot point the bot at
   * another chapter's guild.
   */
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
  /**
   * When the chapter took this import's record off its list. Only a purged
   * import is cleared, so nothing it brought in is left behind unlisted.
   */
  cleared_at: string | null;
  /**
   * Bot path only: import only messages sent at or after this instant; null
   * imports all history (#2858). Set when the import is first started and
   * fixed from then on, so every channel follows one rule.
   */
  messages_after: string | null;
}

export interface DiscordImportChannel {
  id: string;
  import_id: string;
  discord_channel_id: string;
  discord_channel_name: string;
  discord_category: string | null;
  mapping_action: DiscordChannelMappingAction;
  /** The Frapp channel this maps onto. Null until the mapping step runs. */
  target_channel_id: string | null;
  new_channel_name: string | null;
  new_channel_is_read_only: boolean;
  message_count: number;
  imported_count: number;
  status: DiscordImportChannelStatus;
  error: string | null;
  /**
   * Resume point within this channel, for the `bot` path only.
   *
   * The bot walks a channel backwards, asking Discord for the page BEFORE a
   * snowflake, so its cursor is a snowflake rather than an index. It lives on
   * the channel rather than on the job because the row's own `status` is then
   * the entire work queue — the worker takes the first channel that is not
   * finished, and a channel list that changes between slices cannot silently
   * re-point a job-level index at a different channel.
   *
   * Null on an `upload` import, which resumes on the job's part cursor instead.
   */
  cursor_before_snowflake: string | null;
  /**
   * Set when this row is a **thread**, naming the channel it lives in.
   *
   * A thread is its own Discord channel with its own id, message endpoint and
   * cursor, so it needs its own row. It does **not** get its own mapping
   * question: the wizard lists only rows where this is null, and the service
   * copies a parent's decision across its threads. The admin chose a
   * destination for #general; a thread inside #general is part of #general.
   */
  parent_discord_channel_id: string | null;
  /** Discovery order, pinned so a thread lists directly under its parent. */
  position: number;
  /**
   * Whether the bot could read this channel's history when it scanned.
   *
   * `false` is Discord hiding it from the bot: a channel-level View Channels or
   * Read Message History deny that no role the bot holds overrides. Such a
   * channel is listed (Discord returns every channel to a bot) but cannot be
   * imported, and the mapping refuses anything but `skip` for it. Null when
   * the scan could not tell, and always on the upload path.
   */
  readable: boolean | null;
  /**
   * Whether the channel was private in Discord: some member could not read
   * its history (see `openToEveryone`). On a thread row, true also for a
   * private thread.
   *
   * The API will not create a channel from such a row, or from a null one, in
   * Frapp until the admin has chosen its visibility explicitly: nothing
   * private in Discord becomes readable by the whole chapter by default. Null
   * when unknown, and always on the upload path.
   */
  private_in_discord: boolean | null;
  /**
   * Visibility of the channel `create_new` makes: the whole chapter, or only
   * members holding one of `new_channel_required_permissions`.
   */
  new_channel_type: DiscordImportNewChannelType;
  /** Non-empty exactly when `new_channel_type` is `ROLE_GATED` (DB CHECK). */
  new_channel_required_permissions: string[] | null;
  /**
   * The Discord roles that could read this channel's history, each on its own
   * (`readerRoleIds`), leaving out `@everyone` and the managed roles Discord
   * gives bots and boosters. Recorded by the scan for a top-level channel
   * that was private in Discord, and empty when `@everyone` alone could read
   * it (a deny hid it from someone); null otherwise, when the roles could not
   * be read, and always on the upload path.
   */
  discord_reader_role_ids: string[] | null;
  /**
   * The admin chose "Same as Discord" for the channel `create_new` makes:
   * `ROLE_GATED` on the read permissions of the Frapp roles mapped from
   * `discord_reader_role_ids`. The permissions are resolved into
   * `new_channel_required_permissions` when the channels are mapped, and
   * starting the import refuses a row they no longer match.
   */
  new_channel_same_as_discord: boolean;
}

/** The two `chat_channels.type` values an import may create. */
export type DiscordImportNewChannelType = 'PUBLIC' | 'ROLE_GATED';

/** One channel or thread as the Watch view names it (#2857). */
export type DiscordImportChannelProgressRow = Pick<
  DiscordImportChannel,
  | 'discord_channel_id'
  | 'discord_channel_name'
  | 'discord_category'
  | 'parent_discord_channel_id'
  | 'status'
  | 'imported_count'
  | 'error'
  | 'target_channel_id'
>;

/** How many rows of each kind the Watch view names, at most. */
export const DISCORD_IMPORT_PROGRESS_LIMITS = {
  running: 5,
  recent: 5,
  failed: 20,
} as const;

/**
 * An import's progress channel by channel, for the Watch view (#2857).
 *
 * Counts, plus a few rows worth naming: the ones running now, the last ones
 * finished, and the failures. It stays a few KB whatever the server's size,
 * because the view polls it every few seconds and a server can hold over a
 * thousand channels and threads; the full list is `GET :id/channels`.
 * Rows mapped to skip are not being imported and are in none of it.
 */
export interface DiscordImportChannelProgress {
  counts: Record<DiscordImportChannelStatus, number>;
  running: DiscordImportChannelProgressRow[];
  /** Finished most recently first: the worker walks rows in `position` order. */
  recent: DiscordImportChannelProgressRow[];
  failed: DiscordImportChannelProgressRow[];
}

export type DiscordImportFileKind = 'export' | 'media';

/**
 * A channel the worker created for an import (#2905). The purge deletes the
 * ones left holding nothing. Kept apart from the mapping rows, because
 * remapping a failed import rewrites those without their targets.
 */
export interface DiscordImportCreatedChannel {
  import_id: string;
  channel_id: string;
  created_at: string;
}

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
